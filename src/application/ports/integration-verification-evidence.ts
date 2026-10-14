/** Optional validation evidence produced by a complete integration gate phase.
 * The gate executor owns execution; the evidence adapter owns persistence and
 * input identity. Neither capability grants review or publication authority. */
export interface IntegrationVerificationEvidencePort {
  start(_root: string, _gates: readonly { key: string; command: string }[]): {
    complete(_outcomes: readonly { key: string; command: string; exitCode: number | null }[]): void;
  } | null;
}
