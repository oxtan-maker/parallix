import { buildIntegrationValidationMarker, type IntegrationValidationMarker } from '../../domain/integration-validation-policy.js';
export * from '../../domain/integration-validation-policy.js';
/**
 * Durable, sha-keyed marker of the high-level integration test hooks observed
 * while classifying or certifying an integration repair (TASK-2625).
 *
 * The marker is a whitelist of gate keys keyed on the validating commit SHA.
 * Repair and review-classification consumers use it as retained validation
 * evidence. Landing admission does not use it to skip gates: `px integrate`
 * separately reads the tests action's complete recorded run receipt and starts
 * no gate (TASK-2872.02).
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
export const INTEGRATION_VALIDATION_FAILED_EVENT_TYPE = 'integration.integration-validation-failed';
export const INTEGRATION_VALIDATION_EVENT_TYPE = 'integration.integration-validation';

/**
 * A durable record that the listed high-level test hooks ran green for a
 * mission at a specific commit.
 */
/** On-disk shape of the `event_data` JSON for a marker row. */
interface IntegrationValidationMarkerRecord {
  missionId: string;
  sha: string;
  hooks: string[];
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
