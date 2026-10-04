/**
 * Durable, sha-keyed marker of the high-level integration test hooks that a
 * mission already ran green, so a later `px integrate` can skip re-running them
 * (TASK-2625).
 *
 * The marker is a whitelist of gate keys keyed on the validating commit SHA. It
 * is recorded by the integration gate step when the suite passes green and read
 * back by the same step on a later run. The decision to skip is decided purely
 * from the marker, the finalized commit under test, and the paths that differ
 * between the two: there is no repo, branch, or mission-slug special-casing
 * anywhere in this module (SC2).
 *
 * Pure by construction: every export is a pure function over plain data with no
 * filesystem, database, or git dependency, so the whole decision surface is
 * unit-testable without a repository.
 */

/**
 * `operational_history.event_type` for one integration-validation marker.
 *
 * Append-only audit label; the marker is the newest row of this type per
 * mission. Keyed on the mission id (stored in `event_data.missionId`) so rows
 * for different missions never collide.
 */
export const INTEGRATION_VALIDATION_EVENT_TYPE = 'integration.integration-validation';

/**
 * A durable record that the listed high-level test hooks ran green for a
 * mission at a specific commit.
 */
export interface IntegrationValidationMarker {
  /** The mission the validated hooks belong to. */
  readonly missionId: string;
  /** The validating commit: the mission branch HEAD the green suite ran against. */
  readonly sha: string;
  /** The whitelist of validated high-level test hook keys. */
  readonly hooks: readonly string[];
}

/** On-disk shape of the `event_data` JSON for a marker row. */
interface IntegrationValidationMarkerRecord {
  missionId: string;
  sha: string;
  hooks: string[];
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
 * Parse an operational-history row into a marker, or null when the row is not a
 * well-formed marker of this type. Shape validation is strict: a partial or
 * malformed row is ignored rather than trusted, so a corrupt history entry can
 * never authorize a skip (fail open to the full suite).
 */
export function parseIntegrationValidationMarker(
  entry: { eventType?: string; eventData?: string } | null | undefined,
): IntegrationValidationMarker | null {
  if (!entry || entry.eventType !== INTEGRATION_VALIDATION_EVENT_TYPE) { return null; }
  let parsed: unknown;
  try {
    parsed = JSON.parse(String(entry.eventData ?? ''));
  } catch {
    return null;
  }
  if (!isRecord(parsed)) { return null; }
  const marker = tryParseMarker(parsed);
  return marker ? buildIntegrationValidationMarker(marker.missionId, marker.sha, marker.hooks) : null;
}

function isRecord(value: unknown): value is Partial<IntegrationValidationMarkerRecord> {
  return typeof value === 'object' && value !== null;
}

function tryParseMarker(value: Partial<IntegrationValidationMarkerRecord>): IntegrationValidationMarkerRecord | null {
  const missionId = typeof value.missionId === 'string' ? value.missionId : null;
  const sha = typeof value.sha === 'string' ? value.sha : null;
  const hooks = Array.isArray(value.hooks) ? value.hooks.filter((hook): hook is string => typeof hook === 'string' && hook.length > 0) : [];
  if (!missionId || !sha || hooks.length === 0) { return null; }
  return { missionId, sha, hooks };
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

/**
 * The paths that differ between the validated commit and the finalized commit,
 * as reported through the gates port. `ok: false` covers every git failure,
 * including an unreachable validated commit.
 */
export type ValidatedCommitDiff =
  | { readonly ok: true; readonly paths: readonly string[] }
  | { readonly ok: false; readonly error?: string };

/**
 * True when the marker authorizes a skip: it exists, its whitelist is
 * non-empty, and the validated commit still covers the finalized commit — it
 * is the same commit, or the two trees differ only in bookkeeping paths
 * (TASK-2646). A missing, failed, or substantive diff falls back to the full
 * suite, so a rebase that brings in real changes never skips (TASK-2625 F2).
 */
export function validationSkipApplies(
  marker: IntegrationValidationMarker | null,
  finalizedCommit: string | null | undefined,
  diffFromValidated: ValidatedCommitDiff | null = null,
): boolean {
  if (!marker || marker.hooks.length === 0) { return false; }
  if (!finalizedCommit) { return false; }
  if (marker.sha === finalizedCommit) { return true; }
  if (!diffFromValidated?.ok) { return false; }
  return diffFromValidated.paths.every(isBookkeepingPath);
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
