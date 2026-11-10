import type { ParallixConfiguration } from './configuration.js';
import type { ProcessIdentity } from './process-identity.js';

export type IntegrationRunOwner = ProcessIdentity;

/** Optional validation evidence produced by an integration gate phase.
 * The gate executor owns execution, including how the phase settled, and the
 * evidence adapter owns persistence and input identity. Neither capability
 * grants review or publication authority. */
export interface IntegrationVerificationEvidencePort {
  start(_root: string, _gates: readonly { key: string; command: string }[]): {
    complete(_outcomes: readonly IntegrationGateEvidenceOutcome[],
      _disposition: 'passed' | 'failed' | 'cancelled'): boolean;
  } | null;
}

/** One configured gate's settled part of an integration run. Blocked and cancelled
 * parts carry no exit status and are never passes or failures. `result` is absent
 * on records written before aggregate outcomes. */
export interface IntegrationGateEvidenceOutcome {
  key: string; command: string; exitCode: number | null;
  result?: 'passed' | 'failed' | 'blocked' | 'cancelled';
  blockedBy?: string[]; signal?: string | null;
  /** Bounded tail of a failed gate's captured output. */
  diagnostics?: string;
}

/** Clean-tree proof reuse requested by the repository gate executor. */
export interface ReusableVerificationProofPort {
  readReusableVerificationProof(_command: string, _root: string, _options: { context: string; configuration?: ParallixConfiguration }): { ok: boolean; identity?: string; error?: string };
  writeReusableVerificationProof(_command: string, _root: string, _options: { context: string; configuration?: ParallixConfiguration; expectedIdentity?: string }): { ok: boolean; identity?: string; error?: string };
}
