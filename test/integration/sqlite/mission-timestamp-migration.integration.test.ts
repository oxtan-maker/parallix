import { afterEach, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { SqliteBoardLaneEventRepository } from '../../../src/adapters/sqlite/board-lane-event-repository.js';
import { SqliteDatabaseAdapter } from '../../../src/adapters/sqlite/database-adapter.js';
import { loadDefaultMigrations, SqliteMigrationRunner } from '../../../src/adapters/sqlite/migration-runner.js';
import {
  applyMissionTimestampMigration,
  auditMissionTimestamps,
  classifyInstant,
  MISSION_TIMESTAMP_COLUMNS,
} from '../../../scripts/mission-timestamp-migration.js';

const tempDirs: string[] = [];

function tempDatabasePath(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'parallix-ts-migrate-'));
  tempDirs.push(dir);
  return path.join(dir, 'operator.db');
}

async function migratedDatabase(databasePath = tempDatabasePath()): Promise<SqliteDatabaseAdapter> {
  const database = new SqliteDatabaseAdapter();
  await database.open({ path: databasePath });
  await new SqliteMigrationRunner(database).applyPending(loadDefaultMigrations());
  return database;
}

async function seedMixedFormat(database: SqliteDatabaseAdapter): Promise<void> {
  // board_lane_events.occurred_at: offset, canonical UTC, naive (ambiguous),
  // date-only (ambiguous), and malformed.
  const events = [
    '2026-10-09T09:00:00+02:00', // -> 07:00:00.000Z (convert)
    '2026-10-09T08:00:00.000Z', // canonical
    '2026-10-09T07:30:00', // naive -> ambiguous
    '2026-10-09', // date-only -> ambiguous
    'not-a-timestamp', // malformed
  ];
  for (let index = 0; index < events.length; index += 1) {
    const raw = events[index]!;
    const identity = `task-e${index}`;
    await database.execute(
      `INSERT INTO board_lane_events (repository_id, mission_id, from_status, to_status, trigger, agent, occurred_at, idempotency_key)
       VALUES ('repo', ?, 'backlog', 'active', 'activate', 'codex', ?, ?)`,
      [identity, raw, `key-${identity}`],
    );
  }
  // missions.closed_at: an offset closure and a canonical one.
  await database.execute(
    `INSERT INTO missions (id, repository_id, title, status, closed_at, version)
     VALUES ('task-m1', 'repo', 'M1', 'done', ?, 1)`,
    ['2026-10-09T12:00:00+05:00'], // -> 07:00:00.000Z (convert)
  );
  await database.execute(
    `INSERT INTO missions (id, repository_id, title, status, closed_at, version)
     VALUES ('task-m2', 'repo', 'M2', 'done', ?, 1)`,
    ['2026-10-09T06:15:00.000Z'], // canonical
  );
}

