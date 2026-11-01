// Real board projection/refresh from an isolated source-free built bundle.
// npm archive selection belongs to npm-pack-install-smoke; HTTP policy to web-bundle-shell.
import test from 'node:test';
import assert from 'node:assert/strict';
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

test('web bundle board: populated SQLite snapshots refresh and the host exits cleanly', { timeout: 120_000 }, async t => {
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
    for (let refresh = 0; refresh < 2; refresh++) {
      const response = await get(`${host.origin}/api/board`);
      assert.equal(response.status, 200, 'real packaged projection must load and refresh');
      const snapshot = validateWebBoardSnapshot(JSON.parse(response.body));
      assert.ok(snapshot.ok, 'packaged CLI must serialize a valid board snapshot');
      const backlog = snapshot.value.stages.find(stage => stage.lane === 'backlog');
      assert.equal(backlog?.count, 2);
      assert.equal(backlog.cards.find(card => card.id === 'task-9001')?.title,
        refresh === 0 ? 'Board loading fixture 1' : 'Updated persisted mission');
      assert.equal(backlog.cards.find(card => card.id === 'task-9002')?.title, 'Board loading fixture 2');
      if (refresh === 0) {
        const database = new SqliteDatabaseAdapter();
        try {
          await database.open({ path: path.join(state.home, 'parallix.db') });
          const store = new SqliteMissionStore(database);
          const loaded = await store.load(missionId('task-9001'));
          assert.equal(loaded.kind, 'found');
          await store.save({ ...loaded.mission, title: 'Updated persisted mission' }, loaded.version);
        } finally { await database.close(); }
      }
    }
  } finally {
    await stopHost(host);
  }
  await assert.rejects(() => get(`${host.origin}/`), 'the host and session must be unreachable once the px process has exited');
});
