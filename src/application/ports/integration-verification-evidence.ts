import type { ParallixConfiguration } from './configuration.js';

/** Optional validation evidence produced by an integration gate phase.
 * The gate executor owns execution, including how the phase settled, and the
 * evidence adapter owns persistence and input identity. Neither capability
 * grants review or publication authority. */
export interface IntegrationVerificationEvidencePort {
  start(_root: string, _gates: readonly { key: string; command: string }[]): {
    complete(_outcomes: readonly { key: string; command: string; exitCode: number | null }[],
      _disposition: 'passed' | 'failed' | 'cancelled'): void;
  } | null;
}

/** Clean-tree proof reuse requested by the repository gate executor. */
export interface ReusableVerificationProofPort {
  readReusableVerificationProof(_command: string, _root: string, _options: { context: string; configuration?: ParallixConfiguration }): { ok: boolean; identity?: string; error?: string };
  writeReusableVerificationProof(_command: string, _root: string, _options: { context: string; configuration?: ParallixConfiguration; expectedIdentity?: string }): { ok: boolean; identity?: string; error?: string };
}
