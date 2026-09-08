import type { AgentAvailability, AgentFamily } from '../../domain/agents.js';
import type { Mission, MissionId, MissionStatus } from '../../domain/mission.js';
import type { RepositoryId } from '../../domain/repository.js';
import type { Review, ReviewedRevision } from '../../domain/review.js';
import type { SourceFact } from '../contracts.js';
import type { BoardProjection, BoardMetrics, MetricsProvenance, StatisticsHealth } from './board.js';
import { buildBoardMetrics, buildBoardProjection } from './board.js';
import {
  projectMissionCard,
  type CommandAvailability,
  type MissionCard,
  type MissionOperationalFacts,
} from './mission-board.js';
import type { MetricsReadAdapter } from './metrics-read-adapter.js';
import { countUnattributedSessions, projectAgentAvailability, type RunningAgentSession } from './agent-status.js';
import {
  CURRENT_WORK_TTL_MS,
  reconcileCurrentWork,
  type CurrentWorkFacts,
  type CurrentWorkReadAdapter,
  type ProcessLivenessProbe,
} from './current-work.js';

export type { CurrentWorkReadAdapter, ProcessLivenessProbe } from './current-work.js';

// ---------------------------------------------------------------------------
// Read adapters — each adapter reads from one authority
// ---------------------------------------------------------------------------

/** Read adapter for mission data from target repository or operator cache. */
export interface MissionReadAdapter {
  /** Load all missions for the repository. Returns source facts for rebuildability. */
  loadAllMissions(): Promise<readonly Mission[]>;
  /** Load a single mission by ID. */
  loadMission(_id: MissionId): Promise<Mission | null>;
  /** Source facts describing the freshness of the read. */
  getSourceFacts(): readonly SourceFact<string>[];
}

/** Read adapter for review state from Git-owned review artifacts. */
export interface ReviewReadAdapter {
  /** Load review and approval facts for the complete board mission set. */
  loadReviews(_missionIds: readonly MissionId[]): Promise<ReadonlyMap<MissionId, ReviewProjectionFact>>;
}

export interface ReviewProjectionFact {
  readonly review: Review | null;
  readonly approval: { subject: ReviewedRevision; approvedAt: string | null } | null;
}

/** Read adapter for gate state from integration pipeline results. */
export interface GateReadAdapter {
  /** Load the latest gate status for a mission. */
  loadGateStatus(_missionId: MissionId): Promise<'passed' | 'failed' | 'running' | 'unknown'>;
}

export type { RunningAgentSession } from './agent-status.js';

/** Read adapter for agent availability from operator-local state. */
export interface AgentReadAdapter {
  /** Load agent availability for all configured agents. */
  loadAgentAvailability(): Promise<readonly AgentAvailability[]>;
  /** Load the agent assigned to a mission (from mission assignee or selection policy). */
  loadAssignedAgent(_missionId: MissionId): Promise<AgentFamily | null>;
  /**
   * Load the currently running agent sessions, or `null` when liveness cannot
   * be determined. Adapters that cannot observe running processes omit this
   * method; the board then reports the running count as unknown, never zero.
   */
  loadRunningSessions?(): Promise<readonly RunningAgentSession[] | null>;
}

/** Read adapter for Git state (current branch, HEAD, etc.). */
export interface GitReadAdapter {
  /** Load repository identity from Git config. */
  loadRepositoryId(): Promise<RepositoryId>;
  /** Load Git HEAD commit for staleness checking. */
  loadHeadCommit(): Promise<string>;
}

/** Read adapter for operation log from operator-local event history. */
export interface OperationLogReadAdapter {
  /** Load recent operation log entries. */
  loadOperationLog(): Promise<readonly { readonly operationId: string; readonly phase: string; readonly message: string; readonly timestamp: string; readonly agent?: string }[]>;
}

// Re-export MetricsReadAdapter for consumers
export type { MetricsReadAdapter } from './metrics-read-adapter.js';

