import type { GateReportOutcome, GateRunReport, GateRunReportState } from '../../application/ports/gate-run-report.js';
import { scrubCredentials } from '../../application/recovery-evidence.js';
import { claimLocalProcessLock } from '../filesystem/recovery-claim.js';
import { forgejoApiAsync } from './forgejo-api.js';
import type { ForgejoApiOptions, ForgejoApiResult, ForgejoAsyncApiCall, ForgejoIssueComment, ForgejoPullRequest } from './forgejo-types.js';

/** The commit-status context the aggregate pre-integration result is published under. */
export const GATE_REPORT_CONTEXT = 'parallix/pre-integration';
const DIAGNOSTIC_LIMIT = 800;
const DESCRIPTION_LIMIT = 140;
const STATUS_STATE: Record<GateRunReportState, 'pending' | 'success' | 'failure' | 'error'> = {
  running: 'pending', passed: 'success', failed: 'failure', interrupted: 'error', cancelled: 'error',
};
const OUTCOME_MARK: Record<GateReportOutcome, string> = {
  pending: '… pending', passed: '✓ passed', failed: '✗ failed', blocked: '⊘ blocked', cancelled: '× cancelled', 'not-run': '· not run',
  validated: '✓ validated earlier, not rerun',
};

export interface ForgejoGateReportOptions {
  readonly branch: string;
  readonly token: string;
  readonly rootDir?: string;
  readonly configuration?: ForgejoApiOptions['configuration'];
  readonly apiCall?: ForgejoAsyncApiCall;
}

const runMarker = (id: string) => `<!-- parallix-gate-run:${id} -->`;
const shortId = (id: string) => id.slice(0, 8);

function listed(report: GateRunReport, outcome: GateReportOutcome): string {
  return report.gates.filter(gate => gate.outcome === outcome).map(gate => gate.key).join(', ');
}

/** The status description: terminal word, the names that explain it, and the run identity that orders it. */
export function statusDescription(report: GateRunReport): string {
  const suffix = ` · run ${shortId(report.gateRunId)} @ ${report.startedAt}`;
  const cause = report.state === 'failed' ? listed(report, 'failed') : '';
  const head = `${report.state[0].toUpperCase()}${report.state.slice(1)}${cause ? `: ${cause}` : ''}`;
  return `${head.slice(0, DESCRIPTION_LIMIT - suffix.length)}${suffix}`;
}

function diagnosticBlock(key: string, diagnostics: string): string {
  const tail = scrubCredentials(diagnostics).replaceAll('```', "'''").trim().slice(-DIAGNOSTIC_LIMIT);
  return `<details><summary>${key} diagnostics</summary>\n\n\`\`\`\n${tail}\n\`\`\`\n</details>`;
}

/** One comment per run: tested revision, every configured gate, and bounded redacted diagnostics. */
export function gateReportComment(report: GateRunReport, head: string | null): string {
  const stale = head && head !== report.revision ? ` · not the current pull-request head (\`${head.slice(0, 12)}\`)` : '';
  const settled = report.finishedAt ? ` · finished ${report.finishedAt}` : '';
  const rows = report.gates.map(gate => {
    const detail = gate.outcome === 'blocked' && gate.blockedBy.length ? ` by ${gate.blockedBy.join(', ')}`
      : gate.outcome === 'failed' && gate.exitCode !== null ? ` (exit ${gate.exitCode})` : '';
    return `| ${gate.key} | ${OUTCOME_MARK[gate.outcome]}${detail} |`;
  });
  const diagnostics = report.gates.filter(gate => gate.outcome === 'failed' && gate.diagnostics?.trim())
    .map(gate => diagnosticBlock(gate.key, gate.diagnostics!));
  return [runMarker(report.gateRunId),
    `### Pre-integration gates: ${report.state}`,
    `Tested revision \`${report.revision.slice(0, 12)}\` · run \`${shortId(report.gateRunId)}\` · started ${report.startedAt}${settled}${stale}`,
    '', '| Gate | Outcome |', '| --- | --- |', ...rows, ...(diagnostics.length ? ['', ...diagnostics] : [])].join('\n');
}

type StatusEntry = { context?: string; description?: string; status?: string; state?: string };
type Reads = { api: ForgejoAsyncApiCall; token: string; call: ForgejoApiOptions };
const PAGE_SIZE = 50;
const MAX_PAGES = 20;

/** Every record of a list endpoint, or null when any page is unreadable or the page cap is hit: a partial list is never a complete one. */
async function listAll<T>({ api, token, call }: Reads, endpoint: string): Promise<T[] | null> {
  const all: T[] = [];
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const joiner = endpoint.includes('?') ? '&' : '?';
    const result = await api<T[]>('GET', `${endpoint}${joiner}limit=${PAGE_SIZE}&page=${page}`, token, undefined, call);
    if (!result.ok || !Array.isArray(result.data)) { return null; }
    all.push(...result.data);
    if (result.data.length < PAGE_SIZE) { return all; }
  }
  return null;
}

/** A published run's place in the order: when it started, then its run id, so two runs started in the
 * same millisecond still order the same way in every process. */
interface RunKey { started: number; id: string }
const RUN_MARK = /· run ([0-9a-f]{8}) @ (\S+)$/;
const afterRun = (a: RunKey, b: RunKey): boolean => a.started > b.started || (a.started === b.started && a.id > b.id);
const sameRun = (a: RunKey, b: RunKey): boolean => a.started === b.started && a.id === b.id;
const reportKey = (report: GateRunReport): RunKey => ({ started: Date.parse(report.startedAt), id: shortId(report.gateRunId) });

