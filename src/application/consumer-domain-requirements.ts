// Checked consumer → domain-concept requirement mapping (TASK-2322.02, CP 1).
//
// Purpose: prove, in checked TypeScript rather than prose, that every current
// launch, retry, failover, usage/statistics, review, and UI/board consumer
// reads information that an existing `src/domain` concept already carries.
// ADR 0053 excludes `Attempt`; this mapping is the consumer evidence that
// exclusion is re-tested against, and `test/domain-consumer-requirements.test.ts`
// fails if a family disappears, names a concept that does not exist in
// `src/domain`, or cites a source location that no longer matches.
//
// This module is data plus types only. It performs no IO, holds no runtime
// behavior, and must not be imported by a production command: it exists so the
// mapping is type-checked and testable, not to change what any consumer does.

import type { AgentBlock } from '../domain/agents.js';
import type { LaneTransitionEvent } from '../domain/board-event.js';
import type { CheckpointData } from '../domain/checkpoint.js';
import type { Mission } from '../domain/mission.js';
import type { KnownRepository } from '../domain/repository.js';
import type { Review } from '../domain/review.js';
import type { SessionMarker } from '../domain/session.js';
import type { AgentRunMeasurement, MissionOutcome } from '../domain/usage.js';

/**
 * Type-level witness that every name in `DomainConceptName` resolves to a real
 * exported `src/domain` type. Deleting or renaming a domain type breaks `tsc`
 * here, so the mapping cannot name a concept the domain does not have.
 */
interface DomainConceptTypes {
  readonly Mission: Mission;
  readonly CheckpointData: CheckpointData;
  readonly Review: Review;
  readonly MissionOutcome: MissionOutcome;
  readonly AgentRunMeasurement: AgentRunMeasurement;
  readonly KnownRepository: KnownRepository;
  readonly SessionMarker: SessionMarker;
  readonly LaneTransitionEvent: LaneTransitionEvent;
  readonly AgentBlock: AgentBlock;
}

/** The nine domain concepts a consumer may declare that it reads. */
export type DomainConceptName = keyof DomainConceptTypes;

/**
 * Runtime companion to `DomainConceptName`.
 *
 * Persistence checks use this same catalog instead of restating every
 * inventory-entry-to-concept pair already present in the executable inventory.
 */
export const DOMAIN_CONCEPT_NAMES = [
  'Mission',
  'CheckpointData',
  'Review',
  'MissionOutcome',
  'AgentRunMeasurement',
  'KnownRepository',
  'SessionMarker',
  'LaneTransitionEvent',
  'AgentBlock',
] as const satisfies readonly DomainConceptName[];

/** The six consumer families TASK-2322.02 traces. */
export type ConsumerFamily =
  | 'launch'
  | 'retry'
  | 'failover'
  | 'usage-statistics'
  | 'review'
  | 'ui-board';

export const CONSUMER_FAMILIES: readonly ConsumerFamily[] = [
  'launch',
  'retry',
  'failover',
  'usage-statistics',
  'review',
  'ui-board',
] as const;

/**
 * How far a consumer's notion of "this particular agent launch" travels.
 *
 * - `none`: the consumer never distinguishes one launch from another.
 * - `in-process`: launch bookkeeping lives in local variables for the duration
 *   of one call and is never persisted or re-read.
 * - `durable-idempotency-key`: a durable opaque token exists solely so a repeat
 *   of the same work is not double-counted. It has no lifecycle, no stable
 *   identity across families, and no consumer that resolves it back to a launch.
 *
 * Only a `durable-entity` value would demand an `Attempt` domain model; no
 * current consumer carries one, which is the CP 1 branch decision.
 */
export type PerLaunchIdentityUse = 'none' | 'in-process' | 'durable-idempotency-key';

/** One traced consumer: where it reads, what it reads, and why. */
export interface ConsumerRequirement {
  /** Stable identifier for this consumer entry. */
  readonly id: string;
  /** Consumer family this entry belongs to. */
  readonly family: ConsumerFamily;
  /** Repo-relative file of the checked production source that reads the data. */
  readonly fileLocation: string;
  /** 1-indexed line in `fileLocation` that the citation anchors to. */
  readonly line: number;
  /** Substring that must appear on `fileLocation:line`; keeps the citation honest. */
  readonly anchor: string;
  /** Domain concepts this consumer reads. */
  readonly reads: readonly DomainConceptName[];
  /** The domain information the consumer actually requires. */
  readonly requirement: string;
  /** Whether the consumer needs to tell one launch from another, and how far. */
  readonly perLaunchIdentity: PerLaunchIdentityUse;
}

