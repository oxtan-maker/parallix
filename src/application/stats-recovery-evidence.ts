import { createHash } from 'node:crypto';

export type StatsRecoverySource =
  | 'mission-review' | 'lane-move' | 'rebound-repair' | 'validation'
  | 'workflow-run' | 'git' | 'forgejo-pr' | 'forgejo-review'
  | 'forgejo-issue-comment' | 'forgejo-review-comment';

export type StatsRecoveryFactKind =
  | 'review-decision' | 'review-publication' | 'lane-return'
  | 'repair-attempt' | 'validation-result' | 'workflow-telemetry'
  | 'revision' | 'provider-comment';

export interface StatsRecoveryLinks {
  readonly repositoryId: string;
  readonly missionId: string | null;
  readonly revision: string | null;
  readonly pullRequest: number | null;
}

/** One immutable source fact. Historical facts never imply measured runtime. */
export interface StatsRecoveryEvidence {
  readonly identity: string;
  readonly source: StatsRecoverySource;
  readonly kind: StatsRecoveryFactKind;
  readonly observedAt: string;
  readonly links: StatsRecoveryLinks;
  readonly provenance: string;
  readonly collectionEra: 'historical-reconstruction' | 'measured-workflow';
  readonly classification: 'direct-observation' | 'reconstructed-fact';
  readonly raw: Readonly<Record<string, unknown>>;
}

export interface StatsRecoveryConflict {
  readonly identity: string;
  readonly retained: StatsRecoveryEvidence;
  readonly conflicting: StatsRecoveryEvidence;
  readonly fields: readonly string[];
}

export interface StatsRecoveryCollection {
  readonly evidence: readonly StatsRecoveryEvidence[];
  readonly conflicts: readonly StatsRecoveryConflict[];
  readonly duplicateCount: number;
  readonly failures: readonly { readonly source: StatsRecoverySource; readonly detail: string }[];
  readonly completedSources: readonly StatsRecoverySource[];
}

export interface StatsRecoveryAudit {
  readonly collected: number;
  readonly additions: number;
  readonly duplicates: number;
  readonly conflicts: number;
  readonly bySource: Readonly<Record<string, { readonly collected: number; readonly additions: number; readonly conflicts: number }>>;
  readonly byMission: Readonly<Record<string, { readonly additions: number; readonly sources: readonly string[] }>>;
  readonly unresolvedGaps: readonly string[];
  readonly inventoryPeriod: { readonly before: string };
  readonly inventory: {
    readonly reviewToActiveTransitions: number;
    readonly reviewToActiveMissions: number;
    readonly reviewRounds: number;
    readonly reviewRoundMissions: number;
    readonly changesRequestedDecisions: number;
    readonly integrationGateRevocations: number;
    readonly reboundRepairs: number;
    readonly reboundRepairMissions: number;
  };
}

/** Parse heterogeneous ISO-8601 offsets and retain one canonical UTC instant. */
export function recoveryInstant(value: string): string {
  const millis = Date.parse(value);
  if (!Number.isFinite(millis)) { throw new Error(`Invalid recovery timestamp: ${value}`); }
  return new Date(millis).toISOString();
}

/** Provider IDs are preferred; source-owned compound keys are hashed when no ID exists. */
export function recoveryIdentity(source: StatsRecoverySource, parts: readonly (string | number | null | undefined)[]): string {
  const stable = parts.map(part => part === null || part === undefined ? '' : String(part));
  return `${source}:${createHash('sha256').update(JSON.stringify(stable)).digest('hex')}`;
}

/** Stable identity for one observed conflict, independent of collection order. */
export function recoveryConflictIdentity(conflict: StatsRecoveryConflict): string {
  const variants = [conflict.retained, conflict.conflicting]
    .map(value => JSON.stringify(value))
    .sort((left, right) => left.localeCompare(right));
  return `stats-recovery-conflict:${createHash('sha256')
    .update(JSON.stringify([conflict.identity,
      conflict.fields.slice().sort((left, right) => left.localeCompare(right)), ...variants]))
    .digest('hex')}`;
}

/** Collapse exact duplicate pages while preserving both sides of every conflict. */
export function reconcileRecoveryEvidence(records: readonly StatsRecoveryEvidence[],
  failures: StatsRecoveryCollection['failures'] = []): StatsRecoveryCollection {
  const retained = new Map<string, StatsRecoveryEvidence>();
  const conflicts: StatsRecoveryConflict[] = [];
  let duplicateCount = 0;
  for (const record of records) {
    const existing = retained.get(record.identity);
    if (!existing) { retained.set(record.identity, record); continue; }
    const fields = changedFields(existing, record);
    if (fields.length === 0) { duplicateCount += 1; continue; }
    conflicts.push({ identity: record.identity, retained: existing, conflicting: record, fields });
  }
  return { evidence: [...retained.values()].sort((a, b) => a.observedAt.localeCompare(b.observedAt) || a.identity.localeCompare(b.identity)),
    conflicts, duplicateCount, failures,
    completedSources: [...new Set(records.map(record => record.source).filter(source => !failures.some(item => item.source === source)))] };
}

