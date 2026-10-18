// Real board projection/refresh from an isolated source-free built bundle.
// npm archive selection belongs to npm-pack-install-smoke; HTTP policy to web-bundle-shell.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { seedBoardLoading } from '../../fixtures/board-loading-state.js';
import { validateWebBoardSnapshot } from '../../../src/interfaces/web/transport-validators.js';
import { get, startBundleWeb, stopHost, useWebArtifactFixture } from './web-bundle.fixture.js';

useWebArtifactFixture(true);

test('web bundle board: populated SQLite snapshots refresh and the host exits cleanly', { timeout: 120_000 }, async t => {
  const stateRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'px-web-board-'));
  t.after(() => fs.rmSync(stateRoot, { recursive: true, force: true }));
  const state = await seedBoardLoading(stateRoot, 3, { telemetry: false });
  const host = await startBundleWeb(t, state);
  try {
    for (let refresh = 0; refresh < 2; refresh++) {
      const response = await get(`${host.origin}/api/board`);
      assert.equal(response.status, 200, 'real packaged projection must load and refresh');
      const snapshot = validateWebBoardSnapshot(JSON.parse(response.body));
      assert.ok(snapshot.ok, 'packaged CLI must serialize a valid board snapshot');
      const backlog = snapshot.value.stages.find(stage => stage.lane === 'backlog');
      assert.equal(backlog?.count, 2);
      assert.equal(backlog.cards.find(card => card.id === 'task-9001')?.title, 'Board loading fixture 1');
      assert.equal(backlog.cards.find(card => card.id === 'task-9002')?.title, 'Board loading fixture 2');
    }
  } finally {
    await stopHost(host);
  }
  await assert.rejects(() => get(`${host.origin}/`), 'the host and session must be unreachable once the px process has exited');
});
