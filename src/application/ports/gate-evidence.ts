import type { WorkflowOperation } from '../../domain/workflow-operation.js';
import type { MissionId } from '../../domain/mission.js';
import type { RepositoryId } from '../../domain/repository.js';

/** The mission whose verification facts are read. */
export interface GateEvidenceScope {
  readonly repositoryId: RepositoryId;
  readonly missionId: MissionId;
}

/**
 * The mission checkout the evidence was read against. `revision` is its HEAD;
 * `clean` is false when uncommitted changes mean no proof can cover the tree.
 */
export type GateCheckout =
  | { readonly kind: 'present'; readonly revision: string; readonly clean: boolean }
  | { readonly kind: 'absent' };

/**
 * Whether a recorded result covers the checkout's current verification inputs
 * (`current`) or an earlier revision or input set (`stale`). The adapter owns
 * input identity, so stale-versus-current is decided where proofs are keyed.
 */
export type GateEvidenceCurrency = 'current' | 'stale';

export interface GateResultEvidence {
  readonly state: GateEvidenceCurrency;
  readonly revision: string | null;
  readonly observedAt: string;
}

/**
 * One gate's newest passing outcome and newest recorded failure. Both carry
 * their own currency, so a result is only current when it covers the checkout
 * the observation is read against.
 */
export interface GateOutcomeEvidence {
  readonly proof: GateResultEvidence | { readonly state: 'absent' };
  readonly failure: (GateResultEvidence & { readonly exitCode: number | null }) | null;
}

/** One declared gate's newest passing proof and newest recorded failure. */
export interface DeclaredGateEvidence extends GateOutcomeEvidence {
  readonly command: string;
}

export interface MissionGateEvidence {
  readonly checkout: GateCheckout;
  readonly gates: readonly DeclaredGateEvidence[];
}

/** One configured integration gate's newest passing and failing outcome. */
export interface IntegrationGateOutcome extends GateOutcomeEvidence {
  readonly key: string;
}

/**
 * The configured pre-integration plan observed per gate. Validation markers are
 * per-hook whitelists, so the whole plan passes only when every configured key
 * is covered; `running` is the executor's own unsettled run record for the
 * attempt being observed, never a workflow phase.
 */
export interface IntegrationGateEvidence {
  readonly checkout: GateCheckout;
  readonly configured: readonly string[];
  readonly gates: readonly IntegrationGateOutcome[];
  readonly running: { readonly attempt: string; readonly startedAt: string } | null;
}

/**
 * Typed read boundary over the verification authority: proofs written by the
 * gate executor, failure evidence captured before repair, and integration
 * validation records. A read that cannot be completed rejects; it never
 * reports absence it did not observe.
 */
export interface GateEvidenceReader {
  /** Refresh the immutable evidence-input view for one board build. */
  beginRead?(): void;
  readDeclaredGates(_scope: GateEvidenceScope, _commands: readonly string[]): Promise<MissionGateEvidence>;
  readIntegrationGates(_scope: GateEvidenceScope, _operation: Pick<WorkflowOperation, 'id' | 'generation' | 'phase'> | null): Promise<IntegrationGateEvidence>;
}