/**
 * Every traced consumer for the six families.
 *
 * Read this as the answer to "what would break if a domain concept were
 * removed?" — not as a list of every call site.
 */
export const CONSUMER_DOMAIN_REQUIREMENTS: readonly ConsumerRequirement[] = [
  // -----------------------------------------------------------------------
  // launch — choosing an agent family and deciding fresh-vs-resume
  // -----------------------------------------------------------------------
  {
    id: 'launch-agent-selection',
    family: 'launch',
    fileLocation: 'src/platform/runtime/lib/agents/launcher-selection.ts',
    line: 150,
    anchor: 'function selectAgent',
    reads: ['AgentBlock'],
    requirement:
      'Which configured families are eligible for a step and which are currently blocked; selection is a pure read over eligibility plus block state.',
    perLaunchIdentity: 'none',
  },
  {
    id: 'launch-blocklist-filter',
    family: 'launch',
    fileLocation: 'src/platform/runtime/lib/agents/launcher-selection.ts',
    line: 137,
    anchor: 'isAgentBlocked',
    reads: ['AgentBlock'],
    requirement:
      'The durable operator-local block per agent family, with its expiry, so an expired block stops excluding the family.',
    perLaunchIdentity: 'none',
  },
  {
    id: 'launch-session-resume',
    family: 'launch',
    fileLocation: 'src/platform/runtime/lib/agents/agents.ts',
    line: 380,
    anchor: 'await launchSessionMarkerPort.shouldResume(',
    reads: ['SessionMarker', 'Mission'],
    requirement:
      'Whether the previous launch for this (mission, role) used the same agent family, so the family-specific resume flag may be passed.',
    perLaunchIdentity: 'none',
  },
  {
    id: 'launch-session-marker-write',
    family: 'launch',
    fileLocation: 'src/platform/runtime/lib/agents/agents.ts',
    line: 589,
    anchor: 'await launchSessionMarkerPort.save({',
    reads: ['SessionMarker'],
    requirement:
      'One current marker per (mission, role) recording the family that last ran and its provider session id; a new launch replaces it rather than appending history.',
    perLaunchIdentity: 'none',
  },

  // -----------------------------------------------------------------------
  // retry — relaunching after a failed or non-productive run
  // -----------------------------------------------------------------------
  {
    id: 'retry-in-process-tried-set',
    family: 'retry',
    fileLocation: 'src/platform/runtime/lib/agents/agents.ts',
    line: 271,
    anchor: 'const tried = new Set(',
    reads: ['AgentBlock'],
    requirement:
      'Which families this call has already exhausted. The tried set, per-agent errors, and iteration counter are local variables of one startAgent call; nothing persists or re-reads them.',
    perLaunchIdentity: 'in-process',
  },
  {
    id: 'retry-launch-failure-reselect',
    family: 'retry',
    fileLocation: 'src/platform/runtime/lib/agents/agents.ts',
    line: 544,
    anchor: 'retrying with next eligible agent',
    reads: ['AgentBlock'],
    requirement:
      'That the current family failed, so the next eligible family is selected. The retry decision needs no record of the previous run beyond the in-call tried set.',
    perLaunchIdentity: 'in-process',
  },
  {
    id: 'retry-review-round-counters',
    family: 'retry',
    fileLocation: 'src/platform/runtime/lib/review/review-commands.ts',
    line: 980,
    anchor: 'state.reviewerRetryCount',
    reads: ['Review'],
    requirement:
      'Retry counts scoped to the current review round, displayed by review status. They are round attributes, not per-launch records: the next round resets them.',
    perLaunchIdentity: 'none',
  },
  {
    id: 'retry-stage-launch-dedupe',
    family: 'retry',
    fileLocation: 'src/platform/runtime/lib/review/review-loop.ts',
    line: 63,
    anchor: 'function stageLaunchFingerprint',
    reads: ['AgentRunMeasurement', 'Review'],
    requirement:
      'Whether the measurement for this stage/family launch was already accumulated. The durable value is an opaque fingerprint kept in review-state metadata (bounded to the last 20 per stage window); no consumer resolves it back to a launch.',
    perLaunchIdentity: 'durable-idempotency-key',
  },

  // -----------------------------------------------------------------------
  // failover — moving work to another family after a limit or crash
  // -----------------------------------------------------------------------
  {
    id: 'failover-limit-hit-block',
    family: 'failover',
    fileLocation: 'src/platform/runtime/lib/agents/agents.ts',
    line: 486,
    anchor: 'await updateAgentBlockFn(chosen',
    reads: ['AgentBlock'],
    requirement:
      'The reset estimate and reason for a provider usage limit, written as a time-bounded block so later selections skip the family until it expires.',
    perLaunchIdentity: 'none',
  },
  {
    id: 'failover-transient-failure-block',
    family: 'failover',
    fileLocation: 'src/platform/runtime/lib/agents/agents.ts',
    line: 568,
    anchor: 'await updateAgentBlockFn(chosen',
    reads: ['AgentBlock'],
    requirement:
      'That a launch failure looked transient rather than a deterministic config error, so a bounded block is written instead of poisoning the family permanently.',
    perLaunchIdentity: 'none',
  },
  {
    id: 'failover-block-write',
    family: 'failover',
    fileLocation: 'src/platform/runtime/lib/agents/agent-config.ts',
    line: 159,
    anchor: 'function updateAgentBlock',
    reads: ['AgentBlock'],
    requirement:
      'Agent family, block expiry, and reason. The durable record is keyed by family alone — it carries no launch, mission, or session key.',
    perLaunchIdentity: 'none',
  },

  // -----------------------------------------------------------------------
  // usage / statistics — measured agent work and completed-mission reporting
  // -----------------------------------------------------------------------
  {
    id: 'usage-stats-row-columns',
    family: 'usage-statistics',
    fileLocation: 'src/platform/runtime/lib/commands/stats.ts',
    line: 108,
    anchor: 'const STATS_HEADERS',
    reads: ['AgentRunMeasurement'],
    requirement:
      'Recording date, repo, mission, stage, actor role and family, provider, model, token and tool-call counts, duration, and cost. There is no launch or attempt column.',
    perLaunchIdentity: 'none',
  },
  {
    id: 'usage-mission-key',
    family: 'usage-statistics',
    fileLocation: 'src/platform/runtime/lib/commands/stats.ts',
    line: 441,
    anchor: 'function statsMissionKey',
    reads: ['Mission', 'MissionOutcome'],
    requirement:
      'Measurement rows are grouped by (repo, mission) — the mission identity the domain already exposes. No grouping key identifies an individual launch.',
    perLaunchIdentity: 'none',
  },
  {
    id: 'usage-completed-statistics',
    family: 'usage-statistics',
    fileLocation: 'src/domain/usage.ts',
    line: 152,
    anchor: 'function completedMissionStatistics',
    reads: ['Mission', 'MissionOutcome', 'AgentRunMeasurement'],
    requirement:
      'A validated closed mission, its NEL and labels, the outcome cycle time and review fix rounds, and every run measurement, to derive the final implementer and model involvement.',
    perLaunchIdentity: 'none',
  },

  // -----------------------------------------------------------------------
  // review — the round conversation and its evidence
  // -----------------------------------------------------------------------
  {
    id: 'review-round-state',
    family: 'review',
    fileLocation: 'src/platform/runtime/lib/review/review-state.ts',
    line: 223,
    anchor: 'export class ReviewState',
    reads: ['Review', 'Mission'],
    requirement:
      'Current round number, reviewer and implementer assignment, phase, and disposition for the mission under review.',
    perLaunchIdentity: 'none',
  },
  {
    id: 'review-loop-round-progression',
    family: 'review',
    fileLocation: 'src/platform/runtime/lib/review/review-loop.ts',
    line: 512,
    anchor: 'function startReviewLoop',
    reads: ['Review', 'Mission'],
    requirement:
      'The reviewed revision, the reviewer decision for it, and the implementer response, so the next round opens against an exact revision rather than a mutable phase flag.',
    perLaunchIdentity: 'none',
  },
  {
    id: 'review-checkpoint-evidence',
    family: 'review',
    fileLocation: 'src/platform/runtime/lib/review/review-commands.ts',
    line: 407,
    anchor: 'findCheckpointsFn(missionDir)',
    reads: ['CheckpointData', 'Mission'],
    requirement:
      'Checkpoint presence and the final checkpoint Goal Check evidence for the mission, as replaceable checkpoint data keyed by name.',
    perLaunchIdentity: 'none',
  },

  // -----------------------------------------------------------------------
  // UI / board — projections rendered by the TUI and board readers
  // -----------------------------------------------------------------------
  {
    id: 'ui-board-card',
    family: 'ui-board',
    fileLocation: 'src/application/projections/mission-board.ts',
    line: 101,
    anchor: 'function projectMissionCard',
    reads: ['Mission', 'CheckpointData', 'Review'],
    requirement:
      'Mission lane, status, labels, assignee, latest checkpoint and its next-action text, and whether the approval names the currently reviewed revision. Live work is ephemeral operation progress, never durable state.',
    perLaunchIdentity: 'none',
  },
  {
    id: 'ui-mission-detail',
    family: 'ui-board',
    fileLocation: 'src/application/projections/mission-detail.ts',
    line: 22,
    anchor: 'function projectMissionDetail',
    reads: ['Mission', 'CheckpointData', 'Review', 'MissionOutcome'],
    requirement:
      'Checkpoints, current review round/status/findings, NEL, and completed statistics for one mission.',
    perLaunchIdentity: 'none',
  },
  {
    id: 'ui-agent-status',
    family: 'ui-board',
    fileLocation: 'src/application/projections/agent-status.ts',
    line: 12,
    anchor: 'function projectAgentAvailability',
    reads: ['AgentBlock'],
    requirement:
      'Per-family availability and the remaining block countdown, derived from the durable block plus observed launcher availability.',
    perLaunchIdentity: 'none',
  },
  {
    id: 'ui-repository-selector',
    family: 'ui-board',
    fileLocation: 'src/application/projections/repository-selector.ts',
    line: 3,
    anchor: 'function projectRepositorySelector',
    reads: ['KnownRepository'],
    requirement:
      'Repository identity and display name for the repository picker; no registry rules beyond identity exist today.',
    perLaunchIdentity: 'none',
  },
  {
    id: 'ui-lane-transition-history',
    family: 'ui-board',
    fileLocation: 'src/application/recording/board-event-recorder.ts',
    line: 34,
    anchor: 'append(event: LaneTransitionEvent)',
    reads: ['LaneTransitionEvent', 'Mission'],
    requirement:
      'Lane transitions with their trigger, actor, and time, recorded alongside the mission transition they describe and replayed only as history.',
    perLaunchIdentity: 'none',
  },
] as const;

