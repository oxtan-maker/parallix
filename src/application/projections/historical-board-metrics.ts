import { decisionWindowDay, localReportingTimeZone } from '../../domain/decision-window.js';
import type { Mission, MissionId, MissionStatus } from '../../domain/mission.js';
import type { RepositoryId } from '../../domain/repository.js';
import { buildBoardMetrics, type BoardMetrics, type HistoricalAnalyticsState } from './board.js';
import type { MetricsReadAdapter } from './metrics-read-adapter.js';

interface HistoricalBoardMetricsOptions {
  readonly metrics?: BoardMetrics;
  readonly metricsAdapter?: MetricsReadAdapter;
  readonly now?: () => number;
  readonly historicalRefreshTimeoutMs?: number;
}

interface HistoricalBoardMetricsRead {
  readonly repositoryId: RepositoryId;
  readonly missions: readonly Mission[];
  readonly agentAvailability: BoardMetrics['agentAvailability'];
  readonly nowMs: number;
  readonly deliveries: ReadonlyMap<MissionId, string>;
  readonly evidenceRevision: string | null;
}

interface HistoricalRefresh {
  readonly key: string;
  readonly adapter: MetricsReadAdapter;
  readonly initialStates: ReadonlyMap<MissionId, MissionStatus>;
  readonly input: HistoricalBoardMetricsRead;
}

const REFRESH_RETRY_MS = 30_000;

/** Owns the one refreshable historical summary used by current board reads. */
export class HistoricalBoardMetrics {
  private cache: { readonly key: string; readonly metrics: BoardMetrics; readonly refreshedAt: string } | null = null;
  private refresh: { readonly key: string; readonly startedAtMs: number; readonly controller: AbortController } | null = null;
  private queued: HistoricalRefresh | null = null;
  private completion: Promise<void> = Promise.resolve();
  private failure: { readonly key: string; readonly reason: string; readonly retryAtMs: number } | null = null;

  constructor(private readonly options: HistoricalBoardMetricsOptions = {}) {}

  /** Stop background reconstruction when the owning projection host closes. */
  cancelPendingRefresh(): void {
    const active = this.refresh;
    this.refresh = null;
    this.queued = null;
    active?.controller.abort();
  }

  async build(input: HistoricalBoardMetricsRead, settle = false): Promise<BoardMetrics> {
    const key = this.key(input);
    const cached = this.freshCache(key, input);
    if (cached) { return cached; }
    if (this.options.metrics) { return this.fixedMetrics(key, input, this.options.metrics); }

    const adapter = this.options.metricsAdapter;
    if (!adapter) {
      return this.withAnalytics(this.defaults(input.agentAvailability), {
        freshness: 'unavailable', revision: input.evidenceRevision, refreshedAt: null,
        reason: 'Historical analytics are not configured.',
      });
    }

    const initialStates = new Map(input.missions.map(mission => [mission.id, mission.status] as const));
    if (!adapter.readDeliveryIdentity) { return this.legacy(key, adapter, initialStates, input); }
    return this.refreshable(key, adapter, initialStates, input, settle);
  }

  private async refreshable(
    key: string,
    adapter: MetricsReadAdapter,
    initialStates: ReadonlyMap<MissionId, MissionStatus>,
    input: HistoricalBoardMetricsRead,
    settle: boolean,
  ): Promise<BoardMetrics> {
    if (input.evidenceRevision === null) { return this.missingIdentity(input); }
    if (this.retryIsDelayed(key, input.nowMs)) { return this.failedRefresh(input, key); }

    const pending = this.start(key, adapter, initialStates, input);
    if (settle) {
      await this.settle(pending, key);
      return this.build(input);
    }
    if (this.cache) { return this.staleCache(input, key); }
    return this.unavailable(
      input,
      this.failure?.key === key ? this.failure.reason : 'Historical analytics refresh is in progress.',
    );
  }

  private key(input: HistoricalBoardMetricsRead): string {
    const timeZone = localReportingTimeZone();
    return JSON.stringify([
      timeZone,
      decisionWindowDay(new Date(input.nowMs), timeZone),
      input.evidenceRevision,
      input.missions.map(mission => [
        mission.id, mission.status, mission.labels, mission.assignee, mission.netEngineeringLines,
        mission.review, mission.checkpoints, input.deliveries.get(mission.id),
      ]),
    ]);
  }

  private freshCache(key: string, input: HistoricalBoardMetricsRead): BoardMetrics | null {
    if (this.cache?.key !== key) { return null; }
    return this.withAnalytics({ ...this.cache.metrics, agentAvailability: input.agentAvailability }, {
      freshness: 'fresh', revision: input.evidenceRevision,
      refreshedAt: this.cache.refreshedAt, reason: null,
    });
  }

  private fixedMetrics(key: string, input: HistoricalBoardMetricsRead, metrics: BoardMetrics): BoardMetrics {
    const refreshedAt = new Date(input.nowMs).toISOString();
    this.cache = { key, metrics, refreshedAt };
    return this.withAnalytics(metrics, {
      freshness: 'fresh', revision: input.evidenceRevision, refreshedAt, reason: null,
    });
  }

  private missingIdentity(input: HistoricalBoardMetricsRead): BoardMetrics {
    if (!this.cache) { return this.unavailable(input, 'Delivery identity is unavailable.'); }
    return this.withAnalytics({ ...this.cache.metrics, agentAvailability: input.agentAvailability }, {
      freshness: 'stale', revision: null, refreshedAt: this.cache.refreshedAt,
      reason: 'Delivery identity is unavailable; showing the last historical summary.',
    });
  }

  private retryIsDelayed(key: string, nowMs: number): boolean {
    return this.failure?.key === key && nowMs < this.failure.retryAtMs;
  }

