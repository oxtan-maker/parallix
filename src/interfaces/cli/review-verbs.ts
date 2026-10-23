/**
 * `px verdict` and `px resolve` — typed terminal UX over the existing review
 * recorders.
 *
 * These verbs add no review logic. They are an input transport: typed flags in
 * place of `review-findings.md` / `round-resolution.md`, handing the existing
 * consumers `ReviewFinding` and `ReviewItemDisposition` values directly. The
 * consumer renders Markdown for the review event and the provider comment, but
 * never parses it back, so no decision is round-tripped through prose. The
 * round, phase and lifecycle rules stay where they are tested; only the way a
 * human names a finding at the terminal is new.
 *
 * `px review` keeps the operator flags that steer the loop, including
 * `--implementer` and `--reviewer` for switching an agent that is not working
 * out. Handoff stays automatic inside `px review` and is not a command
 * (retired by TASK-2490).
 *
 * Every dependency is injected, so this interface module imports no adapter.
 */

import * as fmt from '../../application/presentation/cli-format.js';
import type { ReviewFinding, ReviewItemDisposition } from '../../domain/review.js';

/** The existing recorders, supplied by composition. */
export interface ReviewVerbPorts {
  readonly resolveSlug: (_explicit?: string) => string | null;
  readonly resolveWorktree: (_slug: string) => string | null;
  readonly readReviewState: (_slug: string, _worktree: string) => Promise<{ round: number; phase: string } | null>;
  readonly consumeReviewerOutput: (
    _slug: string,
    _reviewer: string,
    _output: { findings: readonly ReviewFinding[]; comment: string | null; verdict: string },
    _worktree: string,
    _expectedVersion?: number,
  ) => Promise<{ consumed: boolean; ok?: boolean; diagnostic?: string | null }>;
  readonly consumeImplementerOutput: (
    _slug: string,
    _implementer: string,
    _output: {
      items: readonly ReviewItemDisposition[];
      evidence: readonly string[];
      blockedReason: string | null;
      disposition: string;
      resultingRevision?: string;
    },
    _worktree: string,
    _expectedVersion?: number,
  ) => Promise<{ consumed: boolean; ok?: boolean; diagnostic?: string | null }>;
}

function fail(message: string): never { throw new Error(message); }

/**
 * The Mission version the caller read, optional on every review write.
 *
 * Same rule as the Mission write verbs: when the flag is omitted the command
 * resolves the current stored version itself and the review recorder's
 * compare-and-swap save still refuses a competing write, so a stale decision
 * changes nothing without a preceding `px status` read. Supplying the flag
 * keeps the earlier explicit guard. A present flag with no value is a
 * malformed pin and is refused, never silently treated as automatic.
 */
function expectedVersion(args: readonly string[]): number | undefined {
  // Absent flag resolves the current stored version; a present flag with no
  // value is a malformed pin and refused, so an invalid invocation never
  // becomes a silent automatic write.
  if (!args.includes('--expected-version')) { return undefined; }
  const raw = flag(args, '--expected-version');
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed < 1) { fail('--expected-version must be a positive integer'); }
  return parsed;
}

function flag(args: readonly string[], name: string): string | null {
  const index = args.lastIndexOf(name);
  return index < 0 ? null : args[index + 1] ?? null;
}

function required(args: readonly string[], name: string): string {
  const value = flag(args, name);
  if (value === null || value.startsWith('--')) { fail(`${name} <value> is required`); }
  return value;
}

/**
 * Scan argv left to right so each `--finding <id>` owns the flags that follow
 * it. Order is the contract: a finding can never pick up another's summary.
 */
function findings(args: readonly string[]): ReviewFinding[] {
  const collected: ReviewFinding[] = [];
  let current: { id: string; summary: string | null; location: string | null } | null = null;
  const flush = () => {
    if (!current) { return; }
    if (current.summary === null) { fail(`--finding ${current.id} needs a --summary`); }
    collected.push({ id: current.id, summary: current.summary, location: current.location } as ReviewFinding);
    current = null;
  };
  for (const [index, arg] of args.entries()) {
    const value = args[index + 1];
    const needs = (name: string) => {
      if (value === undefined || value.startsWith('--')) { fail(`${name} needs a value`); }
      return value;
    };
    if (arg === '--finding') { flush(); current = { id: needs('--finding'), summary: null, location: null }; }
    else if (arg === '--summary') { if (!current) { fail('--summary must follow a --finding'); } current.summary = needs('--summary'); }
    else if (arg === '--location') { if (!current) { fail('--location must follow a --finding'); } current.location = needs('--location'); }
  }
  flush();
  return collected;
}

/** Same left-to-right pairing for `--finding` with its resolution answer. */
function dispositions(args: readonly string[]): { items: ReviewItemDisposition[]; evidence: string[] } {
  const items: ReviewItemDisposition[] = [];
  const evidence: string[] = [];
  let currentId: string | null = null;
  for (const [index, arg] of args.entries()) {
    const value = args[index + 1];
    if (arg === '--finding') {
      if (currentId !== null) { fail(`--finding ${currentId} needs a --fixed or --disputed answer`); }
      if (value === undefined || value.startsWith('--')) { fail('--finding needs an id'); }
      currentId = value;
    } else if (arg === '--fixed' || arg === '--disputed') {
      if (currentId === null) { fail(`${arg} must follow a --finding`); }
      if (value === undefined || value.startsWith('--')) { fail(`${arg} needs a value`); }
      const kind = arg === '--fixed' ? 'fixed' : 'pushed_back';
      items.push({ kind, findingId: currentId } as ReviewItemDisposition);
      evidence.push(`${currentId}: ${kind === 'pushed_back' ? 'disputed' : 'fixed'} — ${value}`);
      currentId = null;
    }
  }
  if (currentId !== null) { fail(`--finding ${currentId} needs a --fixed or --disputed answer`); }
  return { items, evidence };
}

