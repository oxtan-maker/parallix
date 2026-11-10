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
  readonly model?: string | null;
}

/** Telemetry field mapping is pure and shared with compatibility consumers. */
function observationValue(observation: ProviderResourceObservation | null, name: string): number | undefined {
  return observation?.values.find(value => value.name === name)?.value;
}

function telemetryUsageFields(observation: ProviderResourceObservation | null) {
  const quota = quotaUsageLevel(observationValue(observation, 'provider-usage'));
  return {
    input_tokens: String(observationValue(observation, 'input') || 0),
    output_tokens: String(observationValue(observation, 'output') || 0),
    cached_tokens: String(observationValue(observation, 'cached') || 0),
    thoughts_tokens: String(observationValue(observation, 'reasoning') || 0),
    context_tokens: String(observationValue(observation, 'context') || 0),
    tool_calls: String(observationValue(observation, 'tool-calls') || 0),
    openai_usage_before: '0',
    openai_usage_after: quota === null ? '' : String(Math.round(quota)),
    openai_usage_delta: '0',
  };
}

export function telemetryToStatsFields(
  telemetry: ProviderResourceObservation | Record<string, unknown> | null | undefined,
  options: { agentFamily?: string; durationMinutes?: number; model?: string | null } = {},
) {
  const { agentFamily, durationMinutes = 0, model } = options;
  const observation = providerResourceObservation(telemetry, { provider: model || agentFamily, model: model || agentFamily });
  return {
    provider: observation?.provider || model || agentFamily || '',
    model: observation?.model || model || agentFamily || '',
    ...telemetryUsageFields(observation),
    duration_minutes: String(Math.max(0, Math.round(durationMinutes) || 0)),
    cost_usd: String(observationValue(observation, 'cost') ?? 0),
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
      implementer: request.implementer || request.reviewer,
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
    const agentFamily = request.implementer || request.reviewer || 'unknown';
    return canonicalizeStatsRow({
      date: request.date, repo: this._port.repositoryName, mission: request.slug, classification,
      runId: request.runId,
      implementer: agentFamily,
      implementer_agent: request.implementer || '', reviewer_agent: request.reviewer || '', stage: request.stage,
      ...telemetryToStatsFields(request.telemetry, { agentFamily, durationMinutes: request.durationMinutes, model: request.model }),
    });
  }
}

function mergeStageRows(existing: StatsRow, incoming: StatsRow): StatsRow {
  const merged = { ...existing, ...incoming,
    provider: mergeLabel(String(existing.provider), String(incoming.provider)),
    // Identity includes the model, so a merged pair always shares one concrete model.
    model: existing.model, actorKey: existing.actorKey,
    cost_usd: accumulateDecimalStrings(String(existing.cost_usd), String(incoming.cost_usd)),
  };
  for (const key of [
    'input_tokens', 'output_tokens', 'cached_tokens', 'thoughts_tokens', 'context_tokens',
    'tool_calls', 'openai_usage_delta', 'duration_minutes',
  ] as const) {
    merged[key] = accumulateIntegerStrings(String(existing[key]), String(incoming[key]));
  }
  merged.openai_usage_before = accumulateIntegerStrings(String(existing.openai_usage_before), String(incoming.openai_usage_before), { mode: 'replace' });
  merged.openai_usage_after = !existing.openai_usage_after && !incoming.openai_usage_after ? ''
    : accumulateIntegerStrings(String(existing.openai_usage_after), String(incoming.openai_usage_after), { mode: 'max' });
  return merged;
}
