import type { BoardLaneEventRepository } from '../../../application/ports/operation-history.js';
import type { UsageRepository } from '../../../application/ports/mission-measurements.js';
import {
  LOW_SAMPLE_THRESHOLD,
  compareCohorts,
  type CohortComparison,
  type CohortDimension,
} from '../../../application/projections/cohorts.js';
import { ConcreteMetricsReadAdapter } from '../../../application/projections/metrics-read-adapter.js';
import { ConcreteMissionReadAdapter } from '../../backlog/concrete-mission-read-adapter.js';
import type { MissionId } from '../../../domain/mission.js';
import type { MissionLabel } from '../../../domain/mission.js';
import type { AgentFamily } from '../../../domain/agents.js';
import type { MissionStatus } from '../../../domain/mission.js';
import type { MissionTransition } from '../../../domain/mission-workflow.js';
import { repositoryId as toRepositoryId, type RepositoryId } from '../../../domain/repository.js';
import { resolveCanonicalRepositoryId } from '../../git/repository-identity.js';
import { renderCohortComparison } from './cohort-report.js';
import * as fmt from '../../../application/presentation/cli-format.js';

// ---------------------------------------------------------------------------
// `px stats cohorts` — compare completed missions along one dimension
//
// A read-only report. It opens the measurement database the rest of `px stats`
// already treats as the authority, plus the lane-event history that owns the
// lifecycle facts (dwell and review bounces), and writes nothing.
// ---------------------------------------------------------------------------

const DIMENSIONS: readonly CohortDimension[] = ['label', 'implementer', 'model', 'provider'];

export interface StatsCohortsOptions {
  readonly log?: (_message: string) => unknown;
  readonly error?: (_message: string) => unknown;
  readonly exit?: (_code?: number) => unknown;
  readonly rootDir?: string;
  /** Injected by tests and by callers that already hold operator state. */
  readonly laneEventRepo?: BoardLaneEventRepository;
  readonly usageRepo?: UsageRepository;
  readonly repositoryId?: RepositoryId;
  /** Net engineering lines per mission, when the caller can supply them. */
  readonly netEngineeringLines?: ReadonlyMap<MissionId, number | null>;
  /** Canonical Mission metadata; injected by fast isolated tests. */
  readonly cohortMetadata?: () => Promise<ReadonlyMap<MissionId, { readonly labels: readonly MissionLabel[]; readonly assignee: AgentFamily | null }>>;
}

export function printCohortsUsage(log: (_message: string) => unknown = fmt.log.plain): void {
  log(`Usage: px stats cohorts [--by label|implementer|model|provider] [--min-sample <n>] [--repo <id>]

Examples:
  px stats cohorts
  px stats cohorts --by implementer
  px stats cohorts --by model --min-sample 8

Notes:
  - Groups completed missions by one experiment dimension and reports, per
    cohort, the sample size n, median and p75 cycle time, median dwell in
    active and review, review bounce rate, median fix rounds, and tokens,
    agent runtime, cost and net engineering lines per completed mission.
  - The review bounce rate counts recorded 'review -> active' lane
    transitions per mission that entered review. It is not pr_fix_rounds.
  - Every figure is printed beside its n. A cohort with fewer than
    ${LOW_SAMPLE_THRESHOLD} completed missions is marked ${'low-sample'} and is not a
    comparable result; --min-sample raises that threshold.
  - Read-only: the command writes nothing to the database.`);
}

interface ParsedCohortArgs {
  readonly dimension: CohortDimension;
  readonly lowSampleThreshold: number;
  readonly repositoryId: string | null;
  readonly help: boolean;
}

/** Parse the subcommand's flags, rejecting values the report cannot honour. */
export function parseCohortArgs(args: readonly string[]): ParsedCohortArgs {
  let dimension: CohortDimension = 'label';
  let lowSampleThreshold = LOW_SAMPLE_THRESHOLD;
  let repositoryId: string | null = null;
  let help = false;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--help' || arg === '-h') { help = true; continue; }
    if (arg === '--by' && index + 1 < args.length) {
      const value = String(args[index + 1]).trim().toLowerCase();
      if (!DIMENSIONS.includes(value as CohortDimension)) {
        throw new Error(`Unknown cohort dimension "${value}". Expected one of: ${DIMENSIONS.join(', ')}.`);
      }
      dimension = value as CohortDimension;
      index += 1;
      continue;
    }
    if (arg === '--min-sample' && index + 1 < args.length) {
      const value = Number.parseInt(String(args[index + 1]), 10);
      if (!Number.isFinite(value) || value < 1) {
        throw new Error(`Invalid --min-sample ${args[index + 1]}: expected a positive whole number.`);
      }
      lowSampleThreshold = value;
      index += 1;
      continue;
    }
    if (arg === '--repo' && index + 1 < args.length) {
      repositoryId = String(args[index + 1]);
      index += 1;
      continue;
    }
    if (arg?.startsWith('--')) {
      throw new Error(`Unknown option ${arg}. Run "px stats cohorts --help" for the accepted flags.`);
    }
  }

  return { dimension, lowSampleThreshold, repositoryId, help };
}

