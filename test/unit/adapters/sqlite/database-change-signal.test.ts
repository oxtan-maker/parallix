import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp } from '../../../helpers/temp-dir.js';
import { databaseChangeSignal } from '../../../../src/adapters/sqlite/database-change-signal.js';

async function eventually(condition: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 100 && !condition(); attempt++) { await new Promise(resolve => setTimeout(resolve, 10)); }
}

test('a write to the database or its WAL wakes the subscriber and unrelated files do not (TASK-2854.04)', async () => {
  const home = mkdtemp('db-change-signal-');
  let wakes = 0;
  const stop = databaseChangeSignal(path.join(home, 'parallix.db'))(() => { wakes += 1; });
  try {
    fs.writeFileSync(path.join(home, 'other.json'), '{}');
    await new Promise(resolve => setTimeout(resolve, 60));
    assert.equal(wakes, 0, 'an unrelated file in the same directory is ignored');
    fs.writeFileSync(path.join(home, 'parallix.db-wal'), 'x');
    await eventually(() => wakes > 0);
    assert.ok(wakes > 0, 'a WAL write wakes the subscriber');
    stop();
    const settled = wakes;
    fs.writeFileSync(path.join(home, 'parallix.db'), 'y');
    await new Promise(resolve => setTimeout(resolve, 60));
    assert.equal(wakes, settled, 'a stopped signal no longer wakes');
  } finally { stop(); fs.rmSync(home, { recursive: true, force: true }); }
});

test('a database directory that does not exist yields a signal that never wakes and stops cleanly (TASK-2854.04)', () => {
  const stop = databaseChangeSignal(path.join(os.tmpdir(), 'db-change-signal-missing', 'parallix.db'))(() => assert.fail('no wake expected'));
  stop();
});