// ---------------------------------------------------------------------------
// BoardProjectionBuilder — composes read adapters into BoardProjection
// ---------------------------------------------------------------------------

export interface BoardProjectionOptions {
  /** Creates the ephemeral shared read snapshot immediately before each build. */
  prepareReads?: () => void;
  /** Time-based metrics. Prefer MetricsReadAdapter for production use. */
  metrics?: BoardMetrics;
  /** Derives metrics from board_lane_events + usage_statistics. */
  metricsAdapter?: MetricsReadAdapter;
  /**
   * The current-work authority. Omitted means no operation publishes to this
   * board, so every mission's current work is simply unrecorded — which the
   * reconciler reports as absent, never as "known idle".
   */
  currentWork?: CurrentWorkReadAdapter;
  /**
   * Bounded recovery evidence for a published `running` fact. Omitting it
   * makes unverifiable facts age out on the freshness window alone.
   */
  isProcessAlive?: ProcessLivenessProbe;
  /** Freshness window for an unverifiable running fact. */
  currentWorkTtlMs?: number;
  /** Clock seam; defaults to the wall clock. */
  now?: () => number;
}

/** A mission that published no current-work fact at all. */
const NO_CURRENT_WORK: CurrentWorkFacts = { currentWork: null, blockingReason: null };

/**
 * Builds a BoardProjection by reading from multiple authority adapters.
 * Git and canonical task/mission documents always win over cached projections.
 */
export class BoardProjectionBuilder {
  private metricsCache: { readonly key: string; readonly metrics: BoardMetrics } | null = null;
  constructor(
    private readonly _missions: MissionReadAdapter,
    private readonly _reviews: ReviewReadAdapter,
    private readonly _gates: GateReadAdapter,
    private readonly _agents: AgentReadAdapter,
    private readonly _git: GitReadAdapter,
    private readonly _operationLog: OperationLogReadAdapter,
    private readonly _options?: BoardProjectionOptions,
  ) {}

  /** Build the full BoardProjection from all authority adapters. */
  async build(): Promise<BoardProjection> {
    this._options?.prepareReads?.();
    const [repositoryId, missions, operationLog, agentAvailability, runningSessions, currentWorkEvents] = await Promise.all([
      this._git.loadRepositoryId(),
      this._missions.loadAllMissions(),
      this._operationLog.loadOperationLog(),
      this._agents.loadAgentAvailability(),
      this._agents.loadRunningSessions?.() ?? Promise.resolve(null),
      this._options?.currentWork?.loadCurrentWork() ?? Promise.resolve([]),
    ]);

    const sourceFacts = this._missions.getSourceFacts();
    const reviews = await this._reviews.loadReviews(missions.map((mission) => mission.id));

    // The authoritative answer to "what is being worked on right now?". It is
    // reconciled once per build so every card sees the same clock reading.
    const currentWorkByMission = reconcileCurrentWork(currentWorkEvents, {
      nowMs: (this._options?.now ?? Date.now)(),
      ttlMs: this._options?.currentWorkTtlMs ?? CURRENT_WORK_TTL_MS,
      isProcessAlive: this._options?.isProcessAlive,
    });

    // Bounded recovery only. The published current-work fact above is the
    // board's authority for who is working; this process scan is consulted by
    // `agentIsWorking` solely for missions that recorded no fact at all.
    const sessionByMission: Map<MissionId, RunningAgentSession> = new Map(
      (runningSessions ?? []).map((session) => [session.missionId, session]),
    );

    // Build mission cards with operational facts
    const cards = await Promise.all(missions.map(async (mission) => this.composeCard(
      mission,
      reviews.get(mission.id) ?? { review: null, approval: null },
      await this._gates.loadGateStatus(mission.id),
      currentWorkByMission.get(mission.id) ?? NO_CURRENT_WORK,
      runningSessions === null ? undefined : sessionByMission.get(mission.id) ?? null,
    )));

    // Build available actions from application policy
    const availableActions = this.deriveAvailableActions(cards);

    // Build metrics from event history (or use provided/default)
    const metrics = {
      ...await this.buildMetrics(
        repositoryId,
        missions,
        projectAgentAvailability(agentAvailability, Date.now(), runningSessions),
      ),
      unattributedRunningSessions: countUnattributedSessions(runningSessions),
    };

    return buildBoardProjection(
      repositoryId,
      cards,
      availableActions,
      operationLog,
      metrics,
      sourceFacts,
    );
  }

