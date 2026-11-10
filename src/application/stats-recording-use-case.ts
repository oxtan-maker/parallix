import type { StatisticsRecordingPort, StatisticsWriteResult } from './ports/statistics-recording.js';
import { providerResourceObservation, type ProviderResourceObservation } from './run-history-types.js';
import {
  canonicalizeStatsRow, sameStatsIdentity, accumulateIntegerStrings, quotaUsageLevel,
  accumulateDecimalStrings, mergeLabel, type StatsRow,
} from './services/statistics-row.js';
import { reviewStatistics } from './services/review-statistics.js';
import type { StatsReportSelection } from './services/statistics-report-selection.js';
import type { ReviewStatistics } from './services/review-statistics.js';
import { selectStatsReport } from './services/statistics-report-selection.js';

export interface StageStatsRequest {
  readonly runId?: string;
  readonly slug: string;
  readonly stage: string;
  readonly date: string;
  readonly implementer?: string;
  readonly reviewer?: string;
  readonly telemetry?: ProviderResourceObservation | null;
  readonly durationMinutes?: number;
}

/** Telemetry field mapping is pure and shared with compatibility consumers. */
function observationValue(observation: ProviderResourceObservation | null, name: string): number | undefined {
  return observation?.values.find(value => value.name === name)?.value;
}

function telemetryUsageFields(observation: ProviderResourceObservation | null) {
  const quota = quotaUsageLevel(observationValue(observation, 'provider-usage'));
  const value = (name: string) => {
    const observed = observationValue(observation, name);
    return observed === undefined ? undefined : String(observed);
  };
  return {
    input_tokens: value('input'),
    output_tokens: value('output'),
    cached_tokens: value('cached'),
    thoughts_tokens: value('reasoning'),
    context_tokens: value('context'),
    tool_calls: value('tool-calls'),
    openai_usage_before: undefined,
    openai_usage_after: quota === null ? undefined : String(Math.round(quota)),
    openai_usage_delta: undefined,
  };
}

export function telemetryToStatsFields(
  telemetry: ProviderResourceObservation | Record<string, unknown> | null | undefined,
  options: { durationMinutes?: number } = {},
) {
  const observation = providerResourceObservation(telemetry);
  const duration = options.durationMinutes;
  return {
    provider: observation?.provider || '',
    model: observation?.model || '',
    ...telemetryUsageFields(observation),
    duration_minutes: typeof duration === 'number' && Number.isFinite(duration) && duration >= 0
      ? String(Math.round(duration)) : undefined,
    cost_usd: observationValue(observation, 'cost')?.toString(),
  };
}

/** Application owner of synchronous stage writes and asynchronous integration writes. */
export class StatsRecordingUseCase {
  constructor(private readonly _port: StatisticsRecordingPort) {}

  recordStage(request: StageStatsRequest): StatisticsWriteResult {
    return this._port.upsert(this.stageRow(request, 'recordStageStats'));
  }

  accumulateStage(request: StageStatsRequest): StatisticsWriteResult {
    const incoming = this.stageRow(request, 'accumulateStageStats');
    const existing = this._port.readMeasurements().find(row => sameStatsIdentity(row, incoming));
    return this._port.upsert(existing ? mergeStageRows(existing, incoming) : incoming);
  }

  recordActive(request: Omit<StageStatsRequest, 'stage'> & { readonly stage?: string }) {
    return this.recordStage({
      ...request, stage: request.stage ?? 'active',
    });
  }

  recordReview(request: Omit<StageStatsRequest, 'stage'> & { readonly stage?: string }) {
    return this.recordStage({
      ...request, stage: request.stage ?? 'review',
    });
  }

  async recordIntegration(request: { readonly slug: string; readonly date: string }): Promise<StatisticsWriteResult & {
    readonly selection?: StatsReportSelection<StatsRow>;
    readonly reportError?: string;
    readonly metadataSource: { readonly classification: string; readonly implementer: ReviewStatistics['source'] };
  }> {
    if (!request.slug) { throw new Error('recordIntegrationStats requires a mission slug.'); }
    const classification = await this._port.readStoredClassification(request.slug);
    const review = await this._port.readReview(request.slug);
    const info = reviewStatistics(review, await this._port.readReviewEvidence(request.slug, review));
    const result = this._port.upsert({
      date: request.date, repo: this._port.repositoryName, mission: request.slug, classification,
      implementer: info.implementer,
      pr_fix_rounds: info.total === null ? undefined : String(info.total),
    });
    // A failed history read cannot roll back the already-persisted measurement.
    try {
      const missionFlow = await this._port.readMissionFlow();
      return {
        ...result, selection: selectStatsReport(result.data.rows, missionFlow, { mode: 'weekly', today: request.date }),
        metadataSource: { classification: 'mission-aggregate', implementer: info.source },
      };
    } catch (error) {
      return {
        ...result, reportError: error instanceof Error ? error.message : String(error),
        metadataSource: { classification: 'mission-aggregate', implementer: info.source },
      };
    }
  }

  private stageRow(request: StageStatsRequest, operation: string): StatsRow {
    if (!request.slug) { throw new Error(`${operation} requires a mission slug.`); }
    if (!request.stage) { throw new Error(`${operation} requires a stage.`); }
    const { classification, error } = this._port.readClassification(request.slug);
    if (!classification) {
      throw new Error(`Cannot record stage stats for ${request.slug}: ${error || 'missing classification'}`);
    }
    return canonicalizeStatsRow({
      date: request.date, repo: this._port.repositoryName, mission: request.slug, classification,
      runId: request.runId,
      implementer: request.implementer,
      implementer_agent: request.implementer || '', reviewer_agent: request.reviewer || '', stage: request.stage,
      ...telemetryToStatsFields(request.telemetry, { durationMinutes: request.durationMinutes }),
    });
  }
}

function observed(value: unknown): boolean {
  return value !== null && value !== undefined && String(value).trim() !== '';
}

function mergeObserved(existing: unknown, incoming: unknown, combine: (a: string, b: string) => string) {
  if (!observed(existing)) { return observed(incoming) ? String(incoming) : undefined; }
  if (!observed(incoming)) { return String(existing); }
  return combine(String(existing), String(incoming));
}

function mergeStageRows(existing: StatsRow, incoming: StatsRow): StatsRow {
  const merged = { ...existing, ...incoming,
    provider: mergeLabel(observed(existing.provider) ? String(existing.provider) : '',
      observed(incoming.provider) ? String(incoming.provider) : ''),
    // Identity includes the model, so a merged pair always shares one concrete model.
    model: existing.model, actorKey: existing.actorKey,
    cost_usd: mergeObserved(existing.cost_usd, incoming.cost_usd, accumulateDecimalStrings),
  };
  for (const key of [
    'input_tokens', 'output_tokens', 'cached_tokens', 'thoughts_tokens', 'context_tokens',
    'tool_calls', 'openai_usage_delta', 'duration_minutes',
  ] as const) {
    merged[key] = mergeObserved(existing[key], incoming[key], accumulateIntegerStrings);
  }
  merged.openai_usage_before = mergeObserved(existing.openai_usage_before, incoming.openai_usage_before,
    (a, b) => accumulateIntegerStrings(a, b, { mode: 'replace' }));
  merged.openai_usage_after = mergeObserved(existing.openai_usage_after, incoming.openai_usage_after,
    (a, b) => accumulateIntegerStrings(a, b, { mode: 'max' }));
  return merged;
}
