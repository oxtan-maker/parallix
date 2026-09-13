/**
 * Repository integration authority.
 *
 * An integration mode names *who owns the merge into the primary branch*, which
 * is a separate authority from review approval. `local` keeps that authority
 * inside Parallix; the GitHub modes hand part of it to an external provider
 * that is observed rather than called from the domain.
 */
export const INTEGRATION_MODES = ['local', 'github-publish', 'github-pr'] as const;

export type IntegrationMode = typeof INTEGRATION_MODES[number];

/** A repository that configures no mode integrates locally, as it always has. */
export const DEFAULT_INTEGRATION_MODE: IntegrationMode = 'local';

export function isIntegrationMode(value: unknown): value is IntegrationMode {
  return typeof value === 'string' && (INTEGRATION_MODES as readonly string[]).includes(value);
}

/** The configuration error text for an unsupported mode: names the value and the allowed set. */
export function integrationModeIssue(value: unknown): string {
  return `integration.mode ${JSON.stringify(value)} is not a supported integration mode. Allowed values: { ${INTEGRATION_MODES.join(', ')} }`;
}

/**
 * Absent mode means `local`. Any other unrecognised value fails closed rather
 * than degrading to a default, because guessing the merge authority is worse
 * than refusing to run.
 */
export function parseIntegrationMode(value: unknown): IntegrationMode {
  if (value === undefined || value === null) { return DEFAULT_INTEGRATION_MODE; }
  if (!isIntegrationMode(value)) { throw new Error(integrationModeIssue(value)); }
  return value;
}

/**
 * The evidence an integration outcome rests on, expressed as observed data
 * rather than as a local boolean an agent can assert. `verifiedSha` and
 * `externalIntegrationObserved` are filled in by future provider adapters; the
 * domain only states which facts each mode requires, never how to fetch them.
 */
export interface IntegrationEvidence {
  /** The commit Parallix produced as the integration candidate. */
  readonly candidateSha: string | null;
  /** The exact commit an external verifier reported as verified, if any. */
  readonly verifiedSha: string | null;
  /** Whether an external provider was observed integrating into the primary branch. */
  readonly externalIntegrationObserved: boolean;
}

export const NO_INTEGRATION_EVIDENCE: IntegrationEvidence = Object.freeze({
  candidateSha: null,
  verifiedSha: null,
  externalIntegrationObserved: false,
});

/**
 * Why a mission may not be closed yet, or null when the mode's evidence
 * requirement is satisfied. Review approval is never sufficient on its own:
 * `local` needs its own candidate, `github-publish` needs the *same* commit
 * verified externally, and `github-pr` needs an observed external integration.
 */
export function integrationClosureBlocker(
  mode: IntegrationMode,
  evidence: IntegrationEvidence,
): string | null {
  if (mode === 'local') {
    return evidence.candidateSha ? null : 'no integration candidate commit was produced';
  }
  if (mode === 'github-publish') {
    if (!evidence.candidateSha) { return 'no integration candidate commit was produced'; }
    if (!evidence.verifiedSha) { return 'no external verification of the integration candidate was observed'; }
    if (evidence.verifiedSha !== evidence.candidateSha) {
      return `external verification covers ${evidence.verifiedSha}, not the integration candidate ${evidence.candidateSha}`;
    }
    return null;
  }
  return evidence.externalIntegrationObserved
    ? null
    : 'no external integration into the primary branch was observed';
}
