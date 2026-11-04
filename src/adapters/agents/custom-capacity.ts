import type { ParallixConfiguration } from '../../application/ports/configuration.js';
import { resolveCanonicalMaxConcurrentCustom, resolveCanonicalRepositoryRoot } from '../config/product-config.js';
import { processIdentity } from '../process/process-liveness.js';
import { initCustomAdmissionState } from '../sqlite/custom-admission-state.js';
import { waitForAdmission, type AdmissionWaitPolicy } from '../process/admission-wait.js';
export { initCustomAdmissionState } from '../sqlite/custom-admission-state.js';
import { SqliteCustomAgentLeaseRepository } from '../sqlite/custom-agent-lease-repository.js';

import type { CustomCapacityReservation } from '../../application/ports/custom-agent-admission.js';
export type { CustomCapacityReservation } from '../../application/ports/custom-agent-admission.js';

/**
 * Capacity is released when a launcher's process group settles, so a saturated
 * pool can stay saturated for the whole agent run. The wait therefore carries no
 * admission-side bound; the launcher's watchdog and signal own it. Progress is
 * reported once, then at most every 15 s, so a saturated pool stays visible.
 */
export const CUSTOM_CAPACITY_ADMISSION_POLICY: AdmissionWaitPolicy = {
  resource: 'custom-agent-capacity',
  initialDelayMs: 1000,
  maxDelayMs: 1000,
  maxWaitMs: null,
  progressEveryMs: 15_000,
};

/** Wait for admission without changing the selected agent or consuming a retry. */
export async function waitForCustomCapacity(
  rootDir?: string,
  onWaiting: () => void | Promise<void> = () => {},
  acquire = tryAcquireCustomCapacity,
  pause?: () => Promise<void>,
  signal?: AbortSignal,
): Promise<CustomCapacityReservation> {
  const admitted = await waitForAdmission<CustomCapacityReservation>(
    () => acquire(rootDir),
    CUSTOM_CAPACITY_ADMISSION_POLICY,
    { signal, onWaiting, ...(pause ? { pause: () => pause() } : {}) },
  );
  if (!admitted.value) { throw new Error(`Custom-agent capacity wait closed after ${admitted.attempts} attempts`); }
  if (signal?.aborted) { admitted.value.release(); signal.throwIfAborted(); }
  return admitted.value;
}

export async function tryAcquireCustomCapacity(rootDir?: string, configuration?: ParallixConfiguration): Promise<CustomCapacityReservation | null> {
  const repositoryRoot = resolveCanonicalRepositoryRoot(configuration?.agents.customAdmissionRepository ?? rootDir);
  const capacity = resolveCanonicalMaxConcurrentCustom(repositoryRoot);
  if (!Number.isFinite(capacity)) { return { bindChild() {}, release() {} }; }
  const launcher = processIdentity(process.pid);
  if (!launcher) { throw new Error('Cannot establish launcher process identity for custom-agent admission'); }
  const { db, leaseDb } = await initCustomAdmissionState(configuration);
  const leases = new SqliteCustomAgentLeaseRepository(db, 'agents', leaseDb);
  const leaseId = await leases.acquire(repositoryRoot, capacity, launcher);
  if (!leaseId) { return null; }
  let released = false;
  return {
    bindChild(_pid) {
      if (!released && _pid) {
        const child = processIdentity(_pid);
        if (child) {
          leases.bindChild(leaseId, child);
        }
      }
    },
    release() {
      if (released) {
        return;
      }
      released = true;
      leases.release(leaseId);
    }
  };
}

/** Test-only inspection helpers; production admission is the SQLite lease table. */
export async function resetCustomCapacity(configuration?: ParallixConfiguration): Promise<void> {
  const { db } = await initCustomAdmissionState(configuration);
  await db.execute('DELETE FROM custom_agent_leases WHERE resource = ?', ['agents']);
}

export async function activeCustomCapacityCount(configuration?: ParallixConfiguration): Promise<number> {
  const { db } = await initCustomAdmissionState(configuration);
  const rows = await db.query<{ count: number }>('SELECT COUNT(*) AS count FROM custom_agent_leases WHERE resource = ?', ['agents']);
  return Number(rows[0]?.count || 0);
}

