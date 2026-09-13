/**
 * The integration capability boundary.
 *
 * Integration is expressed as seven named operations. A repository's integration
 * mode decides which of them it owns; the dispatcher in
 * `../services/integration-dispatch.js` is the only place that decision is made,
 * so callers never branch on the mode themselves.
 */
import type { IntegrationEvidence, IntegrationMode } from '../../domain/integration.js';

export const INTEGRATION_OPERATIONS = [
  'prepare-integration',
  'run-required-local-gates',
  'produce-integration-candidate',
  'submit-for-external-verification',
  'publish',
  'observe-external-integration',
  'close-mission',
] as const;

export type IntegrationOperation = typeof INTEGRATION_OPERATIONS[number];

/**
 * How a mode relates to one operation:
 * - `local`: Parallix performs it itself.
 * - `external-pending`: the mode declares it, but it belongs to a provider
 *   adapter that this release does not ship, so it fails closed.
 * - `unsupported`: the mode never performs it — for example `github-pr` never
 *   merges into the remote primary branch.
 */
export type IntegrationOperationSupport = 'local' | 'external-pending' | 'unsupported';

/** Refusal reason for an operation the current mode will not run. */
export interface IntegrationRefusal {
  readonly mode: IntegrationMode;
  readonly operation: IntegrationOperation;
  readonly support: Exclude<IntegrationOperationSupport, 'local'>;
  readonly message: string;
}

/**
 * The capability port. `run` executes the supplied local implementation only
 * when the active mode owns that operation, and fails closed otherwise.
 */
export interface IntegrationStrategyPort {
  readonly mode: IntegrationMode;
  supportFor(_operation: IntegrationOperation): IntegrationOperationSupport;
  /** null when the mode owns the operation, otherwise the refusal to report. */
  refusalFor(_operation: IntegrationOperation): IntegrationRefusal | null;
  run<T>(_operation: IntegrationOperation, _perform: () => T | Promise<T>): Promise<T>;
  /** Why the mission may not be closed on this evidence yet, or null. */
  closureBlocker(_evidence: IntegrationEvidence): string | null;
}
