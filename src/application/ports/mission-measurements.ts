export interface UsageRecord {
  readonly id?: string;
  readonly date?: string;
  readonly repo?: string;
  readonly mission?: string;
  readonly classification?: string;
  readonly implementer?: string;
  readonly pr_fix_rounds?: number;
  readonly provider?: string;
  readonly model?: string;
  readonly implementer_agent?: string;
  readonly reviewer_agent?: string;
  readonly stage?: string;
  readonly input_tokens?: number;
  readonly output_tokens?: number;
  readonly cached_tokens?: number;
  readonly context_tokens?: number;
  readonly tool_calls?: number;
  readonly openai_usage_before?: number;
  readonly openai_usage_after?: number;
  readonly openai_usage_delta?: number;
  readonly duration_minutes?: number;
  readonly cost_usd?: number;
  readonly closed?: string;
}

export interface UsageRepository {
  findAll(): Promise<readonly UsageRecord[]>;
  findWhere(_predicate: (_record: UsageRecord) => boolean): Promise<readonly UsageRecord[]>;
}