  /**
   * Project one mission's card without assembling the board around it.
   *
   * `px status <slug>` asks about a single mission, so it reads that mission,
   * its review facts and its gate — never `loadAllMissions()`, the operation
   * log, board metrics or the agent availability matrix, none of which appear
   * in a single mission's card. Interpretation stays in `projectMissionCard`,
   * shared with `build()`, so a focused status answer cannot drift away from
   * the board's own reading of the same mission.
   *
   * Current work is read for this mission only and reconciled exactly as in
   * `build()`. Running sessions remain one repository-wide recovery query.
   *
   * Returns `null` when the mission does not exist.
   */
  async buildMissionCard(missionId: MissionId): Promise<MissionCard | null> {
    this._options?.prepareReads?.();
    const mission = await this._missions.loadMission(missionId);
    if (mission === null) { return null; }

    const [reviews, gateStatus, runningSessions, currentWorkEvents] = await Promise.all([
      this._reviews.loadReviews([mission.id]),
      this._gates.loadGateStatus(mission.id),
      this._agents.loadRunningSessions?.() ?? Promise.resolve(null),
      this._options?.currentWork?.loadMissionCurrentWork?.(mission.id) ?? Promise.resolve([]),
    ]);

    const work = reconcileCurrentWork(currentWorkEvents, {
      nowMs: (this._options?.now ?? Date.now)(),
      ttlMs: this._options?.currentWorkTtlMs ?? CURRENT_WORK_TTL_MS,
      isProcessAlive: this._options?.isProcessAlive,
    }).get(mission.id) ?? NO_CURRENT_WORK;

    const liveSession = runningSessions === null
      ? undefined
      : (runningSessions ?? []).find((session) => session.missionId === mission.id) ?? null;

    return this.composeCard(
      mission,
      reviews.get(mission.id) ?? { review: null, approval: null },
      gateStatus,
      work,
      liveSession,
    );
  }

  /** The single place operational facts become a card, shared by both routes. */
  private composeCard(
    mission: Mission,
    reviewFact: ReviewProjectionFact,
    latestGate: 'passed' | 'failed' | 'running' | 'unknown',
    work: CurrentWorkFacts,
    // `undefined` when the process scan itself could not run: that is
    // "liveness unknown", which must not collapse into the observed
    // "nothing running" that `null` means.
    liveSession: RunningAgentSession | null | undefined,
  ): MissionCard {
    const facts: MissionOperationalFacts = {
      latestGate,
      reviewApproval: reviewFact.approval,
      currentWork: work.currentWork,
      liveSession,
      blockingReason: work.blockingReason,
      flags: [],
    };
    return projectMissionCard({ ...mission, review: reviewFact.review }, facts);
  }