/**
 * The CP 1 branch decision, recorded as checked data so CP 3 cannot silently
 * switch branches and so ADR 0053 can be asserted against it.
 *
 * `required: false` is justified by the `perLaunchIdentity` column above: no
 * consumer carries launch identity further than one `startAgent` call, except
 * a bounded opaque dedupe fingerprint that nothing resolves back to a launch.
 */
export interface PerLaunchIdentityDecision {
  readonly required: boolean;
  /** Consumer ids in `CONSUMER_DOMAIN_REQUIREMENTS` that carry the decision. */
  readonly evidence: readonly string[];
  readonly rationale: string;
}

export const PER_LAUNCH_IDENTITY_DECISION: PerLaunchIdentityDecision = {
  required: false,
  evidence: [
    'retry-in-process-tried-set',
    'retry-launch-failure-reselect',
    'retry-stage-launch-dedupe',
    'launch-session-marker-write',
    'failover-block-write',
    'usage-stats-row-columns',
    'usage-mission-key',
  ],
  rationale:
    'No current consumer requires durable per-launch identity or lifecycle. Retry and failover bookkeeping lives in local variables of one startAgent call; the only durable consequences of a launch are a family-keyed AgentBlock, one replaceable SessionMarker per (mission, role), and measurement rows grouped by (repo, mission). The single durable per-launch value is an opaque stats de-duplication fingerprint with no identity, lifecycle, or reader. ADR 0053 therefore keeps Attempt excluded, and TASK-2322.02 implements the not-required branch.',
} as const;

/** All consumers in one family. */
export function consumersForFamily(
  family: ConsumerFamily,
): readonly ConsumerRequirement[] {
  return CONSUMER_DOMAIN_REQUIREMENTS.filter((entry) => entry.family === family);
}

/** Every domain concept named by at least one traced consumer. */
export function conceptsReadByConsumers(): readonly DomainConceptName[] {
  const seen = new Set<DomainConceptName>();
  for (const entry of CONSUMER_DOMAIN_REQUIREMENTS) {
    for (const concept of entry.reads) {
      seen.add(concept);
    }
  }
  return [...seen];
}