function runKeyOf(status: StatusEntry): RunKey | null {
  const mark = status.context === GATE_REPORT_CONTEXT ? RUN_MARK.exec(status.description ?? '') : null;
  const started = mark ? Date.parse(mark[2]!) : Number.NaN;
  return mark && Number.isFinite(started) ? { started, id: mark[1]! } : null;
}

/**
 * The run that started last on a revision, with its last-written status: the provider lists
 * statuses oldest first, so a later entry of the same run supersedes the earlier one.
 */
function newestStatus(statuses: readonly StatusEntry[]): { key: RunKey; status: StatusEntry } | null {
  let newest: { key: RunKey; status: StatusEntry } | null = null;
  for (const status of statuses) {
    const key = runKeyOf(status);
    if (key && (newest === null || afterRun(key, newest.key) || sameRun(key, newest.key))) { newest = { key, status }; }
  }
  return newest;
}

/** A newer run on this revision has already reported: a late older run must not replace it. */
const supersededOnRevision = (statuses: readonly StatusEntry[], report: GateRunReport): boolean => {
  const newest = newestStatus(statuses);
  return newest !== null && afterRun(newest.key, reportKey(report));
};

type Plan = { superseded: true } | { superseded: false; pr: ForgejoPullRequest | null; commentId: number | null };

/**
 * Every read the publication depends on. Any unreadable read fails the whole
 * publication before a write, so ordering and comment identity are enforced, not best effort.
 */
async function planPublication(reads: Reads, report: GateRunReport, branch: string): Promise<Plan | null> {
  const statuses = await listAll<StatusEntry>(reads, `/commits/${report.revision}/statuses`);
  if (statuses === null) { return null; }
  if (supersededOnRevision(statuses, report)) { return { superseded: true }; }
  const pulls = await listAll<ForgejoPullRequest>(reads, '/pulls?state=open');
  if (pulls === null) { return null; }
  const pr = pulls.find(candidate => candidate.head?.ref === branch) ?? null;
  if (pr?.number === undefined) { return { superseded: false, pr: null, commentId: null }; }
  const comments = await listAll<ForgejoIssueComment>(reads, `/issues/${pr.number}/comments`);
  if (comments === null) { return null; }
  const own = comments.find(comment => comment.body?.startsWith(runMarker(report.gateRunId)));
  return { superseded: false, pr, commentId: own?.id ?? null };
}

/**
 * Forgejo shows the last status written for a context and the status API offers no compare-and-swap,
 * so the read that rejects a superseded run and the write it orders must not interleave with another
 * publication of the same revision. Publications take the existing process-owned local claim for
 * that revision; a publication that cannot hold it writes nothing rather than risk an older verdict
 * over a newer one. A publication from a different machine holds no such claim, so cross-host
 * overlap stays outside the guarantee.
 */
const LOCK_WAIT_MS = 2_000;
const LOCK_POLL_MS = 20;

/** Claim the revision lock, waiting briefly for a publication that overlaps this one. */
async function takeRevisionLock(revision: string): Promise<(() => Promise<void>) | null> {
  const deadline = Date.now() + LOCK_WAIT_MS;
  for (;;) {
    const release = claimLocalProcessLock(`gate-report-${revision}`);
    if (release) { return release; }
    if (Date.now() >= deadline) { return null; }
    await new Promise(resolve => setTimeout(resolve, LOCK_POLL_MS));
  }
}

/** Run `work` with this revision's status slot to ourselves; null when the lock is held elsewhere. */
async function withRevisionLock<T>(revision: string, work: () => Promise<T>): Promise<T | null> {
  const release = await takeRevisionLock(revision);
  if (!release) { return null; }
  try { return await work(); } finally { await release(); }
}

/** A publication succeeded only when its status and its run comment both landed. */
function publicationResult(posted: ForgejoApiResult<unknown>, written: ForgejoApiResult<unknown> | null): { ok: boolean; error?: string } {
  return posted.ok && (written === null || written.ok) ? { ok: true }
    : { ok: false, error: posted.error ?? written?.error ?? undefined };
}

/**
 * Publish one gate run on Forgejo: the aggregate verdict as a commit status on
 * the tested revision, ordered by run identity against what the provider already
 * shows for it, and the per-gate detail as one pull-request comment owned by the
 * run. Review decisions are never touched.
 */
export async function publishGateRunReport(report: GateRunReport, options: ForgejoGateReportOptions): Promise<{ ok: boolean; error?: string }> {
  const reads: Reads = { api: options.apiCall ?? forgejoApiAsync, token: options.token,
    call: { rootDir: options.rootDir, configuration: options.configuration } };
  const published = await withRevisionLock(report.revision, async () => {
    const plan = await planPublication(reads, report, options.branch);
    if (plan === null) { return { ok: false, error: 'gate-report-lookup-failed' }; }
    if (plan.superseded) { return { ok: true }; }
    const { api, token, call } = reads;
    const posted = await api('POST', `/statuses/${report.revision}`, token,
      { state: STATUS_STATE[report.state], context: GATE_REPORT_CONTEXT, description: statusDescription(report) }, call);
    if (!plan.pr?.number) { return publicationResult(posted, null); }
    const body = gateReportComment(report, plan.pr.head?.sha ?? null);
    const written = plan.commentId === null ? await api('POST', `/issues/${plan.pr.number}/comments`, token, { body }, call)
      : await api('PATCH', `/issues/comments/${plan.commentId}`, token, { body }, call);
    return publicationResult(posted, written);
  });
  return published ?? { ok: false, error: 'gate-report-locked' };
}