  private failedRefresh(input: HistoricalBoardMetricsRead, key: string): BoardMetrics {
    const reason = this.failure?.key === key ? this.failure.reason : 'Historical analytics refresh failed.';
    if (!this.cache) { return this.unavailable(input, reason); }
    return this.withAnalytics({ ...this.cache.metrics, agentAvailability: input.agentAvailability }, {
      freshness: 'stale', revision: input.evidenceRevision, refreshedAt: this.cache.refreshedAt, reason,
    });
  }

  private staleCache(input: HistoricalBoardMetricsRead, key: string): BoardMetrics {
    const cache = this.cache;
    if (!cache) { return this.unavailable(input, 'Historical analytics refresh is in progress.'); }
    return this.withAnalytics({ ...cache.metrics, agentAvailability: input.agentAvailability }, {
      freshness: 'stale', revision: input.evidenceRevision, refreshedAt: cache.refreshedAt,
      reason: this.failure?.key === key
        ? this.failure.reason
        : 'Durable analytics evidence changed; refresh is in progress.',
    });
  }

  private async settle(pending: Promise<void>, key: string): Promise<void> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([
      pending,
      new Promise<void>(resolve => {
        timer = setTimeout(() => {
          if (this.refresh?.key === key) {
            this.failure = {
              key,
              reason: 'Historical analytics are unavailable: refresh deadline exceeded.',
              retryAtMs: (this.options.now?.() ?? Date.now()) + REFRESH_RETRY_MS,
            };
            this.refresh.controller.abort();
          }
          resolve();
        }, this.options.historicalRefreshTimeoutMs ?? REFRESH_RETRY_MS);
      }),
    ]);
    if (timer) { clearTimeout(timer); }
  }

  private start(
    key: string,
    adapter: MetricsReadAdapter,
    initialStates: ReadonlyMap<MissionId, MissionStatus>,
    input: HistoricalBoardMetricsRead,
  ): Promise<void> {
    const request = { key, adapter, initialStates, input };
    if (this.refresh) {
      this.queued = this.refresh.key === key ? null : request;
      if (input.nowMs - this.refresh.startedAtMs >= REFRESH_RETRY_MS) {
        this.queued = request;
        this.refresh.controller.abort();
      }
      return this.completion;
    }
    return this.launch(request);
  }

  private launch(request: HistoricalRefresh): Promise<void> {
    const controller = new AbortController();
    const active = { key: request.key, startedAtMs: request.input.nowMs, controller };
    this.refresh = active;
    this.completion = request.adapter.buildMetrics(
      request.initialStates,
      request.input.agentAvailability,
      { signal: controller.signal },
    ).then(metrics => {
      if (this.refresh === active) {
        this.cache = {
          key: request.key,
          metrics,
          refreshedAt: new Date(this.options.now?.() ?? Date.now()).toISOString(),
        };
        this.failure = null;
      }
    }, (error: unknown) => {
      if (this.refresh === active && !controller.signal.aborted) {
        this.failure = {
          key: request.key,
          reason: `Historical analytics are unavailable: ${error instanceof Error ? error.message : String(error)}`,
          retryAtMs: (this.options.now?.() ?? Date.now()) + REFRESH_RETRY_MS,
        };
      }
    }).finally(() => {
      if (this.refresh !== active) { return; }
      this.refresh = null;
      const queued = this.queued;
      this.queued = null;
      if (queued && this.cache?.key !== queued.key) { void this.launch(queued); }
    });
    return this.completion;
  }

  private async legacy(
    key: string,
    adapter: MetricsReadAdapter,
    initialStates: ReadonlyMap<MissionId, MissionStatus>,
    input: HistoricalBoardMetricsRead,
  ): Promise<BoardMetrics> {
    try {
      const metrics = await adapter.buildMetrics(initialStates, input.agentAvailability);
      const refreshedAt = new Date(input.nowMs).toISOString();
      this.cache = { key, metrics, refreshedAt };
      return this.withAnalytics(metrics, {
        freshness: 'fresh', revision: input.evidenceRevision, refreshedAt, reason: null,
      });
    } catch (error: unknown) {
      return this.unavailable(
        input,
        `Historical analytics are unavailable: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private unavailable(input: HistoricalBoardMetricsRead, reason: string): BoardMetrics {
    const metrics = {
      ...this.defaults(input.agentAvailability),
      health: { state: 'unavailable' as const },
      provenance: {
        repositoryId: input.repositoryId,
        evaluatedWindow: { startedAt: null, endedAt: null },
        sampleSize: 0,
        newestEventTimestamp: null,
        rejectedOrMissingIdentityRowCount: 0,
        adapterSucceeded: false,
      },
    };
    return this.withAnalytics(metrics, {
      freshness: 'unavailable', revision: input.evidenceRevision, refreshedAt: null, reason,
    });
  }

  private defaults(agentAvailability: BoardMetrics['agentAvailability']): BoardMetrics {
    return buildBoardMetrics({
      cumulativeFlow: skip(), cumulativeFlowByState: skip(), medianStateTimes: skip(),
      medianCycleTimeByState: skip(), throughput: skip(), reviewBounceRate: skip(),
      medianAgeByLane: { series: [], missingHistoryFallback: 'skip' }, agentAvailability,
      bottleneck: {
        sentence: 'Bottleneck unavailable: history is missing.',
        inputs: { lane: null, medianAgeMinutes: null, reviewBounceRate: null },
      },
    });
  }

  private withAnalytics(metrics: BoardMetrics, analytics: HistoricalAnalyticsState): BoardMetrics {
    return { ...metrics, analytics };
  }
}

const skip = () => ({ series: [], missingHistoryFallback: 'skip' as const });
