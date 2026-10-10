import type { MigrateLegacyAdhocIdsResult, MissionStore } from './domain-ports.js';

/**
 * Rewrite legacy `parallix-adhoc-<…>` mission ids to counter-owned
 * `px-<NNNN>` ids (task-2706).
 *
 * A single call drives the store's own atomic, collision-safe, repository
 * scoped rewrite; this service exists only to give the CLI and tests a stable,
 * store-agnostic entry point and to report when the held store cannot rewrite
 * ids. It touches no other subsystem: no lifecycle, intake, or Backlog effect.
 *
 * @param store the operator Mission store
 */
export async function migrateLegacyAdhocIdsMissions(
  store: MissionStore,
): Promise<MigrateLegacyAdhocIdsResult> {
  if (typeof store.migrateLegacyAdhocIds !== 'function') {
    throw new Error('the operator Mission store cannot rewrite legacy adhoc ids');
  }
  return store.migrateLegacyAdhocIds();
}
