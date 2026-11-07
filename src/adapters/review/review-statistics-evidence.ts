import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import type { Mission } from '../../domain/mission.js';
import { missionCohortMetadata } from '../../application/projections/metrics-read-adapter.js';
import type { Review, ReviewRound } from '../../domain/review.js';
import { normalizeImplementer } from '../../application/services/statistics-row.js';
import type { ReviewEpisode, ReviewStatisticsEvidence, WorkflowReturn } from '../../application/services/review-statistics.js';
import type { StatsRecoveryEvidence } from '../../application/stats-recovery-evidence.js';
import type { OperationalHistoryRepository } from '../../application/ports/operation-history.js';
import { GitMissionPatchComparison } from './mission-patch-comparison.js';

/** The lane-move facts a return needs; read-only, never a lane write. */
export interface LaneMove {
  readonly fromStatus: string | null;
  readonly toStatus: string;
  readonly trigger: string;
  readonly agent: string;
  readonly occurredAt: string;
  readonly idempotencyKey: string;
}

/** Read-only proofs through the existing mission-patch comparison owner. */
export function createReviewStatisticsEvidenceReader(root: string) {
  const comparison = new GitMissionPatchComparison(root);
  const proofs = new PatchProofCache(root, comparison);
  return async (review: Review | null, workflowReturns?: readonly WorkflowReturn[],
    reviewEpisodes?: readonly ReviewEpisode[]): Promise<ReviewStatisticsEvidence> => {
    const equivalentSubmissions: Record<string, string[]> = {};
    // Only returned work needs judged-work proofs. Plain approvals must not
    // turn every stats read into a Git audit of all delivered work.
    for (const round of review?.rounds ?? []) {
      const returned = round.decision?.kind === 'changes-requested' || (round.decision?.kind === 'approved' && Boolean(round.decision.revocation));
      if (!returned) { continue; }
      const proof = await judgmentProof(round, review!.rounds, proofs);
      if (round.decision?.revision) { equivalentSubmissions[round.decision.revision] = [...new Set([...(equivalentSubmissions[round.decision.revision] ?? []), ...proof])]; }
    }
    proofs.flush();
    return { equivalentSubmissions, ...(workflowReturns ? { workflowReturns } : {}),
      ...(reviewEpisodes ? { reviewEpisodes } : {}) };
  };
}

/** One completed rebound occurrence read from operational history; all of its attempts are one return. */
export interface ReboundRepairMove {
  readonly occurrenceId: string;
  readonly reasonKind: string;
  readonly area: string | null;
  readonly agent: string;
  readonly occurredAt: string;
}

/** Repair kinds that send delivered work back; relaunches of a launch that produced nothing judgeable are retries. */
const RETURN_REPAIR_KINDS = new Set(['gate-failure', 'review-preparation-verification', 'handoff-verification']);
const LAUNCH_TRIGGERS = new Set(['activate', 'rebound-to-active']);

/**
 * Every distinct return of delivered work to implementation: lane moves back to
 * `active`, plus gate repairs that never moved a lane (pre-review and
 * pre-approval gates). A gate repair belongs to the rebound that opened its
 * incident: it runs while that rebound's lane state lasts, until the next lane
 * move, however long the repair takes; a further repair occurrence in the same
 * interval is independent. Reviewer returns and gate failures outside a
 * rebound's incident are independent however close in time. The rejected work belongs to
 * the agent most recently launched into implementation before the return.
 */
