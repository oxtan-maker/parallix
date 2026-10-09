/**
 * CLI wrapper for the audited mission-timestamp migration (TASK-2688).
 *
 * The classification, audit and conversion logic lives in
 * `scripts/mission-timestamp-migration.ts`; this script only resolves
 * the database path, backs up, and drives the modes.
 *
 * Modes:
 *   dry-run   report every row's classification; change nothing
 *   migrate   back up the database, then convert offset instants to UTC
 *   recover   restore the most recent `<db>.bak.<ts>` snapshot
 *
 * Usage:
 *   tsx scripts/normalize-mission-timestamps.ts --mode dry-run [--home DIR]
 *   tsx scripts/normalize-mission-timestamps.ts --mode migrate [--home DIR]
 *   tsx scripts/normalize-mission-timestamps.ts --mode recover [--home DIR]
 */
import fs from 'node:fs';
import { SqliteDatabaseAdapter } from '../src/adapters/sqlite/database-adapter.js';
import { resolveDatabasePath } from '../src/adapters/sqlite/database-path-resolver.js';
import {
  applyMissionTimestampMigration,
  auditMissionTimestamps,
  type MigrationAudit,
} from './mission-timestamp-migration.js';

type Mode = 'dry-run' | 'migrate' | 'recover';

function parseArgs(argv: readonly string[]): { mode: Mode; home?: string } {
  let mode: Mode = 'dry-run';
  let home: string | undefined;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--mode') {
      const value = argv[i + 1];
      if (value !== 'dry-run' && value !== 'migrate' && value !== 'recover') {
        throw new Error(`--mode must be dry-run, migrate or recover; got ${JSON.stringify(value)}`);
      }
      mode = value;
      i += 1;
    } else if (arg === '--home') {
      home = argv[i + 1];
      i += 1;
    }
  }
  return { mode, home };
}

async function openDatabase(dbPath: string): Promise<SqliteDatabaseAdapter> {
  const adapter = new SqliteDatabaseAdapter();
  await adapter.open({ path: dbPath });
  return adapter;
}

function printReport(audit: MigrationAudit): void {
  for (const { column, values } of audit.columns) {
    const total = values.length;
    const canonical = values.filter((v) => v.classification === 'canonical').length;
    const convert = values.filter((v) => v.classification === 'convert').length;
    const ambiguous = values.filter((v) => v.classification === 'ambiguous').length;
    const malformed = values.filter((v) => v.classification === 'malformed').length;
    console.log(
      `${column[0]}.${column[1]}: ${total} non-empty values — ` +
      `${canonical} canonical, ${convert} to convert, ${ambiguous} ambiguous, ${malformed} malformed`,
    );
    for (const value of values.filter((v) => v.classification !== 'canonical')) {
      console.log(`  [${value.classification.toUpperCase()}] id=${value.id} raw=${JSON.stringify(value.raw)}`);
    }
  }
  console.log(
    `\nSummary: ${audit.toConvert} value(s) convert to UTC, ` +
    `${audit.ambiguous} ambiguous (preserved), ${audit.malformed} malformed (preserved).`,
  );
}

async function runDryRun(dbPath: string): Promise<void> {
  const adapter = await openDatabase(dbPath);
  try {
    const audit = await auditMissionTimestamps(adapter);
    printReport(audit);
    if (audit.toConvert === 0) {
      console.log('\nNo offset instants to normalize. Database already canonical.');
    } else {
      console.log(`\nDry-run complete. Re-run with --mode migrate to convert ${audit.toConvert} value(s).`);
    }
  } finally {
    await adapter.close();
  }
}

async function runMigrate(dbPath: string): Promise<void> {
  const adapter = await openDatabase(dbPath);
  try {
    const audit = await auditMissionTimestamps(adapter);
    printReport(audit);
    if (audit.toConvert === 0) {
      console.log('Nothing to migrate (no offset instants). No backup written.');
      return;
    }
    if (audit.malformed > 0 || audit.ambiguous > 0) {
      console.log(
        `\nWARNING: ${audit.ambiguous} ambiguous and ${audit.malformed} malformed value(s) will be preserved. ` +
        `${audit.toConvert} valid offset instant(s) will be converted to UTC.`,
      );
    }
    const result = await applyMissionTimestampMigration(adapter, audit, () => adapter.backup());
    console.log(
      `Migration complete: ${result.converted} value(s) converted to canonical UTC, ` +
      `${result.preserved} preserved. Backup: ${result.backupPath}`,
    );
  } finally {
    await adapter.close();
  }
}

async function runRecover(dbPath: string): Promise<void> {
  const adapter = await openDatabase(dbPath);
  try {
    const ok = await adapter.recoverFromBackup();
    if (ok) {
      console.log('Recovery complete: restored from the most recent backup.');
    } else {
      console.log('No backup available to recover from.');
      process.exitCode = 1;
    }
  } finally {
    await adapter.close();
  }
}

async function main(): Promise<void> {
  const { mode, home } = parseArgs(process.argv.slice(2));
  const dbPath = resolveDatabasePath({ home });
  console.log(`Target database: ${dbPath}`);
  console.log(`Mode: ${mode}`);
  if (!fs.existsSync(dbPath)) {
    console.log('No database file present; nothing to do.');
    return;
  }
  if (mode === 'dry-run') { await runDryRun(dbPath); }
  else if (mode === 'migrate') { await runMigrate(dbPath); }
  else { await runRecover(dbPath); }
}

void main();