export const VERDICT_HELP = `
Usage:
  px verdict approve [--slug <slug>] --actor <family> [--comment <text>]
  px verdict request-changes [--slug <slug>] --actor <family>
      --finding <id> --summary <text> [--location <text>]
      [--finding <id> --summary <text> ...] [--comment <text>]

Record this round's review decision. Each --finding owns the --summary and
optional --location that follow it, so findings are named at the terminal
instead of being written to a file. A decision recorded against a stale version
is rejected and changes nothing; the current version is resolved automatically.
Read the result back with \`px status\`.
`.trimStart();

export const RESOLVE_HELP = `
Usage: px resolve [--slug <slug>] --actor <family>
         --finding <id> (--fixed <evidence> | --disputed <rationale>)
         [--finding <id> ...]
       px resolve [--slug <slug>] --actor <family> --blocked <reason>
Options: [--revision <sha>]

Record the implementer's answer to every outstanding finding. Each --finding is
answered by the --fixed or --disputed that follows it. There is no third answer:
a finding is either delivered or argued with. --revision names the revision the
fixes landed on; omitted, the current head is recorded. Read the result back
with \`px status\`.
`.trimStart();

/** Same slug convention as the Mission write verbs: `--slug`, else the worktree. */
function slugOf(args: readonly string[], ports: ReviewVerbPorts): { slug: string; worktree: string } {
  const slug = ports.resolveSlug(flag(args, '--slug') ?? undefined);
  if (!slug) { fail('no mission slug: run inside the mission worktree or pass --slug <slug>'); }
  return { slug, worktree: ports.resolveWorktree(slug) ?? process.cwd() };
}

/** `px verdict approve|request-changes` */
export function createVerdictCommand(ports: ReviewVerbPorts) {
  return async (args: string[] = []): Promise<void> => {
    if (args.length === 0 || args.includes('--help') || args.includes('-h')) { fmt.log.plain(VERDICT_HELP); return; }
    const action = args[0];
    if (action !== 'approve' && action !== 'request-changes') { fail(VERDICT_HELP); }
    const actor = required(args, '--actor');
    const comment = flag(args, '--comment');
    const version = expectedVersion(args);
    const { slug, worktree } = slugOf(args, ports);
    const state = await ports.readReviewState(slug, worktree);
    if (!state) {
      fail(`no review state for ${slug}: start a review with \`px review ${slug}\` before recording a verdict`);
    }
    const { round } = state;

    let collected: ReviewFinding[] = [];
    if (action === 'request-changes') {
      collected = findings(args);
      if (collected.length === 0) { fail('request-changes requires at least one --finding with a --summary'); }
    } else if (findings(args).length > 0) {
      fail('approve takes no --finding: request changes instead of approving with findings');
    }
    const result = await ports.consumeReviewerOutput(slug, actor, {
      findings: collected, comment, verdict: action,
    }, worktree, version);
    if (!result.consumed || !result.ok) { fail(`could not record the reviewer verdict: ${result.diagnostic ?? 'unknown error'}`); }
    fmt.log.plain(fmt.status('PASS', `Recorded ${action} for ${slug} (round ${round}).`));
  };
}

/** `px resolve` */
export function createResolveCommand(ports: ReviewVerbPorts) {
  return async (args: string[] = []): Promise<void> => {
    if (args.length === 0 || args.includes('--help') || args.includes('-h')) { fmt.log.plain(RESOLVE_HELP); return; }
    // Required, as on `px verdict`: the review loop matches a resolution to the
    // implementer family that recorded it, so a defaulted actor is never read.
    const actor = required(args, '--actor');
    const blocked = flag(args, '--blocked');
    const revision = flag(args, '--revision');
    const version = expectedVersion(args);
    const { slug, worktree } = slugOf(args, ports);
    const { items, evidence } = dispositions(args);
    if (!blocked && items.length === 0) { fail('resolve requires at least one --finding with a --fixed or --disputed answer'); }
    if (blocked && items.length > 0) { fail('--blocked cannot be combined with finding resolutions'); }
    const state = await ports.readReviewState(slug, worktree);
    if (!state) { fail(`no review state for ${slug}: there is no round to resolve`); }
    const { round } = state;
    const result = await ports.consumeImplementerOutput(slug, actor, {
      items,
      evidence,
      blockedReason: blocked,
      disposition: resolutionDisposition(blocked, items),
      ...(revision ? { resultingRevision: revision } : {}),
    }, worktree, version);
    if (!result.consumed || !result.ok) { fail(`could not record the implementer resolution: ${result.diagnostic ?? 'unknown error'}`); }
    fmt.log.plain(fmt.status('PASS', `Recorded ${items.length} resolution(s) for ${slug} (round ${round}).`));
  };
}

function resolutionDisposition(blocked: string | null, items: readonly ReviewItemDisposition[]): string {
  return blocked ? 'BLOCKED' : items.every(item => item.kind === 'pushed_back') ? 'PUSHBACK_ALL' : 'CHANGES_MADE';
}
