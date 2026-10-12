import path from 'node:path';
import type { ParallixConfiguration } from '../../application/ports/configuration.js';
import { initOperatorState } from './adapter-factory.js';
import { SqliteDatabaseAdapter } from './database-adapter.js';
import { loadDefaultMigrations } from './migration-runner.js';

const connections = new Map<string, Promise<{ db: SqliteDatabaseAdapter }>>();

/** Lease-only storage selected explicitly at composition, separate from operator storage. */
export async function initCustomAdmissionState(configuration?: ParallixConfiguration): Promise<{ db: SqliteDatabaseAdapter }> {
  const home = configuration?.agents.customAdmissionHome;
  if (!home) { return initOperatorState({ configuration }); }
  const file = path.resolve(home, 'custom-admission.db');
  let connection = connections.get(file);
  if (!connection) {
    connection = openAdmissionState(file, configuration);
    connections.set(file, connection);
    void connection.catch(() => connections.delete(file));
  }
  return connection;
}

async function openAdmissionState(file: string, configuration?: ParallixConfiguration) {
  const schema = loadDefaultMigrations().find(migration => migration.id === '0019-custom-agent-leases');
  if (!schema) { throw new Error('Custom admission lease schema is unavailable'); }
  const db = new SqliteDatabaseAdapter(configuration);
  try {
    await db.open({ path: file });
    await db.execute(schema.up);
    return { db };
  } catch (error) {
    await db.close();
    throw error;
  }
}

/** Test fixture cleanup; callers release their reservations before closing handles. */
export async function clearCustomAdmissionStateCache(): Promise<void> {
  for (const connection of connections.values()) {
    const { db } = await connection;
    await db.close();
  }
  connections.clear();
}
