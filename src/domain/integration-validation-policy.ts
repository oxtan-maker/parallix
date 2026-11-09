export interface IntegrationValidationMarker {
  /** The mission the validated hooks belong to. */
  readonly missionId: string;
  /** The validating commit: the mission branch HEAD the green suite ran against. */
  readonly sha: string;
  /** The whitelist of validated high-level test hook keys. */
  readonly hooks: readonly string[];
}

/**
 * Build and validate a marker. The whitelist must be a non-empty list of
 * distinct non-empty keys; a marker with no validated hooks is meaningless and
 * rejected so it can never accidentally authorize a full skip.
 */
export function buildIntegrationValidationMarker(
  missionId: string,
  sha: string,
  hooks: readonly string[],
): IntegrationValidationMarker {
  if (!missionId || typeof missionId !== 'string') {
    throw new Error('integration-validation marker requires a mission id');
  }
  if (!sha || typeof sha !== 'string') {
    throw new Error('integration-validation marker requires a validating sha');
  }
  const normalized = Array.isArray(hooks)
    ? hooks.filter((hook): hook is string => typeof hook === 'string' && hook.length > 0)
    : [];
  const distinct = [...new Set(normalized)];
  if (distinct.length === 0) {
    throw new Error('integration-validation marker requires at least one validated hook');
  }
  return { missionId, sha, hooks: distinct };
}

/**
 * The repository-general bookkeeping rule (TASK-2646): a Backlog task record
 * under `backlog/tasks/` or `backlog/completed/`. Lane transitions and
 * integration closeout rewrite only these files, so a tree that differs from a
 * validated tree in nothing else exercises the same code, tests, and
 * configuration. Every other path — `src/`, `test/`, `config/`,
 * `workflow.config.json`, package manifests — is substantive.
 */
export const BOOKKEEPING_PATH_RULE = /^backlog\/(?:tasks|completed)\/[^/]+\.md$/;

/** True when `filePath` (repository-relative, `/`-separated) is bookkeeping only. */
export function isBookkeepingPath(filePath: string): boolean {
  return BOOKKEEPING_PATH_RULE.test(filePath);
}

/** External task catalog paths excluded from verification candidate inputs and rebase lineage continuity. */
export const isVerificationBookkeeping = (file: string): boolean =>
  file.startsWith('backlog/tasks/') || file.startsWith('backlog/completed/');

/**
 * The paths that differ between the validated commit and the finalized commit,
 * as reported through the gates port. `ok: false` covers every git failure,
 * including an unreachable validated commit.
 */
export type ValidatedCommitDiff =
  | { readonly ok: true; readonly paths: readonly string[] }
  | { readonly ok: false; readonly error?: string };

/** One completed Git rebase: the pre-rebase HEAD and the rebased HEAD. */
export interface CompletedRebaseStep {
  readonly from: string;
  readonly to: string;
}

/**
 * The completed rebases that carry a validated commit to a later one, as
 * proven by the repository's completed-rebase recorder. Rebase content is
 * deliberately not compared: formal origin CI validates the actual candidate.
 */
export type CompletedRebaseLineage = readonly CompletedRebaseStep[];

/**
 * True when the marker authorizes a skip: it exists, its whitelist is
 * non-empty, and the validated commit still covers the finalized commit — it
 * is the same commit, the two trees differ only in bookkeeping paths
 * (TASK-2646), or completed rebases carry the validated commit to it. Any
 * other movement, including an edit outside a completed rebase, falls back to
 * the full suite.
 */
export function validationSkipApplies(
  marker: IntegrationValidationMarker | null,
  finalizedCommit: string | null | undefined,
  diffFromValidated: ValidatedCommitDiff | null = null,
  lineage: CompletedRebaseLineage | null = null,
): boolean {
  if (!marker || marker.hooks.length === 0) { return false; }
  if (!finalizedCommit) { return false; }
  if (marker.sha === finalizedCommit) { return true; }
  if (diffFromValidated?.ok && diffFromValidated.paths.every(isBookkeepingPath)) { return true; }
  return Boolean(lineage?.length);
}

/**
 * Partition the configured gate keys into the whitelisted hooks to skip and the
 * remaining hooks to actually run. Keys not present in the whitelist always run
 * (they were never validated); keys in the whitelist are skipped.
 */
export function partitionGatesForSkip(
  configuredKeys: readonly string[],
  marker: IntegrationValidationMarker,
): { skip: readonly string[]; run: readonly string[] } {
  const whitelist = new Set(marker.hooks);
  const run: string[] = [];
  for (const key of configuredKeys) {
    if (whitelist.has(key)) { continue; }
    run.push(key);
  }
  const skip = configuredKeys.filter(key => whitelist.has(key));
  return { skip, run };
}
