import { resolveCanonicalMaxConcurrentCustom, resolveCanonicalRepositoryRoot } from '../config/product-config.js';
import { processIdentity } from '../process/process-liveness.js';
import { initOperatorState } from '../sqlite/adapter-factory.js';
import { SqliteCustomAgentLeaseRepository } from '../sqlite/custom-agent-lease-repository.js';

export interface CustomCapacityReservation {
  bindChild: (_pid: number | undefined) => void;
  release: () => void;
}

export async function tryAcquireCustomCapacity(rootDir?: string): Promise<CustomCapacityReservation | null> {
  const repositoryRoot = resolveCanonicalRepositoryRoot(rootDir);
  const capacity = resolveCanonicalMaxConcurrentCustom(repositoryRoot);
  if (!Number.isFinite(capacity)) { return { bindChild() {}, release() {} }; }
  const launcher = processIdentity(process.pid);
  if (!launcher) { throw new Error('Cannot establish launcher process identity for custom-agent admission'); }
  const { db } = await initOperatorState();
  const leases = new SqliteCustomAgentLeaseRepository(db);
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
export async function resetCustomCapacity(): Promise<void> {
  const { db } = await initOperatorState();
  await db.execute('DELETE FROM custom_agent_leases');
}

export async function activeCustomCapacityCount(): Promise<number> {
  const { db } = await initOperatorState();
  const rows = await db.query<{ count: number }>('SELECT COUNT(*) AS count FROM custom_agent_leases');
  return Number(rows[0]?.count || 0);
}
