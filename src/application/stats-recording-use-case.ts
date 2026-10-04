import type { StatisticsRecordingPort, StatisticsWriteResult } from './ports/statistics-recording.js';
import {
  canonicalizeStatsRow, sameStatsIdentity, accumulateIntegerStrings,
  accumulateDecimalStrings, mergeLabel, type StatsRow,
} from './services/statistics-row.js';
import { reviewStatistics } from './services/review-statistics.js';
import type { StatsReportSelection } from './services/statistics-report-selection.js';
import type { ReviewStatistics } from './services/review-statistics.js';
import { selectStatsReport } from './services/statistics-report-selection.js';

export interface StageTelemetry {
  readonly provider?: string;
  readonly model?: string;
  readonly inputTokens?: number;
  readonly outputTokens?: number;
  readonly cachedTokens?: number;
  readonly thoughtsTokens?: number;
  readonly totalTokens?: number;
  readonly toolCalls?: number;
  readonly usagePercent?: number;
  readonly cost_usd?: number;
}

export interface StageStatsRequest {
  readonly slug: string;
  readonly stage: string;
  readonly date: string;
  readonly implementer?: string;
  readonly reviewer?: string;
  readonly prFixRounds?: string | null;
  readonly telemetry?: StageTelemetry | null;
  readonly durationMinutes?: number;
  readonly model?: string | null;
}

/** Telemetry field mapping is pure and shared with compatibility consumers. */
export function telemetryToStatsFields(
  telemetry: StageTelemetry | null | undefined,
  options: { agentFamily?: string; durationMinutes?: number; model?: string | null } = {},
) {
  const { agentFamily, durationMinutes = 0, model } = options;
  const t = telemetry;
  return {
    provider: t?.provider || model || agentFamily || '',
    model: t?.model || model || agentFamily || '',
    input_tokens: String(t?.inputTokens || 0),
    output_tokens: String(t?.outputTokens || 0),
    cached_tokens: String(t?.cachedTokens || 0),
    thoughts_tokens: String(t?.thoughtsTokens || 0),
    context_tokens: String(t?.totalTokens || 0),
    tool_calls: String(t?.toolCalls || 0),
    openai_usage_before: '0',
    openai_usage_after: String(typeof t?.usagePercent === 'number' ? Math.round(t.usagePercent) : 0),
    openai_usage_delta: '0',
    duration_minutes: String(Math.max(0, Math.round(durationMinutes) || 0)),
    cost_usd: String(typeof t?.cost_usd === 'number' ? t.cost_usd : 0),
  };
}

/** Application owner of synchronous stage writes and asynchronous integration writes. */
export class StatsRecordingUseCase {
  constructor(private readonly _port: StatisticsRecordingPort) {}

  defaultPrFixRounds(slug: string, provided?: string | null): string | undefined {
    if (provided !== undefined && provided !== null) { return provided; }
    if (!slug) { return undefined; }
    try {
      const recorded = this._port.readFixRoundHistory(slug)
        .filter(value => value !== null && value !== undefined)
        .map(value => Number.parseInt(String(value), 10) || 0);
      return recorded.length ? String(Math.max(...recorded)) : undefined;
    } catch { return undefined; }
  }

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
      prFixRounds: this.defaultPrFixRounds(request.slug, request.prFixRounds),
    });
  }

  recordReview(request: Omit<StageStatsRequest, 'stage'> & { readonly stage?: string }) {
    return this.recordStage({
      ...request, stage: request.stage ?? 'review',
      implementer: request.implementer || request.reviewer,
      prFixRounds: this.defaultPrFixRounds(request.slug, request.prFixRounds),
    });
  }

  async recordIntegration(request: { readonly slug: string; readonly date: string }): Promise<StatisticsWriteResult & {
    readonly selection?: StatsReportSelection<StatsRow>;
    readonly reportError?: string;
    readonly metadataSource: { readonly classification: string; readonly implementer: ReviewStatistics['source'] };
  }> {
    if (!request.slug) { throw new Error('recordIntegrationStats requires a mission slug.'); }
    const classification = await this._port.readStoredClassification(request.slug);
    const info = reviewStatistics(await this._port.readReview(request.slug));
    const result = this._port.upsert({
      date: request.date, repo: this._port.repositoryName, mission: request.slug, classification,
      implementer: info.implementer,
      pr_fix_rounds: info.prFixRounds === null ? undefined : String(info.prFixRounds),
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
      implementer: agentFamily, pr_fix_rounds: request.prFixRounds ?? undefined,
      implementer_agent: request.implementer || '', reviewer_agent: request.reviewer || '', stage: request.stage,
      ...telemetryToStatsFields(request.telemetry, { agentFamily, durationMinutes: request.durationMinutes, model: request.model }),
    });
  }
}

function mergeStageRows(existing: StatsRow, incoming: StatsRow): StatsRow {
  const merged = { ...existing, ...incoming,
    provider: mergeLabel(String(existing.provider), String(incoming.provider)),
    model: mergeLabel(String(existing.model), String(incoming.model)),
    cost_usd: accumulateDecimalStrings(String(existing.cost_usd), String(incoming.cost_usd)),
  };
  for (const key of [
    'input_tokens', 'output_tokens', 'cached_tokens', 'thoughts_tokens', 'context_tokens',
    'tool_calls', 'openai_usage_delta', 'duration_minutes',
  ] as const) {
    merged[key] = accumulateIntegerStrings(String(existing[key]), String(incoming[key]));
  }
  merged.openai_usage_before = accumulateIntegerStrings(String(existing.openai_usage_before), String(incoming.openai_usage_before), { mode: 'replace' });
  merged.openai_usage_after = accumulateIntegerStrings(String(existing.openai_usage_after), String(incoming.openai_usage_after), { mode: 'max' });
  return merged;
}
