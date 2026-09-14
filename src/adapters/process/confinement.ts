import { isBubblewrapAvailable, isBubblewrapDisabled, BUBBLEWRAP_COMMAND } from './bubblewrap.js';

/**
 * Mutating-agent confinement policy (task-2513).
 *
 * One pure decision boundary that turns the launch inputs into a confinement
 * outcome. It lives beside the Bubblewrap guard because it governs exactly the
 * question the guard answers at the spawn seam: does this mutating launch run
 * confined, and if not, on what authority.
 *
 * The policy only governs *mutating* launches (a worktree the agent may write
 * to). Read-only / reviewer launches are unchanged and out of scope.
 */

/** Agent families that expose an agent-native sandbox the launch layer can enable. */
const NATIVE_SANDBOX_AGENTS = Object.freeze(['codex', 'qwen']);

export type ConfinementDecision =
  /** Host-level Bubblewrap confinement at the spawn seam. */
  | 'bubblewrap'
  /** Agent-native sandbox (fallback defense when Bubblewrap is missing). */
  | 'native-sandbox'
  /** Neither confinement path exists; the launch must not proceed. */
  | 'blocked'
  /** Operator explicitly consented to run unsandboxed. */
  | 'unsandboxed-consented';

export interface ConfinementInput {
  /** Mutating launch (worktree writable). Read-only launches are unconstrained. */
  mutating: boolean;
  /** An executable `bwrap` is present (and not explicitly disabled). */
  bubblewrapAvailable: boolean;
  /** The chosen family exposes a selectable agent-native sandbox. */
  nativeSandboxSupported: boolean;
  /** The operator explicitly consented to unsandboxed execution. */
  operatorConsent: boolean;
}

/**
 * Decide the confinement for one mutating launch.
 *
 * Precedence is strictly ordered toward the narrowest confinement:
 * Bubblewrap first, then the agent's own sandbox, then explicit operator
 * consent, then a hard block. A read-only launch is never gated.
 */
export function selectConfinement(input: ConfinementInput): ConfinementDecision {
  if (!input.mutating) {return 'bubblewrap';}
  if (input.bubblewrapAvailable) {return 'bubblewrap';}
  if (input.nativeSandboxSupported) {return 'native-sandbox';}
  if (input.operatorConsent) {return 'unsandboxed-consented';}
  return 'blocked';
}

/** True when the family exposes a selectable agent-native sandbox. */
export function supportsNativeSandbox(family: string | null | undefined): boolean {
  if (!family) {return false;}
  return NATIVE_SANDBOX_AGENTS.includes(family);
}

/**
 * Thrown when a mutating launch cannot be confined and no operator consent is
 * present. Surface at the launch seam so the operator sees a deliberate block,
 * never a silent unsandboxed fallback.
 */
export class ConfinementBlockedError extends Error {
  code = 'CONFINEMENT_BLOCKED';
  constructor(family: string, reason: string) {
    super(
      `Confinement blocked: a mutating ${family} launch cannot run unsandboxed. ` +
      `Bubblewrap is unavailable and ${family} has no supported agent-native sandbox. ` +
      `Consent to unsandboxed execution explicitly to proceed (reason: ${reason}).`
    );
    this.name = 'ConfinementBlockedError';
  }
}

// Re-exported probes so callers keep a single availability source of truth.
export { isBubblewrapAvailable, isBubblewrapDisabled, BUBBLEWRAP_COMMAND };
