import path from 'node:path';
import type { ParallixConfiguration } from '../../application/ports/configuration.js';
import { initOperatorState } from './adapter-factory.js';
import { SqliteDatabaseAdapter } from './database-adapter.js';
import { resolveDatabasePath } from './database-path-resolver.js';
import { loadDefaultMigrations } from './migration-runner.js';

type CustomAdmissionState = { db: SqliteDatabaseAdapter; leaseDb: SqliteDatabaseAdapter };

const connections = new Map<string, Promise<CustomAdmissionState>>();

/** Lease storage always owns its connection, even when it uses the operator database file. */
export async function initCustomAdmissionState(configuration?: ParallixConfiguration): Promise<CustomAdmissionState> {
  const home = configuration?.agents.customAdmissionHome;
  const file = home ? path.resolve(home, 'custom-admission.db') : resolveDatabasePath({ configuration });
  let connection = connections.get(file);
  if (!connection) {
    connection = home ? openAdmissionState(file, configuration) : openOperatorAdmissionState(file, configuration);
    connections.set(file, connection);
    void connection.catch(() => connections.delete(file));
  }
  return connection;
}

async function openOperatorAdmissionState(file: string, configuration?: ParallixConfiguration) {
  // The cached operator adapter owns migrations and workflow/history transactions.
  // Admission shares its file and schema, but never its transaction state.
  await initOperatorState({ configuration });
  const db = new SqliteDatabaseAdapter(configuration);
  const leaseDb = new SqliteDatabaseAdapter(configuration);
  try {
    // The operator owner has already selected the journal mode. Reasserting it
    // here would itself require a writer while an observation may be active.
    await db.open({ path: file, busyTimeoutMs: 100, enableWal: false });
    // Acquisition uses the short timeout above so polling remains cancellable.
    // Bind and release are synchronous port operations, so their independent
    // connection retains the adapter's bounded 5 s writer tolerance.
    await leaseDb.open({ path: file, enableWal: false });
    return { db, leaseDb };
  } catch (error) {
    await leaseDb.close();
    await db.close();
    throw error;
  }
}

async function openAdmissionState(file: string, configuration?: ParallixConfiguration) {
  const schema = loadDefaultMigrations().find(migration => migration.id === '0019-custom-agent-leases');
  if (!schema) { throw new Error('Custom admission lease schema is unavailable'); }
  const db = new SqliteDatabaseAdapter(configuration);
  try {
    await db.open({ path: file });
    await db.execute(schema.up);
    const resources = loadDefaultMigrations().find(migration => migration.id === '0041-admission-resources');
    if (!resources) { throw new Error('Admission resource schema is unavailable'); }
    await db.beginImmediateTransaction();
    const columns = await db.query<{ name: string }>('PRAGMA table_info(custom_agent_leases)');
    if (!columns.some(column => column.name === 'resource')) { await db.execute(resources.up); }
    await db.commitTransaction();
    return { db, leaseDb: db };
  } catch (error) {
    await db.rollbackTransaction();
    await db.close();
    throw error;
  }
}

/** Test fixture cleanup; callers release their reservations before closing handles. */
export async function clearCustomAdmissionStateCache(): Promise<void> {
  for (const connection of connections.values()) {
    const { db, leaseDb } = await connection;
    if (leaseDb !== db) { await leaseDb.close(); }
    await db.close();
  }
  connections.clear();
}
