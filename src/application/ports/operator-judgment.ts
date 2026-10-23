/** Proposals never grant workflow, review, contract-editing or integration authority. */
export const OPERATOR_ACTIONS = ['wait', 'request-evidence', 'continue', 'escalate'] as const;
export type OperatorAction = typeof OPERATOR_ACTIONS[number];
export interface OperatorEvidence { readonly ref: string; readonly summary: string }
export interface OperatorSnapshot {
  readonly missionId: string;
  readonly version: number;
  readonly operationId: string | null;
  readonly progress: string;
  readonly lane: string;
  readonly working: boolean;
  readonly evidence: readonly OperatorEvidence[];
}
export interface OperatorEnvelope extends OperatorSnapshot {
  readonly observedAt: number;
  readonly allowedActions: readonly OperatorAction[];
}
export interface OperatorProposal {
  readonly missionId: string;
  readonly version: number;
  readonly operationId: string | null;
  readonly progress: string;
  readonly evidenceRefs: readonly string[];
  readonly action: OperatorAction;
  readonly summary: string;
}
export interface OperatorJudgmentPort {
  propose(_envelope: OperatorEnvelope): Promise<unknown>;
}
export interface OperatorJudgmentAuthority {
  read(_missionId: string): Promise<OperatorSnapshot>;
  record(_event: OperatorDecisionEvent): void | Promise<void>;
  now(): number;
}
export interface OperatorDecisionEvent {
  readonly missionId: string;
  readonly action: OperatorAction;
  readonly summary: string;
  readonly evidenceRefs: readonly string[];
  readonly invocations: number;
}

/** The admitted facts travel unchanged to the actual launcher boundary. */
export interface OperatorContinuationAdmission { readonly envelope: OperatorEnvelope; readonly proposal: OperatorProposal }
