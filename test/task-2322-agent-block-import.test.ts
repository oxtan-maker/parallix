import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { SqliteImporter } from '../src/adapters/sqlite/importer.js';

type BlockRow = { agent: string; blocked: number; until?: string; reason?: string };

class MockDatabase {
  readonly executed: Array<{ sql: string; params?: readonly unknown[] }> = [];
  beginCount = 0;
  commitCount = 0;
  rollbackCount = 0;

  constructor(private readonly rows: readonly BlockRow[] = [], private readonly failInsert = false) {}

  async query() { return this.rows; }
  async execute(sql: string, params?: readonly unknown[]) {
    this.executed.push({ sql, params });
    if (this.failInsert && sql.includes('INSERT INTO agent_blocklist')) {
      throw new Error('database unavailable');
    }
  }
  async beginTransaction() { this.beginCount += 1; }
  async commitTransaction() { this.commitCount += 1; }
  async rollbackTransaction() { this.rollbackCount += 1; }
}

function legacyFile(contents: unknown): { dir: string; file: string; original: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'parallix-agent-block-import-'));
  const file = path.join(dir, 'agents.local.json');
  const original = JSON.stringify(contents, null, 2);
  fs.writeFileSync(file, original);
  return { dir, file, original };
}

function remove(dir: string) { fs.rmSync(dir, { recursive: true, force: true }); }

test('legacy AgentBlock import dry run reports rows without persistence or source mutation', async () => {
  const { dir, file, original } = legacyFile({ blocklist: { codex: { blocked: true, until: '2030-01-01 00', reason: 'limit' } } });
  try {
    const db = new MockDatabase();
    const report = await new SqliteImporter(db as never).importLegacyBlocklist(file, { dryRun: true });

    assert.deepEqual(report.imported, ['codex']);
    assert.deepEqual(report.conflicts, []);
    assert.equal(db.beginCount, 0);
    assert.equal(fs.readFileSync(file, 'utf8'), original);
  } finally { remove(dir); }
});

test('legacy AgentBlock import is atomic and idempotent for a valid unchanged replay', async () => {
  const { dir, file } = legacyFile({ blocklist: { codex: { blocked: true, until: '2030-01-01 00', reason: 'limit' } } });
  try {
    const firstDb = new MockDatabase();
    const first = await new SqliteImporter(firstDb as never).importLegacyBlocklist(file);
    assert.deepEqual(first.imported, ['codex']);
    assert.equal(firstDb.beginCount, 1);
    assert.equal(firstDb.commitCount, 1);

    const replayDb = new MockDatabase([{ agent: 'codex', blocked: 1, until: '2030-01-01 00', reason: 'limit' }]);
    const replay = await new SqliteImporter(replayDb as never).importLegacyBlocklist(file);
    assert.deepEqual(replay.unchanged, ['codex']);
    assert.equal(replayDb.executed.some(({ sql }) => sql.includes('agent_blocklist')), false);
  } finally { remove(dir); }
});

test('legacy AgentBlock import reports canonical conflicts and leaves the database untouched', async () => {
  const { dir, file } = legacyFile({ blocklist: { codex: { blocked: true, until: '2030-01-01 00', reason: 'limit' } } });
  try {
    const db = new MockDatabase([{ agent: 'codex', blocked: 1, until: '2030-01-02 00', reason: 'newer' }]);
    const report = await new SqliteImporter(db as never).importLegacyBlocklist(file);
    assert.equal(report.conflicts.length, 1);
    assert.equal(report.conflicts[0]?.canonical.reason, 'newer');
    assert.equal(db.beginCount, 0);
  } finally { remove(dir); }
});

test('legacy AgentBlock import rolls back a repository failure without a partial commit', async () => {
  const { dir, file } = legacyFile({ blocklist: { codex: true } });
  try {
    const db = new MockDatabase([], true);
    await assert.rejects(new SqliteImporter(db as never).importLegacyBlocklist(file), /rolled back/);
    assert.equal(db.beginCount, 1);
    assert.equal(db.commitCount, 0);
    assert.equal(db.rollbackCount, 1);
  } finally { remove(dir); }
});

test('legacy AgentBlock import fails clearly when configuration is missing', async () => {
  const db = new MockDatabase();
  await assert.rejects(
    new SqliteImporter(db as never).importLegacyBlocklist('/definitely-not-present/agents.local.json'),
    /Blocklist source not found/,
  );
});
