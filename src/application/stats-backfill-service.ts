import { createHash } from 'node:crypto';
import { reviewStatistics } from './services/review-statistics.js';
import type { ApplicationOutcome, Cancellation, Capability } from './contracts.js';
import { failure, rejected } from './contracts.js';
import type { ProgressPort, StatsBackfillPort, StatsProjection, StatsRecoveryTarget } from './ports.js';
import type { MeasurementRecord } from './measurement-ports.js';
import type { RunSummary } from './run-history.js';

export interface StatsBackfillRequest {
  readonly operationId: string;
  readonly apply: boolean;
  /** Recovery writes only to a consistent copy of operator state. */
  readonly isolatedCopy?: StatsRecoveryTarget;
  /** Exact operator-supplied measurement identities for the one-time recovery audit. */
  readonly measurementRecoveryInventory?: readonly StatsMeasurementRecoveryTarget[];
  readonly capabilities: ReadonlySet<Capability>;
  readonly cancellation?: Cancellation;
}

export class StatsBackfillService {
  constructor(private readonly _port: StatsBackfillPort, private readonly _progress?: ProgressPort) {}

  async execute(request: StatsBackfillRequest): Promise<ApplicationOutcome<StatsProjection>> {
    if (!request.operationId) {return rejected('validation', 'operationId is required');}
    if (request.apply && !request.capabilities.has('stats:apply')) {return rejected('capability', 'stats:apply capability is required');}
    if (request.apply && !request.isolatedCopy?.databasePath) {return rejected('validation', 'stats recovery apply requires an isolated consistent database copy');}
    const target = request.isolatedCopy && { databasePath: request.isolatedCopy.databasePath, materialize: request.apply };
    if (request.cancellation?.requested) {return failure('cancelled', 'cancelled before reading projection');}
    this.emit(request.operationId, 1, 'read', 'reading stats projection');
    try {
      const projection = await this._port.readProjection(target, request.measurementRecoveryInventory);
      if (!request.apply) {return { status: 'completed', value: projection, durableEvidence: [] };}
      if (request.cancellation?.requested) {return failure('cancelled', 'cancelled before applying rows');}
      this.emit(request.operationId, 2, 'apply', 'applying stats rows');
      const evidence = await this._port.applyProjection(projection, target);
      return { status: 'completed', value: projection, durableEvidence: evidence };
    } catch (error) {
      return failure('unavailable', error instanceof Error ? error.message : 'stats dependency unavailable');
    }
  }

  private emit(operationId: string, sequence: number, phase: string, message: string) {
    this._progress?.({ operationId, sequence, phase, message, timestamp: new Date().toISOString() });
  }
}

export interface StatsMeasurementRunEvidence {
  readonly runId: string;
  readonly sha256: string;
  readonly observedAt: string;
  readonly provenance: 'retained-native-run';
}

export interface StatsMeasurementRecoveryItem {
  readonly identity: string;
  readonly original: MeasurementRecord;
  readonly evidence: StatsMeasurementRunEvidence | null;
  readonly proposed: MeasurementRecord | null;
  readonly disposition: 'correction' | 'verified' | 'gap' | 'conflict';
  readonly gaps: readonly string[];
  readonly conflicts: readonly string[];
}

export interface StatsMeasurementRecoveryReport {
  readonly inventory: readonly StatsMeasurementRecoveryItem[];
  readonly summary: { readonly candidates: number; readonly corrections: number; readonly verified: number;
    readonly gaps: number; readonly conflicts: number };
}

/** A frozen measurement identity supplied at the CLI boundary, never inferred from task names. */
export interface StatsMeasurementRecoveryTarget {
  readonly mission: string;
  readonly actorKey: string;
}

type RecoveryRuns = ReadonlyMap<string, readonly RunSummary[] | string>;
type ProviderObservation = NonNullable<NonNullable<RunSummary['record']['resources']>['provider']>;

interface RetainedRunMatch {
  readonly run: RunSummary['record'];
  readonly evidence: StatsMeasurementRunEvidence;
}

/**
 * Audit only the exact identities in an operator-supplied frozen inventory.
 * Task-name predicates, dates, configured models and neighboring rows are never
 * selection evidence.
 */
export function buildMeasurementRecoveryReport(records: readonly MeasurementRecord[], runs: RecoveryRuns,
  targets: readonly StatsMeasurementRecoveryTarget[]): StatsMeasurementRecoveryReport {
  const byIdentity = new Map(records.filter(record => record.stage === 'review')
    .map(record => [measurementTargetIdentity(record), record]));
  const inventory = targets.map(target => {
    const record = byIdentity.get(measurementTargetIdentity(target));
    if (!record) {
      throw new Error(`Frozen measurement recovery target is unavailable: ${target.mission}/${JSON.stringify(target.actorKey)}`);
    }
    return recoverMeasurement(record, runs.get(record.mission));
  });
  return { inventory, summary: {
    candidates: inventory.length,
    corrections: inventory.filter(item => item.disposition === 'correction').length,
    verified: inventory.filter(item => item.disposition === 'verified').length,
    gaps: inventory.filter(item => item.disposition === 'gap').length,
    conflicts: inventory.filter(item => item.disposition === 'conflict').length,
  } };
}