export function mergeRecoveryCollections(collections: readonly StatsRecoveryCollection[]): StatsRecoveryCollection {
  const reconciled = reconcileRecoveryEvidence(collections.flatMap(collection => collection.evidence),
    collections.flatMap(collection => collection.failures));
  return { ...reconciled, conflicts: [...collections.flatMap(collection => collection.conflicts), ...reconciled.conflicts],
    duplicateCount: collections.reduce((total, collection) => total + collection.duplicateCount, 0) + reconciled.duplicateCount };
}

export function recoveryAudit(collection: StatsRecoveryCollection, existing: ReadonlySet<string>): StatsRecoveryAudit {
  const additions = collection.evidence.filter(item => !existing.has(item.identity));
  const sources = [...new Set(collection.evidence.map(item => item.source))];
  const bySource = Object.fromEntries(sources.map(source => [source, {
    collected: collection.evidence.filter(item => item.source === source).length,
    additions: additions.filter(item => item.source === source).length,
    conflicts: collection.conflicts.filter(item => item.retained.source === source || item.conflicting.source === source).length,
  }]));
  const missions = [...new Set(additions.map(item => item.links.missionId).filter((item): item is string => Boolean(item)))];
  const byMission = Object.fromEntries(missions.map(mission => [mission, { additions: additions.filter(item => item.links.missionId === mission).length,
    sources: [...new Set(additions.filter(item => item.links.missionId === mission).map(item => item.source))] }]));
  const historical = collection.evidence.filter(item => item.observedAt < HISTORICAL_MEASUREMENT_CUTOFF);
  const laneReturns = historical.filter(item => item.source === 'lane-move' && item.kind === 'lane-return'
    && item.raw.fromStatus === 'review');
  const rounds = historical.filter(item => item.source === 'mission-review' && 'round' in item.raw);
  const decisions = collection.evidence.filter(item => item.source === 'mission-review' && item.kind === 'review-decision'
    && (typeof item.raw.roundStartedAt === 'string' ? recoveryInstant(item.raw.roundStartedAt) : item.observedAt)
      < HISTORICAL_MEASUREMENT_CUTOFF);
  const changes = decisions.filter(item => decisionKind(item) === 'changes-requested');
  const revocations = decisions.filter(item => decisionKind(item) === 'approved'
    && nested(item.raw, 'decision', 'revocation', 'cause', 'kind') === 'integration-gate-failure'
    && typeof nested(item.raw, 'decision', 'revocation', 'revokedAt') === 'string'
    && recoveryInstant(String(nested(item.raw, 'decision', 'revocation', 'revokedAt'))) < HISTORICAL_MEASUREMENT_CUTOFF);
  const repairs = historical.filter(item => item.source === 'rebound-repair');
  return { collected: collection.evidence.length, additions: additions.length, duplicates: collection.duplicateCount,
    conflicts: collection.conflicts.length, bySource, byMission,
    unresolvedGaps: collection.failures.map(item => `${item.source}: ${item.detail}`),
    inventoryPeriod: { before: HISTORICAL_MEASUREMENT_CUTOFF },
    inventory: { reviewToActiveTransitions: laneReturns.length, reviewToActiveMissions: missionPopulation(laneReturns),
      reviewRounds: rounds.length, reviewRoundMissions: missionPopulation(rounds), changesRequestedDecisions: changes.length,
      integrationGateRevocations: revocations.length, reboundRepairs: repairs.length, reboundRepairMissions: missionPopulation(repairs) } };
}

/** First verification-measurement merge boundary; historical inventory stops before it. */
export const HISTORICAL_MEASUREMENT_CUTOFF = '2026-11-03T06:23:43.000Z';

function decisionKind(item: StatsRecoveryEvidence): unknown { return nested(item.raw, 'decision', 'kind'); }
function nested(value: unknown, ...keys: string[]): unknown {
  let current = value;
  for (const key of keys) {
    if (!current || typeof current !== 'object') { return undefined; }
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}
function missionPopulation(records: readonly StatsRecoveryEvidence[]): number {
  return new Set(records.map(item => item.links.missionId).filter(Boolean)).size;
}

function changedFields(left: StatsRecoveryEvidence, right: StatsRecoveryEvidence): string[] {
  const fields: (keyof StatsRecoveryEvidence)[] = ['source', 'kind', 'observedAt', 'links', 'provenance', 'collectionEra', 'classification', 'raw'];
  return fields.filter(field => JSON.stringify(left[field]) !== JSON.stringify(right[field]));
}
