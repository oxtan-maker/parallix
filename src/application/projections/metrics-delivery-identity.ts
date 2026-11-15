// Contract: the identity behind the historical analytics cache key. It answers
// "is the cached summary still current?" from the durable facts the summary is
// derived from, so a warm board build never re-serializes whole history rows.
import { createHash } from 'node:crypto';

import type { UsageRecord } from '../ports/mission-measurements.js';
import type { MissionId } from '../../domain/mission.js';

/** One completed delivery as the analytics identity records it. */
export interface DeliveryIdentity {
  readonly missionId: MissionId;
  readonly closedAt: string;
}

/** The only lane-event fact the identity reads: when the transition happened. */
export interface LaneInstant {
  readonly occurredAt: string;
}

/**
 * Compact identity for the durable evidence the historical summary is derived
 * from. Lane events are append-only, so lane row count plus the newest stored
 * instant moves whenever new evidence lands; the derived delivery pairs and the
 * per-row measurement identity move when a retained row is rewritten in place.
 * Hashing every lane row's JSON paid to re-serialize payload text the identity
 * never reads, on every board build.
 */
export function deliveryIdentityRevision(
  entries: readonly LaneInstant[],
  usageRecords: readonly UsageRecord[],
  deliveries: readonly DeliveryIdentity[],
  evidenceRevision: string,
): string {
  return createHash('sha256').update(JSON.stringify([
    entries.length, newestInstant(entries, entry => entry.occurredAt),
    usageIdentity(usageRecords),
    deliveries.map(delivery => [delivery.missionId, delivery.closedAt]),
    evidenceRevision,
  ])).digest('hex');
}

/** Text columns of a usage row that the historical summary reports. */
const USAGE_TEXT_COLUMNS = [
  'date', 'mission', 'classification', 'implementer', 'implementer_agent',
  'reviewer_agent', 'stage', 'provider', 'model',
] as const satisfies readonly (keyof UsageRecord)[];

/** Measurement columns of a usage row that the historical summary reports. */
const USAGE_MEASURE_COLUMNS = [
  'duration_minutes', 'input_tokens', 'output_tokens', 'cached_tokens', 'context_tokens',
  'tool_calls', 'openai_usage_before', 'openai_usage_after', 'openai_usage_delta', 'cost_usd',
] as const satisfies readonly (keyof UsageRecord)[];

/**
 * The measurement facts the historical summary reports, one compact tuple per
 * usage row in stored order.
 *
 * `SqliteMeasurementStore` rewrites a retained row in place on
 * `(repo, mission, stage, actor_key)`, so a corrected run changes neither the
 * row count nor the newest date: count and date alone let a cached summary keep
 * reporting the superseded runtime, cost and token totals as fresh. Naming each
 * consumed column moves the identity when any measurement the summary reads
 * moves, and leaves the row's unconsumed columns out of the hash.
 *
 * A present-empty text column is a different fact from an absent one: the
 * summary reports an empty `provider` or `model` as a measured value and a
 * missing one as unavailable, so the identity keeps them apart instead of
 * normalising both to the same tuple slot.
 */
function usageIdentity(records: readonly UsageRecord[]): readonly unknown[] {
  return [
    records.length, newestInstant(records, record => record.date ?? ''),
    records.map(record => [
      ...USAGE_TEXT_COLUMNS.map(column => record[column] ?? null),
      ...USAGE_MEASURE_COLUMNS.map(column => record[column] ?? null),
    ]),
  ];
}

/** The usage columns the delivery identity is sensitive to, for contract tests. */
export const USAGE_IDENTITY_COLUMNS: readonly string[] = [
  ...USAGE_TEXT_COLUMNS, ...USAGE_MEASURE_COLUMNS,
];

/** Newest parseable instant; rows may store offsets or bare dates. */
function newestInstant<Row>(rows: readonly Row[], instantOf: (row: Row) => string): number {
  let newest = 0;
  for (const row of rows) {
    const at = Date.parse(instantOf(row));
    if (Number.isFinite(at) && at > newest) { newest = at; }
  }
  return newest;
}