export function workflowReturnsFromHistory(entries: readonly LaneMove[], repairs: readonly ReboundRepairMove[] = []): WorkflowReturn[] {
  const lane = [...entries].sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));
  const launchBefore = (at: string) => lane.findLast(entry => LAUNCH_TRIGGERS.has(entry.trigger) && entry.occurredAt < at);
  const returns = lane.flatMap((entry, index) => entry.toStatus === 'active' && (entry.fromStatus === 'review' || entry.fromStatus === 'integration')
    ? [{ rebound: entry.trigger === 'rebound-to-active', until: lane[index + 1]?.occurredAt,
      item: { identity: `lane:${entry.idempotencyKey}`, author: normalizeImplementer(launchBefore(entry.occurredAt)?.agent) || null,
        authorSince: launchBefore(entry.occurredAt)?.occurredAt, at: entry.occurredAt, source: entry.trigger === 'rebound-to-active' ? 'rebound' as const : 'judgment' as const } }]
    : []);
  const standalone: WorkflowReturn[] = [];
  const claimed = new Set<string>();
  for (const repair of [...repairs].sort((a, b) => a.occurredAt.localeCompare(b.occurredAt))) {
    if (!RETURN_REPAIR_KINDS.has(repair.reasonKind)) { continue; }
    const incident = returns.findLast(({ rebound, item, until }) => rebound && item.at <= repair.occurredAt && (!until || repair.occurredAt <= until));
    // A rebound owns the first repair occurrence of its incident; a different
    // occurrence launched later in the same active interval is an independent return.
    if (incident && !claimed.has(incident.item.identity)) { claimed.add(incident.item.identity); continue; }
    const launch = launchBefore(repair.occurredAt);
    standalone.push({ identity: `repair:${repair.occurrenceId}`, author: normalizeImplementer(launch?.agent) || normalizeImplementer(repair.agent) || null,
      authorSince: launch?.occurredAt, at: repair.occurredAt, source: 'repair' });
  }
  return [...returns.map(({ item, until }) => ({ ...item, ...(until ? { until } : {}) })), ...standalone];
}

/** One reader of retained workflow history for every consumer; lane moves and rebound repairs are read-only. */
export function createWorkflowReturnReader(lane: { findByMissionId(_missionId: string): Promise<readonly LaneMove[]> },
  history?: { findByTypeForMission?(_type: string, _missionId: string): Promise<readonly { eventData: string; createdAt: string }[]> },
  reboundRepairs?: (_missionId: string) => Promise<readonly ReboundRepairMove[]>) {
  return async (missionId: string): Promise<WorkflowReturn[] | undefined> => {
    const [repairs, recovered, moves] = await Promise.all([
      reboundRepairs?.(missionId) ?? readReboundRepairs(history, missionId),
      readRecoveredWorkflowReturns(history, missionId),
      lane.findByMissionId(missionId),
    ]);
    // A Mission with no retained workflow history has no return evidence; that is unknown, not zero.
    return moves.length === 0 && repairs.length === 0 && recovered.length === 0 ? undefined
      : [...workflowReturnsFromHistory(moves, repairs), ...recovered];
  };
}

/** Index the application-owned minimal rebound history once for a statistics read session. */
export function createReboundRepairReader(history: Pick<OperationalHistoryRepository, 'findReboundRepairs'>) {
  let cached: Promise<ReadonlyMap<string, readonly ReboundRepairMove[]>> | null = null;
  return async (missionId: string): Promise<readonly ReboundRepairMove[]> => {
    cached ??= (history.findReboundRepairs?.() ?? Promise.resolve([])).then(rows => {
      const first = new Map<string, Map<string, ReboundRepairMove>>();
      for (const row of rows) {
        const mission = row.missionId, occurrenceId = row.occurrenceId;
        const occurrences = first.get(mission) ?? new Map<string, ReboundRepairMove>();
        if (!occurrences.has(occurrenceId)) { occurrences.set(occurrenceId, { occurrenceId, reasonKind: row.reasonKind,
          area: row.area, agent: row.agent, occurredAt: attemptStartedAt(row.occurredAt, row.durationMs ?? null) }); }
        first.set(mission, occurrences);
      }
      return new Map([...first].map(([mission, occurrences]) => [mission, [...occurrences.values()]]));
    });
    return (await cached).get(missionId) ?? [];
  };
}

type WorkflowHistoryReader = { findByTypeForMission?(_type: string, _missionId: string):
  Promise<readonly { eventData: string; createdAt: string }[]> } | undefined;

