import type { Mission } from '../../domain/mission.js';
import type { BoardLaneEventEntry, OperationalHistoryEntry } from '../../application/ports/operation-history.js';
import { reconcileRecoveryEvidence, recoveryIdentity, recoveryInstant,
  HISTORICAL_MEASUREMENT_CUTOFF,
  type StatsRecoveryCollection, type StatsRecoveryEvidence, type StatsRecoveryFactKind,
  type StatsRecoverySource } from '../../application/stats-recovery-evidence.js';

export interface LocalStatsRecoverySources {
  readonly missions: readonly Mission[];
  readonly laneMoves: readonly BoardLaneEventEntry[];
  readonly operationalHistory: readonly OperationalHistoryEntry[];
}

/** Enumerate every retained repository-scoped local source without mutating it. */
export function collectLocalStatsRecovery(input: LocalStatsRecoverySources, repositoryId: string): StatsRecoveryCollection {
  const missions = input.missions.filter(mission => mission.repositoryId === repositoryId);
  const missionIds = new Set(missions.map(mission => String(mission.id)));
  const evidence = missions.flatMap(mission => missionEvidence(mission));
  evidence.push(...input.laneMoves.filter(move => move.repositoryId === repositoryId && missionIds.has(move.missionId))
    .map(laneEvidence));
  for (const entry of input.operationalHistory) {
    const recovered = historyEvidence(entry, repositoryId, missionIds);
    if (recovered) { evidence.push(recovered); }
  }
  return reconcileRecoveryEvidence(evidence);
}

function missionEvidence(mission: Mission): StatsRecoveryEvidence[] {
  const links = (revision: string | null, pullRequest: number | null = null) => ({ repositoryId: String(mission.repositoryId),
    missionId: String(mission.id), revision, pullRequest });
  const records: StatsRecoveryEvidence[] = [];
  for (const round of mission.review?.rounds ?? []) {
    const revision = round.decision?.revision ?? round.subject.revision;
    records.push(record('mission-review', 'review-publication', [`${mission.id}`, 'round', round.number], round.startedAt,
      links(revision), `Mission Review round ${round.number}`, { round }));
    if (round.decision) {
      records.push(record('mission-review', 'review-decision', [`${mission.id}`, 'decision', round.number,
        round.decision.decidedAt], round.decision.decidedAt, links(revision), `Mission Review decision ${round.number}`,
      { decision: round.decision, roundStartedAt: round.startedAt }));
    }
    records.push(record('git', 'revision', [`${mission.id}`, 'round', round.number, round.subject.revision], round.startedAt,
      links(round.subject.revision), `Mission Review subject revision ${round.number}`, { baseline: round.subject.baseline }));
  }
  for (const event of mission.review?.reviewEvents ?? []) {
    records.push(record('mission-review', 'review-publication', [`${mission.id}`, 'event', event.position], event.createdAt,
      links(mission.review?.rounds.find(round => round.number === event.roundNumber)?.subject.revision ?? null),
      `Mission Review event ${event.position}`, { event }));
  }
  return records;
}

function laneEvidence(move: BoardLaneEventEntry): StatsRecoveryEvidence {
  const returned = move.toStatus === 'active' && (move.fromStatus === 'review' || move.fromStatus === 'integration');
  return record('lane-move', returned ? 'lane-return' : 'workflow-telemetry', [move.repositoryId, move.idempotencyKey], move.occurredAt,
    { repositoryId: move.repositoryId, missionId: move.missionId, revision: null, pullRequest: null },
    `board_lane_events idempotency_key=${move.idempotencyKey}`, { fromStatus: move.fromStatus, toStatus: move.toStatus,
      trigger: move.trigger, agent: move.agent });
}

function historyEvidence(entry: OperationalHistoryEntry, repositoryId: string,
  missionIds: ReadonlySet<string>): StatsRecoveryEvidence | null {
  let raw: Record<string, unknown>;
  try { raw = JSON.parse(entry.eventData) as Record<string, unknown>; } catch { return null; }
  const missionId = typeof raw.missionId === 'string' ? raw.missionId : null;
  const explicitRepository = typeof raw.repositoryId === 'string' ? raw.repositoryId : null;
  const eventRepository = explicitRepository ?? repositoryId;
  if (eventRepository !== repositoryId || (!explicitRepository && missionId && !missionIds.has(missionId))) { return null; }
  const mapping = historyKind(entry.eventType);
  if (!mapping) { return null; }
  const sourceId = typeof raw.sourceId === 'string' ? raw.sourceId
    : typeof raw.occurrenceId === 'string' ? raw.occurrenceId
      : entry.id ?? recoveryIdentity(mapping.source, [entry.eventType, entry.createdAt, missionId, entry.eventData]);
  return record(mapping.source, mapping.kind, [repositoryId, entry.eventType, entry.id ?? sourceId], entry.createdAt,
    { repositoryId, missionId, revision: typeof raw.revision === 'string' ? raw.revision : null, pullRequest: null },
    `operational_history/${entry.eventType}/${sourceId}`, raw);
}

const HISTORY_KINDS: Readonly<Record<string, { source: StatsRecoverySource; kind: StatsRecoveryFactKind }>> = {
  'rebound.repair': { source: 'rebound-repair', kind: 'repair-attempt' },
  'integration.integration-validation': { source: 'validation', kind: 'validation-result' },
  'integration.integration-validation-failed': { source: 'validation', kind: 'validation-result' },
  'flow.rebase': { source: 'workflow-run', kind: 'workflow-telemetry' },
};

function historyKind(eventType: string): { source: StatsRecoverySource; kind: StatsRecoveryFactKind } | null {
  // Verification attempts already belong to the measured verification owner.
  // Recovery admits only the historical source contracts named here.
  return HISTORY_KINDS[eventType] ?? null;
}

function record(source: StatsRecoverySource, kind: StatsRecoveryFactKind,
  identityParts: readonly (string | number | null | undefined)[], at: string,
  links: StatsRecoveryEvidence['links'], provenance: string,
  raw: Readonly<Record<string, unknown>>): StatsRecoveryEvidence {
  const observedAt = recoveryInstant(at);
  return { identity: recoveryIdentity(source, identityParts), source, kind, observedAt, links,
    provenance, collectionEra: observedAt < HISTORICAL_MEASUREMENT_CUTOFF ? 'historical-reconstruction' : 'measured-workflow',
    classification: 'direct-observation', raw };
}