  /**
   * Derive metrics from event history, provided metrics, or defaults.
   * Priority: explicit metrics > MetricsReadAdapter > default fallback.
   */
  private async buildMetrics(
    repositoryId: RepositoryId,
    missions: readonly Mission[],
    agentAvailability: BoardMetrics['agentAvailability'],
  ): Promise<BoardMetrics> {
    // Cache key depends only on facts that actually change slow metrics.
    // agentAvailability carries volatile fields (blockedForMs) that change
    // every refresh while an AgentBlock is active — those must not invalidate
    // expensive historical cycle-time/throughput computation (TASK-2375 AC #23).
    const key = JSON.stringify(
      missions.map((mission) => [mission.id, mission.status]),
    );
    if (this.metricsCache?.key === key) {
      // Cache hit: reuse slow metrics, swap in fresh agent availability
      return { ...this.metricsCache.metrics, agentAvailability };
    }
    // Explicit metrics (for testing/fixtures)
    if (this._options?.metrics) {
      this.metricsCache = { key, metrics: this._options.metrics };
      return this._options.metrics;
    }

    // Derive from event history via MetricsReadAdapter
    if (this._options?.metricsAdapter) {
      const initialStates = new Map<MissionId, MissionStatus>();
      for (const mission of missions) {
        initialStates.set(mission.id, mission.status);
      }
      try {
        const metrics = await this._options.metricsAdapter.buildMetrics(initialStates, agentAvailability);
        this.metricsCache = { key, metrics };
        return metrics;
      } catch {
        const metrics = this.metricsWithHealth(this.defaultMetrics(agentAvailability), {
          state: 'unavailable',
        }, {
          repositoryId,
          evaluatedWindow: { startedAt: null, endedAt: null },
          sampleSize: 0,
          newestEventTimestamp: null,
          rejectedOrMissingIdentityRowCount: 0,
          adapterSucceeded: false,
        });
        this.metricsCache = { key, metrics };
        return metrics;
      }
    }

    const metrics = this.defaultMetrics(agentAvailability);
    this.metricsCache = { key, metrics };
    return metrics;
  }

  /** Derive available actions from mission cards' command availability. */
  private deriveAvailableActions(cards: readonly MissionCard[]): readonly CommandAvailability[] {
    // Aggregate command availability across all missions
    const commandMap = new Map<string, { enabled: boolean; reason: string | null; count: number }>();
    for (const card of cards) {
      for (const cmd of card.commands) {
        const existing = commandMap.get(cmd.command);
        if (!existing) {
          commandMap.set(cmd.command, { enabled: cmd.enabled, reason: cmd.reason, count: 1 });
        } else {
          existing.count += 1;
          if (cmd.enabled) { existing.enabled = true; existing.reason = null; }
        }
      }
    }
    return [...commandMap.entries()].map(([command, info]) => ({
      command: command as CommandAvailability['command'],
      enabled: info.enabled,
      reason: info.reason,
    }));
  }

  /** Default metrics with skip fallback (no event history available). */
  private defaultMetrics(agentAvailability: BoardMetrics['agentAvailability']): BoardMetrics {
    return buildBoardMetrics({
      cumulativeFlow: { series: [], missingHistoryFallback: 'skip' },
      cumulativeFlowByState: { series: [], missingHistoryFallback: 'skip' },
      medianStateTimes: { series: [], missingHistoryFallback: 'skip' },
      medianCycleTimeByState: { series: [], missingHistoryFallback: 'skip' },
      throughput: { series: [], missingHistoryFallback: 'skip' },
      reviewBounceRate: { series: [], missingHistoryFallback: 'skip' },
      medianAgeByLane: { series: [], missingHistoryFallback: 'skip' },
      agentAvailability,
      bottleneck: {
        sentence: 'Bottleneck unavailable: history is missing.',
        inputs: { lane: null, medianAgeMinutes: null, reviewBounceRate: null },
      },
    });
  }

  private metricsWithHealth(metrics: BoardMetrics, health: StatisticsHealth, provenance: MetricsProvenance): BoardMetrics {
    return { ...metrics, health, provenance };
  }
}

// ---------------------------------------------------------------------------
// Rebuildability — detect when Git facts differ from cached projection
// ---------------------------------------------------------------------------

/**
 * Check if a cached projection needs rebuilding by comparing Git HEAD.
 * Returns fresh when Git HEAD matches the cached projection's HEAD,
 * stale when Git HEAD has advanced, or unavailable when Git is not accessible.
 */
export function checkProjectionStaleness(
  cachedHead: string | null,
  currentHead: string,
): SourceFact<string> {
  if (!cachedHead) {
    return { source: 'git', status: 'stale', value: currentHead };
  }
  if (cachedHead === currentHead) {
    return { source: 'git', status: 'fresh', value: currentHead };
  }
  return { source: 'git', status: 'stale', value: currentHead };
}
