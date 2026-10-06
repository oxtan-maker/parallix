/** Bounded judgments. Consumers own any threshold or subsequent workflow policy. */
export type DecisionData = string | number | boolean | null | readonly DecisionData[] | { readonly [key: string]: DecisionData };
export type DecisionQuestion =
  | { readonly type: 'boolean'; readonly instructions: DecisionData; readonly criteria?: { readonly true?: DecisionData; readonly false?: DecisionData } }
  | { readonly type: 'choice'; readonly instructions: DecisionData; readonly criteria: Readonly<Record<string, DecisionData>> }
  | { readonly type: 'score'; readonly instructions: DecisionData; readonly criteria: readonly DecisionData[] };

export interface DecisionRequest {
  readonly state: DecisionData;
  readonly questions: Readonly<Record<string, DecisionQuestion>>;
}

export type DecisionAnswer =
  | { readonly type: 'boolean'; readonly probability: number }
  | { readonly type: 'choice'; readonly selected: string; readonly probabilities: Readonly<Record<string, number>>; readonly confidence: number }
  | { readonly type: 'score'; readonly score: number; readonly levels: Readonly<Record<string, DecisionData>>; readonly probabilities?: Readonly<Record<string, number>>; readonly confidence: number };

export type DecisionAvailability =
  | { readonly status: 'available'; readonly provider: string; readonly model: string }
  | { readonly status: 'setup-required'; readonly reason: string };

export interface DecisionResult {
  readonly answers: Readonly<Record<string, DecisionAnswer>>;
  readonly provider: string;
  readonly model: string;
  readonly usage?: { readonly inputTokens?: number; readonly outputTokens?: number; readonly cost?: number };
}

export interface DecisionPort {
  available(): DecisionAvailability | Promise<DecisionAvailability>;
  decide(_request: DecisionRequest): Promise<DecisionResult>;
}

export type DecisionErrorKind = 'setup-required' | 'invalid-request' | 'usage-blocked'
  | 'authentication' | 'rate-limited' | 'unavailable' | 'invalid-response';

/** Stable failure contract; contains no remote body, credentials, or request state. */
export class DecisionError extends Error {
  readonly name = 'DecisionError';
  readonly kind: DecisionErrorKind;
  readonly provider?: string;
  constructor(kind: DecisionErrorKind, message: string, provider?: string) {
    super(message);
    this.kind = kind;
    this.provider = provider;
  }
}
