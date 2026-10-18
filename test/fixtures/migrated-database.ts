import fs from 'node:fs';
import path from 'node:path';
import { mkdtemp } from '../helpers/temp-dir.js';
import { SqliteDatabaseAdapter } from '../../src/adapters/sqlite/database-adapter.js';
import { SqliteMigrationRunner, loadDefaultMigrations } from '../../src/adapters/sqlite/migration-runner.js';

// Only empty, closed schema state is shared. Each case copies it to its own
// database; migration contracts still construct and migrate their own inputs.
let root: string;
let template: string;
let preparing: Promise<void> | undefined;
export function prepareMigratedSchema(): Promise<void> {
  return preparing ??= buildSchema();
}

async function buildSchema(): Promise<void> {
  root = mkdtemp('migrated-schema-');
  template = path.join(root, 'template.db');
  const db = new SqliteDatabaseAdapter();
  try {
    await db.open({ path: template });
    await new SqliteMigrationRunner(db).applyPending(loadDefaultMigrations());
  } finally { await db.close(); }
}
// Dynamic fixture imports may occur inside a case, where node:test hooks would
// belong to that case. Process lifetime and the runner's manifest own this
// immutable template; each writable copy still belongs to its case.
process.once('exit', () => { if (root) fs.rmSync(root, { recursive: true, force: true }); });

export function copyMigratedSchema(databasePath: string): void {
  fs.mkdirSync(path.dirname(databasePath), { recursive: true });
  fs.copyFileSync(template, databasePath, fs.constants.COPYFILE_EXCL);
}

/** Closed empty schema for helpers that already accept a template path. */
export function migratedSchemaPath(): string {
  if (!template) { throw new Error('migrated schema has not been prepared'); }
  return template;
}