async function readReboundRepairs(history: WorkflowHistoryReader, missionId: string): Promise<ReboundRepairMove[]> {
  const first = new Map<string, ReboundRepairMove>();
  for (const entry of await history?.findByTypeForMission?.('rebound.repair', missionId) ?? []) {
    const repair = parseReboundRepair(entry);
    if (!repair) { continue; }
    const held = first.get(repair.occurrenceId);
    if (!held || repair.occurredAt < held.occurredAt) { first.set(repair.occurrenceId, repair); }
  }
  return [...first.values()];
}

function parseReboundRepair(entry: { eventData: string; createdAt: string }): ReboundRepairMove | undefined {
  try {
    const data = JSON.parse(entry.eventData) as Record<string, unknown>;
    const occurrenceId = String(data.occurrenceId ?? '');
    if (!occurrenceId) { return undefined; }
    return { occurrenceId, reasonKind: String(data.reasonKind ?? ''), area: typeof data.area === 'string' ? data.area : null,
      agent: String(data.agent ?? ''), occurredAt: attemptStartedAt(entry.createdAt,
        typeof data.durationMs === 'number' && Number.isFinite(data.durationMs) ? data.durationMs : null) };
  } catch { return undefined; }
}

function attemptStartedAt(completedAt: string, durationMs: number | null): string {
  const completed = Date.parse(completedAt);
  return durationMs !== null && Number.isFinite(completed)
    ? new Date(completed - Math.max(0, durationMs)).toISOString() : completedAt;
}

async function readRecoveredWorkflowReturns(history: WorkflowHistoryReader, missionId: string): Promise<WorkflowReturn[]> {
  const recovered: WorkflowReturn[] = [];
  for (const entry of await history?.findByTypeForMission?.('stats.recovery.evidence', missionId) ?? []) {
    try {
      const item = (JSON.parse(entry.eventData) as { evidence?: StatsRecoveryEvidence }).evidence;
      if (item) { recovered.push(...workflowReturnsFromRecoveredEvidence([item])); }
    } catch { /* A malformed audit row is unavailable evidence, never zero. */ }
  }
  return recovered;
}

/** Only provider request-changes decisions are returns; publications and approvals are not. */
export function workflowReturnsFromRecoveredEvidence(records: readonly StatsRecoveryEvidence[]): WorkflowReturn[] {
  return records.flatMap(record => {
    if (record.source !== 'forgejo-review' || record.kind !== 'review-decision'
      || String(record.raw.state ?? '').toUpperCase().replaceAll(' ', '_') !== 'REQUEST_CHANGES') { return []; }
    const sender = typeof record.raw.user === 'object' && record.raw.user !== null
      ? String((record.raw.user as { login?: unknown }).login ?? '') || null : null;
    return [{ identity: `recovered:${record.identity}`, author: null, at: record.observedAt, source: 'judgment' as const,
      origin: { actor: 'human' as const, stage: 'human-review' as const, decisionIdentity: record.identity,
        revision: record.links.revision, sender, pullRequest: record.links.pullRequest === null
          ? null : String(record.links.pullRequest), cause: 'changes-requested' } }];
  });
}

/** Explicit human-review eligibility comes from the durable integration handoff, not from a send-back. */
export function createHumanReviewEpisodeReader(lane: { findByMissionId(_missionId: string): Promise<readonly LaneMove[]> }) {
  return async (missionId: string): Promise<ReviewEpisode[] | undefined> => {
    const moves = [...await lane.findByMissionId(missionId)].sort((left, right) => left.occurredAt.localeCompare(right.occurredAt));
    if (moves.length === 0) { return undefined; }
    return moves.flatMap((move, index) => {
      if (move.toStatus !== 'integration') { return []; }
      const terminal = moves.slice(index + 1).find(next => next.occurredAt >= move.occurredAt);
      if (!terminal) { return []; }
      return [{ identity: `human-handoff:${move.idempotencyKey}`, actor: 'human' as const,
        stage: 'human-review' as const, startedAt: move.occurredAt, endedAt: terminal.occurredAt,
        revision: null, sender: terminal.agent || 'operator' }];
    });
  };
}