export function measurementCorrectionIdentity(item: StatsMeasurementRecoveryItem): string {
  return `stats-measurement-correction:${createHash('sha256').update(JSON.stringify([
    item.identity, item.evidence?.sha256 ?? null, item.original, item.proposed,
  ])).digest('hex')}`;
}

function recoverMeasurement(record: MeasurementRecord, result: readonly RunSummary[] | string | undefined): StatsMeasurementRecoveryItem {
  const identity = measurementIdentity(record);
  const match = retainedRunMatch(identity, record, result);
  if ('disposition' in match) { return match; }
  const attributionConflict = retainedRunAttributionConflict(record, match.run);
  if (attributionConflict) { return conflict(identity, record, match.evidence, attributionConflict); }
  const observation = match.run.resources?.provider;
  if (!observation) {
    return gap(identity, record, match.evidence, `provider observation unavailable for retained native run ${record.runId}`);
  }
  return recoverObservedMeasurement(identity, record, match.evidence, observation);
}

function retainedRunMatch(identity: string, record: MeasurementRecord,
  result: readonly RunSummary[] | string | undefined): RetainedRunMatch | StatsMeasurementRecoveryItem {
  if (!record.runId) { return gap(identity, record, null, 'missing exact run link; mission/date matching is forbidden'); }
  if (typeof result === 'string') { return gap(identity, record, null, result); }
  const exact = result?.filter(run => run.record.runId === record.runId) ?? [];
  if (exact.length === 0) { return gap(identity, record, null, `retained native run ${record.runId} is unavailable`); }
  if (exact.length > 1) { return conflict(identity, record, null, `duplicate retained native run ${record.runId}`); }
  const run = exact[0].record;
  return { run, evidence: runEvidence(run) };
}

function retainedRunAttributionConflict(record: MeasurementRecord, run: RunSummary['record']): string | null {
  if (run.missionId !== record.mission || run.role !== 'review') {
    return `run attribution is ${run.missionId}/${run.role}, not ${record.mission}/review`;
  }
  if (record.reviewer_agent && run.family !== record.reviewer_agent) {
    return `run reviewer family is ${run.family}, not ${record.reviewer_agent}`;
  }
  return null;
}

function recoverObservedMeasurement(identity: string, record: MeasurementRecord, evidence: StatsMeasurementRunEvidence,
  observation: ProviderObservation): StatsMeasurementRecoveryItem {
  const fields = observedMeasurementFields(observation);
  const proposed: MeasurementRecord = { ...record };
  const conflicts: string[] = [];
  let changed = false;
  for (const [field, observed] of Object.entries(fields) as [keyof MeasurementRecord, string | number][]) {
    const current = record[field];
    if (current === observed) { continue; }
    if (current === undefined || replaceableFabrication(record, field, current)) {
      (proposed as unknown as Record<string, unknown>)[field] = observed;
      changed = true;
    } else {
      conflicts.push(`${String(field)} retained=${String(current)} observed=${String(observed)}`);
    }
  }
  if (conflicts.length > 0) { return { identity, original: record, evidence, proposed: null,
    disposition: 'conflict', gaps: [], conflicts }; }
  return { identity, original: record, evidence, proposed: changed ? proposed : null,
    disposition: changed ? 'correction' : 'verified', gaps: [], conflicts: [] };
}

function measurementIdentity(record: MeasurementRecord): string {
  return [record.repo, record.mission, record.stage, record.actorKey].join('\u001f');
}

function measurementTargetIdentity(target: StatsMeasurementRecoveryTarget | MeasurementRecord): string {
  return [target.mission, target.actorKey].join('\u001f');
}

function runEvidence(run: RunSummary['record']): StatsMeasurementRunEvidence {
  return { runId: run.runId, sha256: createHash('sha256').update(JSON.stringify(run)).digest('hex'),
    observedAt: run.endedAt ?? run.startedAt, provenance: 'retained-native-run' };
}