/**
 * Resolve the operator-state repositories from the shared SQLite connection.
 * Imported dynamically for the same reason the composition root does it: the
 * rollback bundle has no SQLite driver and must fail here, not at load time.
 */
export async function resolveOperatorRepositories(): Promise<{
  laneEventRepo: BoardLaneEventRepository;
  usageRepo: UsageRepository;
}> {
  const { initOperatorState } = await import('../../sqlite/adapter-factory.js');
  const { SqliteBoardLaneEventRepository } = await import('../../sqlite/board-lane-event-repository.js');
  const { SqliteUsageRepository } = await import('../../sqlite/usage-repository.js');
  const { db } = await initOperatorState();
  return {
    laneEventRepo: new SqliteBoardLaneEventRepository(db),
    usageRepo: new SqliteUsageRepository(db),
  };
}

/** Lane rows converted to the transitions the cohort metrics read. */
function entriesToTransitions(
  entries: readonly { missionId: string; fromStatus: string | null; toStatus: string; trigger: string; agent: string; occurredAt: string }[],
): readonly MissionTransition[] {
  return entries
    .filter((entry) => entry.missionId && entry.toStatus && entry.trigger)
    .map((entry) => ({
      missionId: entry.missionId as MissionId,
      // Null stays null: it is the mission's intake, not a missing lane.
      from: (entry.fromStatus ?? null) as MissionStatus | null,
      to: entry.toStatus as MissionStatus,
      trigger: entry.trigger as MissionTransition['trigger'],
      actor: entry.agent,
      occurredAt: entry.occurredAt,
    }));
}

/** Build the comparison for one repository from lane and usage history. */
export async function buildCohortComparison(options: {
  readonly laneEventRepo: BoardLaneEventRepository;
  readonly usageRepo: UsageRepository;
  readonly repositoryId: RepositoryId;
  readonly dimension: CohortDimension;
  readonly lowSampleThreshold: number;
  readonly netEngineeringLines?: ReadonlyMap<MissionId, number | null>;
  readonly cohortMetadata?: () => Promise<ReadonlyMap<MissionId, { readonly labels: readonly MissionLabel[]; readonly assignee: AgentFamily | null }>>;
}): Promise<CohortComparison> {
  const adapter = new ConcreteMetricsReadAdapter({
    laneEventRepo: options.laneEventRepo,
    usageRepo: options.usageRepo,
    repositoryId: options.repositoryId,
    cohortMetadata: options.cohortMetadata,
  });
  const [outcomes, entries] = await Promise.all([
    adapter.readOutcomes(),
    options.laneEventRepo.findByRepositoryId(options.repositoryId),
  ]);
  return compareCohorts({
    outcomes,
    transitions: entriesToTransitions(entries),
    dimension: options.dimension,
    lowSampleThreshold: options.lowSampleThreshold,
    netEngineeringLines: options.netEngineeringLines,
  });
}

/** `px stats cohorts` entry point. */
export async function statsCohorts(
  args: readonly string[],
  options: StatsCohortsOptions = {},
): Promise<void> {
  const log = options.log ?? fmt.log.plain;
  const error = options.error ?? fmt.log.plainError;
  const exit = options.exit ?? process.exit;
  const rootDir = options.rootDir ?? process.cwd();

  let parsed: ParsedCohortArgs;
  try {
    parsed = parseCohortArgs(args);
  } catch (failure) {
    error(fmt.status('FAIL', failure instanceof Error ? failure.message : String(failure)));
    exit(1);
    return;
  }

  if (parsed.help) {
    printCohortsUsage(log);
    return;
  }

  try {
    const repositories = options.laneEventRepo && options.usageRepo
      ? { laneEventRepo: options.laneEventRepo, usageRepo: options.usageRepo }
      : await resolveOperatorRepositories();
    // `--repo` is an explicit operator choice. With no override the identity
    // comes from the canonical owner, never from `rootDir`: run from a mission
    // worktree, the path itself matches no persisted row.
    const repositoryId = options.repositoryId
      ?? (parsed.repositoryId === null
        ? resolveCanonicalRepositoryId(rootDir)
        : toRepositoryId(parsed.repositoryId));
    const cohortMetadata = options.cohortMetadata ?? (() => {
      const missions = new ConcreteMissionReadAdapter({ rootDir, repositoryId });
      return missions.loadAllMissions().then((loaded) => new Map(
        loaded.map((mission) => [mission.id, { labels: mission.labels, assignee: mission.assignee }]),
      ));
    });
    const comparison = await buildCohortComparison({
      ...repositories,
      repositoryId,
      dimension: parsed.dimension,
      lowSampleThreshold: parsed.lowSampleThreshold,
      netEngineeringLines: options.netEngineeringLines,
      cohortMetadata,
    });
    log(renderCohortComparison(comparison));
  } catch (failure) {
    error(fmt.status('FAIL', failure instanceof Error ? failure.message : String(failure)));
    exit(1);
  }
}

export default statsCohorts;