async function judgmentProof(round: ReviewRound,
  rounds: Review['rounds'], comparison: Pick<GitMissionPatchComparison, 'samePatch'>): Promise<string[]> {
  const revision = round.decision?.revision;
  if (!revision || revision === round.subject.revision) { return []; }
  const proven: string[] = [];
  const submissions = rounds.filter(submission => submission.number <= round.number
    && (submission === round || submission.implementer !== round.implementer));
  for (const submission of submissions) {
    try {
      // Prove an empty mission delta between submission and judgment first.
      // This reuses the same owner without replaying the branch's entire
      // release history for ordinary bookkeeping-only moves.
      const baseline = submission.subject.revision;
      if (await comparison.samePatch({ revision, baseline }, { revision: baseline, baseline })) {
        proven.push(submission.subject.revision);
      }
    } catch {
      // Missing Git objects provide no proof. Assignment never substitutes for it.
    }
  }
  return proven;
}

/** Bind one proof reader to a read session; Git objects are immutable by SHA. */
export function createMissionCohortMetadataReader(root: string,
  workflowReturns?: (_missionId: string) => Promise<readonly WorkflowReturn[] | undefined>,
  humanEpisodes?: (_missionId: string) => Promise<readonly ReviewEpisode[] | undefined>) {
  const readEvidence = createReviewStatisticsEvidenceReader(root);
  return async (missions: readonly Mission[]) => {
    const evidence = new Map<string, ReviewStatisticsEvidence>();
    const completed = missions.filter(mission => mission.status === 'done');
    // Bound process fan-out while avoiding a serial Git audit on each refresh.
    for (let offset = 0; offset < completed.length; offset += 4) {
      await Promise.all(completed.slice(offset, offset + 4).map(async mission => {
        evidence.set(mission.id, await readEvidence(mission.review,
          await workflowReturns?.(mission.id), await humanEpisodes?.(mission.id)));
      }));
    }
    return missionCohortMetadata(missions, evidence);
  };
}

/** Cache Git facts, never review counts. Only immutable object IDs are reusable. */
class PatchProofCache {
  private readonly file: string;
  private readonly writable: boolean;
  private readonly entries = new Map<string, boolean>();
  private changed = false;
  constructor(root: string, private readonly comparison: GitMissionPatchComparison) {
    this.writable = fs.existsSync(root);
    this.file = path.join(root, '.workflow', 'cache', 'review-patch-proofs-v1.json');
    try {
      const stored: unknown = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      if (stored && typeof stored === 'object' && !Array.isArray(stored)) {
        for (const [key, value] of Object.entries(stored)) {
          if (/^[a-f0-9]{64}$/.test(key) && typeof value === 'boolean') { this.entries.set(key, value); }
        }
      }
    } catch { /* Missing or corrupt cache is a miss, never evidence. */ }
  }
  async samePatch(before: Parameters<GitMissionPatchComparison['samePatch']>[0], after: Parameters<GitMissionPatchComparison['samePatch']>[1]): Promise<boolean> {
    const immutable = [before.revision, before.baseline, after.revision, after.baseline].every(value => /^[a-f0-9]{40}$/.test(value));
    const key = createHash('sha256').update(JSON.stringify([before, after])).digest('hex');
    if (immutable && this.entries.has(key)) { return this.entries.get(key)!; }
    const result = await this.comparison.samePatch(before, after);
    if (immutable) { this.entries.set(key, result); this.changed = true; }
    return result;
  }
  flush(): void {
    if (!this.changed || !this.writable) { return; }
    const temporary = `${this.file}.${randomUUID()}.tmp`;
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      fs.writeFileSync(temporary, JSON.stringify(Object.fromEntries(this.entries)), { mode: 0o600 });
      fs.renameSync(temporary, this.file);
      this.changed = false;
    } catch { /* Cache availability must not change the observation. */ }
    finally { try { fs.unlinkSync(temporary); } catch { /* Already renamed or unavailable. */ } }
  }
}
