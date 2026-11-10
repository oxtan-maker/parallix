export interface UsageRecord {
  readonly id?: string;
  readonly runId?: string;
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
  readonly thoughts_tokens?: number;
  readonly context_tokens?: number;
  readonly tool_calls?: number;
  readonly openai_usage_before?: number;
  readonly openai_usage_after?: number;
  readonly openai_usage_delta?: number;
  readonly duration_minutes?: number;
  readonly cost_usd?: number;
}

/** Text fields of a usage record that a filter may match by equality. */
export type UsageFilterField =
  | 'date'
  | 'repo'
  | 'mission'
  | 'classification'
  | 'implementer'
  | 'provider'
  | 'model'
  | 'implementer_agent'
  | 'reviewer_agent'
  | 'stage';

/**
 * Conjunction of equality constraints; omitted fields are unconstrained.
 *
 * Constraints compare against the exposed `UsageRecord` values, where an unset
 * text field is `undefined`; an empty-string constraint therefore matches no
 * record, even where the storage layer keeps empty text.
 */
export type UsageFilter = { readonly [K in UsageFilterField]?: string };

export interface UsageRepository {
  findAll(): Promise<readonly UsageRecord[]>;
  /** Records matching every constraint in `filter`, in `findAll` order. */
  findWhere(_filter: UsageFilter): Promise<readonly UsageRecord[]>;
}
