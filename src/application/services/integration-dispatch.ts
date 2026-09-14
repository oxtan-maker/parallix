/**
 * The integration-mode dispatcher.
 *
 * A repository's integration mode decides which of the seven named integration
 * operations it owns. This module is the single place that decision is made, so
 * callers never branch on the mode themselves and the `if (mode === ...)`
 * scatter the mission forbids never forms. It implements the capability port in
 * `../ports/integration-strategy.js` for one mode.
 *
 * The capability table below is deliberately small: `local` performs every
 * operation it owns itself; the GitHub modes own the local preparation and
 * candidate steps; `github-pr` also observes its provider-owned merge locally,
 * while `github-publish` remains a fail-closed external-provider stub; and never
 * perform a step the mode's authority model forbids (`unsupported`).
 */
import {
  INTEGRATION_OPERATIONS,
  type IntegrationOperation,
  type IntegrationOperationSupport,
  type IntegrationRefusal,
  type IntegrationStrategyPort,
} from '../ports/integration-strategy.js';
import {
  integrationClosureBlocker,
  type IntegrationMode,
  type IntegrationEvidence,
} from '../../domain/integration.js';

/**
 * Which of the seven operations a mode performs, and why it refuses the rest.
 *
 * - `local`: Parallix performs it. `local` owns every local authority.
 * - `external-pending`: the mode declares it, but it belongs to a provider
 *   adapter this release does not ship, so it fails closed.
 * - `unsupported`: the mode's authority model never performs it — for example
 *   `github-pr` never merges into the protected primary branch.
 */
const CAPABILITY_TABLE: Record<IntegrationMode, Record<IntegrationOperation, IntegrationOperationSupport>> = {
  local: {
    'prepare-integration': 'local',
    'run-required-local-gates': 'local',
    'produce-integration-candidate': 'local',
    'submit-for-external-verification': 'unsupported',
    'publish': 'local',
    'observe-external-integration': 'unsupported',
    'close-mission': 'local',
  },
  'github-publish': {
    'prepare-integration': 'local',
    'run-required-local-gates': 'local',
    'produce-integration-candidate': 'local',
    'submit-for-external-verification': 'external-pending',
    'publish': 'external-pending',
    'observe-external-integration': 'external-pending',
    'close-mission': 'local',
  },
  'github-pr': {
    'prepare-integration': 'local',
    'run-required-local-gates': 'local',
    'produce-integration-candidate': 'local',
    'submit-for-external-verification': 'local',
    'publish': 'unsupported',
    'observe-external-integration': 'local',
    'close-mission': 'local',
  },
};

const UNSUPPORTED_REASON: Record<IntegrationOperation, string> = {
  'prepare-integration': 'this integration mode does not prepare integration itself',
  'run-required-local-gates': 'this integration mode does not run the local gates itself',
  'produce-integration-candidate': 'this integration mode does not produce the integration candidate itself',
  'submit-for-external-verification': 'this integration mode does not submit for external verification',
  'publish': 'this integration mode does not publish; the merge into the primary branch belongs to GitHub/PR, not Parallix',
  'observe-external-integration': 'this integration mode does not observe external integration',
  'close-mission': 'this integration mode does not close the mission itself',
};

const EXTERNAL_PENDING_REASON: Record<IntegrationOperation, string> = {
  'prepare-integration': 'the provider adapter that prepares integration is not shipped in this release',
  'run-required-local-gates': 'the provider adapter that runs the local gates is not shipped in this release',
  'produce-integration-candidate': 'the provider adapter that produces the integration candidate is not shipped in this release',
  'submit-for-external-verification': 'the provider adapter that submits for external verification is not shipped in this release',
  'publish': 'the provider adapter that publishes to the protected primary branch is not shipped in this release',
  'observe-external-integration': 'the provider adapter that observes external integration is not shipped in this release',
  'close-mission': 'the provider adapter that closes the mission is not shipped in this release',
};

function refusalFor(mode: IntegrationMode, operation: IntegrationOperation, support: Exclude<IntegrationOperationSupport, 'local'>): IntegrationRefusal {
  const reason = support === 'unsupported'
    ? UNSUPPORTED_REASON[operation]
    : EXTERNAL_PENDING_REASON[operation];
  return {
    mode,
    operation,
    support,
    message: `the "${mode}" integration mode ${reason}.`,
  };
}

/**
 * The capability port for one integration mode. The dispatcher in this module is
 * the only place the per-mode capability table lives, so the merge authority
 * decision is centralized rather than scattered through the integration command.
 */
export class IntegrationStrategy implements IntegrationStrategyPort {
  constructor(private readonly _mode: IntegrationMode) {}

  get mode(): IntegrationMode { return this._mode; }

  supportFor(operation: IntegrationOperation): IntegrationOperationSupport {
    return CAPABILITY_TABLE[this._mode][operation];
  }

  refusalFor(operation: IntegrationOperation): IntegrationRefusal | null {
    const support = this.supportFor(operation);
    return support === 'local' ? null : refusalFor(this._mode, operation, support);
  }

  /**
   * Execute the supplied local implementation only when the active mode owns the
   * operation. Fails closed with the refusal message otherwise — a mode never
   * performs a step its authority model forbids or a provider adapter has not
   * shipped.
   */
  async run<T>(operation: IntegrationOperation, perform: () => T | Promise<T>): Promise<T> {
    const support = this.supportFor(operation);
    if (support === 'local') { return perform(); }
    const refusal = refusalFor(this._mode, operation, support);
    throw new Error(refusal.message);
  }

  closureBlocker(evidence: IntegrationEvidence): string | null {
    return integrationClosureBlocker(this._mode, evidence);
  }
}

/** Build the capability port for a resolved integration mode. */
export function createIntegrationStrategy(mode: IntegrationMode): IntegrationStrategyPort {
  return new IntegrationStrategy(mode);
}

/** The seven operations the capability boundary dispatches over. */
export { INTEGRATION_OPERATIONS };
export type { IntegrationOperation };
