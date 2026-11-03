import { reviewStatistics } from './services/review-statistics.js';
import type { ApplicationOutcome, Cancellation, Capability } from './contracts.js';
import { failure, rejected } from './contracts.js';
import type { ProgressPort, StatsBackfillPort, StatsProjection } from './ports.js';

export interface StatsBackfillRequest {
  readonly operationId: string;
  readonly apply: boolean;
  readonly capabilities: ReadonlySet<Capability>;
  readonly cancellation?: Cancellation;
}

export class StatsBackfillService {
  constructor(private readonly _port: StatsBackfillPort, private readonly _progress?: ProgressPort) {}

  async execute(request: StatsBackfillRequest): Promise<ApplicationOutcome<StatsProjection>> {
    if (!request.operationId) {return rejected('validation', 'operationId is required');}
    if (request.apply && !request.capabilities.has('stats:apply')) {return rejected('capability', 'stats:apply capability is required');}
    if (request.cancellation?.requested) {return failure('cancelled', 'cancelled before reading projection');}
    this.emit(request.operationId, 1, 'read', 'reading stats projection');
    try {
      const projection = await this._port.readProjection();
      if (!request.apply) {return { status: 'completed', value: projection, durableEvidence: [] };}
      if (request.cancellation?.requested) {return failure('cancelled', 'cancelled before applying rows');}
      this.emit(request.operationId, 2, 'apply', 'applying stats rows');
      const evidence = await this._port.applyRows(projection.rows);
      return { status: 'completed', value: projection, durableEvidence: evidence };
    } catch (error) {
      return failure('unavailable', error instanceof Error ? error.message : 'stats dependency unavailable');
    }
  }

  private emit(operationId: string, sequence: number, phase: string, message: string) {
    this._progress?.({ operationId, sequence, phase, message, timestamp: new Date().toISOString() });
  }
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
      rows.push({ ...row, pr_fix_rounds: rollup ? info.prFixRounds : null });
    }
    if (!rollups.length) {
      rows.push({ repo: mission.repositoryId, mission: mission.id, date: mission.closedAt.slice(0, 10),
        stage: 'default', implementer: info.implementer,
        classification: mission.labels.find(label => label === 'ai_sdlc' || label === 'user_value') ?? 'unknown',
        pr_fix_rounds: info.prFixRounds });
    }
    changes.push({ mission: mission.id,
      before: rollups.map(storedCount),
      beforeObserved: rollups.some(row => storedCount(row) !== null),
      after: info.prFixRounds, byImplementer: info.byImplementer,
      causes: info.obligations.map(obligation => obligation.cause) });
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
  if (info.prFixRounds === null || Object.values(info.byImplementer).some(count => count === null)) {
    return { slug: mission.id, reason: 'incomplete-cause-or-authorship', prFixRounds: info.prFixRounds };
  }
  return undefined;
}

function isIntegrationObservation(row: import('./services/statistics-row.js').StatsRow): boolean {
  return (row.stage || 'default') === 'default';
}