function observedMeasurementFields(observation: ProviderObservation): Partial<MeasurementRecord> {
  const names: Readonly<Record<string, keyof MeasurementRecord>> = {
    input: 'input_tokens', output: 'output_tokens', cached: 'cached_tokens', reasoning: 'thoughts_tokens',
    context: 'context_tokens', 'tool-calls': 'tool_calls', 'provider-usage': 'openai_usage_after', cost: 'cost_usd',
  };
  const fields: Partial<MeasurementRecord> = {};
  if (observation.provider) { (fields as Record<string, unknown>).provider = observation.provider; }
  if (observation.model) { (fields as Record<string, unknown>).model = observation.model; }
  for (const value of observation.values) {
    const field = names[value.name];
    if (field) { (fields as Record<string, unknown>)[field] = value.value; }
  }
  return fields;
}

function replaceableFabrication(record: MeasurementRecord, field: keyof MeasurementRecord, current: unknown): boolean {
  if ((field === 'provider' || field === 'model') && record.reviewer_agent
    && ['custom', 'codex', 'claude'].includes(String(current))) { return true; }
  return typeof current === 'number' && current === 0;
}

function gap(identity: string, original: MeasurementRecord, evidence: StatsMeasurementRunEvidence | null,
  detail: string): StatsMeasurementRecoveryItem {
  return { identity, original, evidence, proposed: null, disposition: 'gap', gaps: [detail], conflicts: [] };
}

function conflict(identity: string, original: MeasurementRecord, evidence: StatsMeasurementRunEvidence | null,
  detail: string): StatsMeasurementRecoveryItem {
  return { identity, original, evidence, proposed: null, disposition: 'conflict', gaps: [], conflicts: [detail] };
}

/** Rebuild measurements from retained Mission authority, never from previous counts. */
export function reconstructReviewMeasurements(missions: readonly import('../domain/mission.js').Mission[],
  existing: readonly import('./services/statistics-row.js').StatsRow[],
  evidence: ReadonlyMap<string, import('./services/review-statistics.js').ReviewStatisticsEvidence> = new Map()): StatsProjection {
  const rows: import('./services/statistics-row.js').StatsRow[] = [];
  const unresolved: import('./ports.js').StatsBackfillUnresolved[] = [];
  const skipped: import('./ports.js').StatsBackfillSkipped[] = [];
  const changes: import('./ports.js').StatsReconstructionChange[] = [];
  for (const mission of missions) {
    if (mission.status !== 'done') { skipped.push({ slug: mission.id, reason: `status=${mission.status}` }); continue; }
    const prior = existing.filter(row => row.mission === mission.id && row.repo === mission.repositoryId);
    const info = reviewStatistics(mission.review, evidence.get(mission.id));
    if (!mission.closedAt) { unresolved.push({ slug: mission.id, reason: 'missing-closure' }); continue; }
    const issue = reconstructionIssue(mission, info);
    if (issue) { unresolved.push(issue); }
    const rollups = prior.filter(isIntegrationObservation);
    for (const row of prior) {
      const rollup = isIntegrationObservation(row);
      rows.push({ ...row, pr_fix_rounds: rollup ? info.total : null });
    }
    if (!rollups.length) {
      rows.push({ repo: mission.repositoryId, mission: mission.id, date: mission.closedAt.slice(0, 10),
        stage: 'default', implementer: info.implementer,
        classification: mission.labels.find(label => label === 'ai_sdlc' || label === 'user_value') ?? 'unknown',
        pr_fix_rounds: info.total });
    }
    changes.push({ mission: mission.id,
      before: rollups.map(storedCount),
      beforeObserved: rollups.some(row => storedCount(row) !== null),
      after: info.total, byImplementer: info.byImplementer, returns: info.returns });
  }
  const knownIds = new Set(missions.map(mission => String(mission.id)));
  for (const row of existing) {
    if (row.mission && !knownIds.has(row.mission)) {
      if (!unresolved.some(item => item.slug === row.mission)) { unresolved.push({ slug: row.mission, reason: 'missing-mission-history' }); }
    }
  }
  return { rows, unresolved, skipped, changes,
    sources: [{ source: 'stats', status: 'fresh', value: 'retained Mission Review reconstruction' }] };
}

function storedCount(row: import('./services/statistics-row.js').StatsRow): number | null {
  return row.pr_fix_rounds === undefined || row.pr_fix_rounds === null ? null : Number(row.pr_fix_rounds);
}
function reconstructionIssue(mission: import('../domain/mission.js').Mission,
  info: import('./services/review-statistics.js').ReviewStatistics): import('./ports.js').StatsBackfillUnresolved | undefined {
  if (!mission.review) { return { slug: mission.id, reason: 'missing-review-history' }; }
  if (info.total === null) {
    return { slug: mission.id, reason: 'incomplete-return-evidence', prFixRounds: info.total };
  }
  return undefined;
}

function isIntegrationObservation(row: import('./services/statistics-row.js').StatsRow): boolean {
  return (row.stage || 'default') === 'default';
}