async function occurredByMission(database: SqliteDatabaseAdapter): Promise<ReadonlyArray<{ mission_id: string; occurred_at: string }>> {
  return database.query(`SELECT mission_id, occurred_at FROM board_lane_events ORDER BY id`);
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

it('classifies every stored spelling against the UTC/offset/ambiguous/malformed contract', async () => {
  assert.deepEqual(classifyInstant('2026-10-09T07:07:00.000Z'), { classification: 'canonical', instantMs: Date.parse('2026-10-09T07:07:00.000Z') });
  assert.equal(classifyInstant('2026-10-09T09:07:00+02:00').classification, 'convert');
  assert.equal(classifyInstant('2026-10-09T07:30:00').classification, 'ambiguous');
  assert.equal(classifyInstant('2026-10-09').classification, 'ambiguous');
  assert.equal(classifyInstant('not-a-timestamp').classification, 'malformed');
});

it('audits mixed-format fixtures and reports each by record and field', async () => {
  const database = await migratedDatabase();
  try {
    await seedMixedFormat(database);
    const audit = await auditMissionTimestamps(database, MISSION_TIMESTAMP_COLUMNS);
    assert.equal(audit.toConvert, 2); // one occurred_at + one closed_at
    assert.equal(audit.ambiguous, 2); // naive + date-only occurred_at
    assert.equal(audit.malformed, 1);
    const occurred = audit.columns.find((column) => column.column[1] === 'occurred_at');
    assert.ok(occurred);
    const malformed = occurred!.values.find((value) => value.classification === 'malformed');
    assert.equal(malformed?.raw, 'not-a-timestamp'); // record identity is preserved in the report
  } finally {
    await database.close();
  }
});

it('converts offset instants to canonical UTC while preserving each instant, and leaves ambiguous/malformed values', async () => {
  const database = await migratedDatabase();
  try {
    await seedMixedFormat(database);
    const audit = await auditMissionTimestamps(database, MISSION_TIMESTAMP_COLUMNS);
    const result = await applyMissionTimestampMigration(database, audit, () => database.backup());
    assert.equal(result.converted, 2);
    assert.equal(result.preserved, 3); // 2 ambiguous + 1 malformed

    const rows = await occurredByMission(database);
    const byMission = new Map(rows.map((row) => [row.mission_id, row.occurred_at]));
    // Offset converted to UTC, instant identical.
    assert.equal(byMission.get('task-e0'), '2026-10-09T07:00:00.000Z');
    // Canonical values unchanged.
    assert.equal(byMission.get('task-e1'), '2026-10-09T08:00:00.000Z');
    // Ambiguous and malformed values preserved verbatim.
    assert.equal(byMission.get('task-e2'), '2026-10-09T07:30:00');
    assert.equal(byMission.get('task-e3'), '2026-10-09');
    assert.equal(byMission.get('task-e4'), 'not-a-timestamp');

    const missions = await database.query(`SELECT closed_at FROM missions WHERE id = 'task-m1'`);
    assert.equal((missions[0] as { closed_at: string }).closed_at, '2026-10-09T07:00:00.000Z');
  } finally {
    await database.close();
  }
});

it('is idempotent: a second migration converts nothing and writes no new backup', async () => {
  const databasePath = tempDatabasePath();
  const database = await migratedDatabase(databasePath);
  try {
    await seedMixedFormat(database);
    const first = await applyMissionTimestampMigration(
      database,
      await auditMissionTimestamps(database, MISSION_TIMESTAMP_COLUMNS),
      () => database.backup(),
    );
    const backupsAfterFirst = fs.readdirSync(path.dirname(databasePath)).filter((name) => name.startsWith('operator.db.bak.')).length;

    const second = await applyMissionTimestampMigration(
      database,
      await auditMissionTimestamps(database, MISSION_TIMESTAMP_COLUMNS),
      () => database.backup(),
    );
    const backupsAfterSecond = fs.readdirSync(path.dirname(databasePath)).filter((name) => name.startsWith('operator.db.bak.')).length;

    assert.equal(second.converted, 0);
    assert.equal(first.converted, 2);
    assert.equal(backupsAfterSecond, backupsAfterFirst, 'idempotent run must not write a new backup');
  } finally {
    await database.close();
  }
});

it('makes lexical ORDER BY occurred_at agree with temporal order after migration', async () => {
  const database = await migratedDatabase();
  try {
    // Two events whose offset spellings sort lexically opposite to their
    // temporal order: the +02:00 event is earlier in time but later lexically.
    await database.execute(
      `INSERT INTO board_lane_events (repository_id, mission_id, from_status, to_status, trigger, agent, occurred_at, idempotency_key)
       VALUES ('repo', 'task-early', 'backlog', 'active', 'activate', 'codex', ?, 'key-early')`,
      ['2026-10-09T09:00:00+02:00'], // 07:00Z (earlier)
    );
    await database.execute(
      `INSERT INTO board_lane_events (repository_id, mission_id, from_status, to_status, trigger, agent, occurred_at, idempotency_key)
       VALUES ('repo', 'task-late', 'backlog', 'active', 'activate', 'codex', ?, 'key-late')`,
      ['2026-10-09T08:00:00Z'], // 08:00Z (later)
    );
    const lexicalBefore = await database.query<{ mission_id: string }>(`SELECT mission_id FROM board_lane_events ORDER BY occurred_at ASC`);
    assert.equal(lexicalBefore[0]!.mission_id, 'task-late'); // lexical: Z before +02:00

    const audit = await auditMissionTimestamps(database, MISSION_TIMESTAMP_COLUMNS);
    await applyMissionTimestampMigration(database, audit, () => database.backup());

    const lexicalAfter = await database.query<{ mission_id: string }>(`SELECT mission_id FROM board_lane_events ORDER BY occurred_at ASC`);
    assert.equal(lexicalAfter[0]!.mission_id, 'task-early'); // now lexical matches temporal
    assert.equal(lexicalAfter[1]!.mission_id, 'task-late');
  } finally {
    await database.close();
  }
});

it('restores a pre-migration backup, returning offset values to their original storage', async () => {
  const databasePath = tempDatabasePath();
  const database = await migratedDatabase(databasePath);
  try {
    await seedMixedFormat(database);
    const audit = await auditMissionTimestamps(database, MISSION_TIMESTAMP_COLUMNS);
    const result = await applyMissionTimestampMigration(database, audit, () => database.backup());
    assert.ok(result.backupPath);
    assert.ok(fs.existsSync(result.backupPath!));

    // Corrupt a converted value, then restore from the backup.
    await database.execute(`UPDATE board_lane_events SET occurred_at = 'CORRUPTED' WHERE mission_id = 'task-e0'`);
    const restored = await database.query<{ occurred_at: string }>(`SELECT occurred_at FROM board_lane_events WHERE mission_id = 'task-e0'`);
    assert.equal(restored[0]!.occurred_at, 'CORRUPTED');

    const ok = await database.recoverFromBackup();
    assert.equal(ok, true);
    const after = await database.query<{ occurred_at: string }>(`SELECT occurred_at FROM board_lane_events WHERE mission_id = 'task-e0'`);
    assert.equal(after[0]!.occurred_at, '2026-10-09T09:00:00+02:00');
  } finally {
    await database.close();
  }
});

it('reads mixed offsets in instant order with stable equivalent-instant ties (TASK-2688)', async () => {
  const database = await migratedDatabase();
  try {
    const spellings = ['2026-10-09T08:00:00Z', '2026-10-09T09:00:00+02:00', '2026-10-09T07:00:00.000Z'];
    for (const [index, raw] of spellings.entries()) {
      await database.execute(`INSERT INTO board_lane_events (repository_id, mission_id, to_status, trigger, agent, occurred_at, idempotency_key)
        VALUES ('repo', 'task-order', 'active', 'activate', 'codex', ?, ?)`, [raw, `order-${index}`]);
    }
    const repository = new SqliteBoardLaneEventRepository(database);
    for (const entries of [await repository.findAll(), await repository.findByMissionId('task-order'), await repository.findByRepositoryId('repo')]) {
      assert.deepEqual(entries.map(entry => entry.occurredAt), [spellings[1], spellings[2], spellings[0]]);
    }
    await repository.append({ repositoryId: 'repo', missionId: 'task-write', fromStatus: null, toStatus: 'active', trigger: 'activate', agent: 'codex', occurredAt: spellings[1]!, idempotencyKey: 'canonical-write' });
    assert.equal((await repository.findByMissionId('task-write'))[0]!.occurredAt, '2026-10-09T07:00:00.000Z');
  } finally { await database.close(); }
});

it('preserves complete rows, dates and unsupported precision without guessing (TASK-2688)', async () => {
  const database = await migratedDatabase();
  try {
    await seedMixedFormat(database);
    for (const [index, raw] of ['2026-10-09T07:07:00.123456Z', '2026-02-30T07:00:00.000Z', '   '].entries()) {
      await database.execute(`INSERT INTO board_lane_events (repository_id, mission_id, to_status, trigger, agent, occurred_at, idempotency_key)
        VALUES ('repo', 'task-preserve', 'active', 'activate', 'codex', ?, ?)`, [raw, `preserve-${index}`]);
    }
    await database.execute(`INSERT INTO usage_statistics (date, repo, mission) VALUES ('2026-10-09', 'repo', 'task-m1')`);
    const eventsBefore = await database.query<Record<string, unknown>>('SELECT * FROM board_lane_events ORDER BY id');
    const missionsBefore = await database.query<Record<string, unknown>>('SELECT * FROM missions ORDER BY id');
    const measurements = await database.query('SELECT * FROM usage_statistics');
    const audit = await auditMissionTimestamps(database);
    assert.equal(audit.malformed, 4);
    const result = await applyMissionTimestampMigration(database, audit, () => database.backup());
    assert.equal(result.converted, 2);
    const eventsAfter = await database.query<Record<string, unknown>>('SELECT * FROM board_lane_events ORDER BY id');
    const missionsAfter = await database.query<Record<string, unknown>>('SELECT * FROM missions ORDER BY id');
    for (const [before, after, field] of [[eventsBefore, eventsAfter, 'occurred_at'], [missionsBefore, missionsAfter, 'closed_at']] as const) {
      assert.equal(after.length, before.length);
      for (const [index, original] of before.entries()) {
        const updated = after[index]!;
        assert.deepEqual({ ...updated, [field]: original[field] }, { ...original });
        const raw = String(original[field]);
        if (classifyInstant(raw).classification === 'convert') {
          assert.equal(Date.parse(String(updated[field])), Date.parse(raw));
        } else { assert.equal(updated[field], original[field]); }
      }
    }
    assert.deepEqual(await database.query('SELECT * FROM usage_statistics'), measurements);
    assert.equal((await applyMissionTimestampMigration(database, await auditMissionTimestamps(database), () => database.backup())).converted, 0);
    assert.equal(await database.recoverFromBackup(), true);
    assert.deepEqual(await database.query('SELECT * FROM board_lane_events ORDER BY id'), eventsBefore);
    assert.deepEqual(await database.query('SELECT * FROM missions ORDER BY id'), missionsBefore);
  } finally { await database.close(); }
});
