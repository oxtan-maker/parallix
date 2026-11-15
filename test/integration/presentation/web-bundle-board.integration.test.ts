// Real board projection/refresh from an isolated source-free built bundle.
// npm archive selection belongs to npm-pack-install-smoke; HTTP policy to web-bundle-shell.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SqliteDatabaseAdapter } from '../../../src/adapters/sqlite/database-adapter.js';
import { SqliteMissionStore } from '../../../src/adapters/sqlite/mission-store.js';
import { missionId } from '../../../src/domain/mission.js';
import { seedBoardLoading } from '../../fixtures/board-loading-state.js';
import { migratedSchemaPath, prepareMigratedSchema } from '../../fixtures/migrated-database.js';
import { validateWebBoardSnapshot } from '../../../src/interfaces/web/transport-validators.js';
import { get, startBundleWeb, stopHost, useWebArtifactFixture } from './web-bundle.fixture.js';

useWebArtifactFixture(true);
test.before(prepareMigratedSchema);

test('web bundle board: populated SQLite snapshot reads share one revision and the host exits cleanly', { timeout: 120_000 }, async t => {
  const stateRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'px-web-board-'));
  t.after(() => fs.rmSync(stateRoot, { recursive: true, force: true }));
  const state = await seedBoardLoading(stateRoot, 3, { telemetry: false, schemaTemplate: migratedSchemaPath() });
  // Agent discovery has its own running-session contracts. This package/SQLite
  // boundary needs no live agents, and must not scan unrelated host processes
  // on every refresh. Keep the real Git executable and all other CLI boundaries.
  const bin = path.join(stateRoot, 'bin');
  fs.mkdirSync(bin);
  fs.writeFileSync(path.join(bin, 'ps'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  const host = await startBundleWeb(t, state, { searchPath: `${bin}:/usr/bin:/bin` });
  try {
    let sharedRevision: string | null = null;
    for (let refresh = 0; refresh < 2; refresh++) {
      const response = await get(`${host.origin}/api/board`);
      assert.equal(response.status, 200, 'real packaged projection must load');
      const snapshot = validateWebBoardSnapshot(JSON.parse(response.body));
      assert.ok(snapshot.ok, 'packaged CLI must serialize a valid board snapshot');
      const backlog = snapshot.value.stages.find(stage => stage.lane === 'backlog');
      assert.equal(backlog?.count, 2);
      assert.equal(backlog.cards.find(card => card.id === 'task-9001')?.title, 'Board loading fixture 1');
      assert.equal(backlog.cards.find(card => card.id === 'task-9002')?.title, 'Board loading fixture 2');
      if (refresh === 0) {
        sharedRevision = snapshot.value.freshness.revision;
        const database = new SqliteDatabaseAdapter();
        try {
          await database.open({ path: path.join(state.home, 'parallix.db') });
          const store = new SqliteMissionStore(database);
          const loaded = await store.load(missionId('task-9001'));
          assert.equal(loaded.kind, 'found');
          await store.save({ ...loaded.mission, title: 'Updated persisted mission' }, loaded.version);
        } finally { await database.close(); }
      } else {
        assert.equal(snapshot.value.freshness.revision, sharedRevision,
          'a second read reuses the completed projection until change detection refreshes it');
      }
    }
  } finally {
    await stopHost(host);
  }
  await assert.rejects(() => get(`${host.origin}/`), 'the host and session must be unreachable once the px process has exited');
});

test('board loading fixture creates exactly the requested mission checkouts (TASK-2854.03)', async t => {
  // The benchmark names its workload by this option, so a requested total must
  // never become two halves: even, odd and fully checked out populations all
  // have to land on exactly the requested count.
  for (const requested of [4, 3, 6]) {
    const stateRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'px-board-fixture-'));
    t.after(() => fs.rmSync(stateRoot, { recursive: true, force: true }));
    const state = await seedBoardLoading(stateRoot, 6, {
      telemetry: false, schemaTemplate: migratedSchemaPath(),
      workload: { missionWorktrees: requested, analyticalRows: 0, repairRows: 0, repairFingerprintChars: 0 },
    });
    const listed = execFileSync('git', ['worktree', 'list', '--porcelain'], { cwd: state.root, encoding: 'utf8' });
    const checkouts = listed.split('\n').filter(line => line.startsWith('branch refs/heads/mission/task-')).length;

    assert.equal(state.worktrees, requested,
      `missionWorktrees=${requested} is the total checkout count, not one half of a doubled population`);
    assert.equal(checkouts, state.worktrees, `Git reports the ${requested} checkouts the fixture reports`);
  }
});
