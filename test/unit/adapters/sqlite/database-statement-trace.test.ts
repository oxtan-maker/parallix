import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { mkdtemp } from '../../../helpers/temp-dir.js';
import { SqliteDatabaseAdapter } from '../../../../src/adapters/sqlite/database-adapter.js';
import { DEFAULT_CONFIGURATION } from '../../../../src/application/ports/configuration.js';

async function traced(debugSql: string | undefined): Promise<string[]> {
  const home = mkdtemp('sql-trace-');
  const lines: string[] = [];
  const write = process.stderr.write;
  process.stderr.write = ((chunk: string | Uint8Array) => { lines.push(String(chunk)); return true; }) as typeof process.stderr.write;
  const database = new SqliteDatabaseAdapter({ ...DEFAULT_CONFIGURATION, storage: { ...DEFAULT_CONFIGURATION.storage, debugSql } });
  try {
    await database.open({ path: path.join(home, 'trace.db') });
    await database.query('SELECT 1 AS one');
    database.querySync('SELECT 2 AS two');
  } finally {
    process.stderr.write = write;
    await database.close();
    fs.rmSync(home, { recursive: true, force: true });
  }
  return lines;
}

test('statement tracing reports every query under the debug flag so a run can count them (TASK-2854.04)', async () => {
  const lines = await traced('1');
  assert.equal(lines.filter(line => line.startsWith('[sql-query]')).length, 2, 'async and sync reads are each traced once');
});

test('statement tracing is silent without the debug flag (TASK-2854.04)', async () => {
  assert.deepEqual((await traced(undefined)).filter(line => line.startsWith('[sql-')), []);
});
