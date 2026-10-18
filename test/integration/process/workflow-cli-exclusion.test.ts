// One real CLI boundary against a held owner; persistence and fencing remain real.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { workflowBoard, until } from '../../fixtures/workflow-board.js';
import { resolvePxEntryLoader, pxNodeArgs } from '../../lib/px-entry.js';
import { configureMissionWriteAuthorization } from '../../../src/application/ports/mission-write-authorization.js';
import { requireWorkflowOwner } from '../../../src/domain/workflow-operation.js';

test('real CLI refuses a held owner and stopped generation cannot write after replacement (TASK-2750)', { timeout: 15_000 }, async t => {
  const fixture = await workflowBoard(1, { inProcess: true });
  t.after(() => { configureMissionWriteAuthorization(null); });
  t.after(() => fixture.close());
  const slug = fixture.slugs[0];
  assert.equal((await fixture.service.admit({ operationId: 'first', kind: 'active:execute', missionId: slug, capabilities: new Set(['active:execute']) })).status, 'accepted');
  await until(() => fixture.entered(slug), 'held owner');
  await assert.rejects(() => promisify(execFile)(process.execPath,
    pxNodeArgs(resolvePxEntryLoader(), ['active', slug, '--implementer', 'codex']), {
      cwd: fixture.root, env: { ...fixture.configuration.forwardedEnvironment }, timeout: 10_000,
    }), (error: Error & { stdout?: string; stderr?: string }) => /workflow.*owns|owns.*mission/i.test(`${error.stdout} ${error.stderr}`));
  const old = (await fixture.service.operation('first'))!;
  assert.equal((await fixture.service.stop(slug)).status, 'completed');
  // Lightweight writers must inherit the fence in a fresh CLI process too
  // (TASK-2762); checking the parent store alone misses composition regressions.
  const beforeCheckpoint = await fixture.store.load(slug as never);
  await assert.rejects(() => promisify(execFile)(process.execPath,
    pxNodeArgs(resolvePxEntryLoader(), ['checkpoint', 'record', '--slug', slug, '--name', 'CP-1',
      '--next', 'stale agent', '--criterion', 'criterion', '--evidence', 'npm test']), {
      cwd: fixture.root, env: { ...fixture.configuration.forwardedEnvironment,
        PARALLIX_WORKFLOW_OPERATION: old.id, PARALLIX_WORKFLOW_GENERATION: String(old.generation) }, timeout: 10_000,
    }), (error: Error & { stdout?: string; stderr?: string }) => /fenced|stopped/i.test(`${error.stdout} ${error.stderr}`));
  assert.deepEqual(await fixture.store.load(slug as never), beforeCheckpoint);
  const loaded = await fixture.store.load(slug as never); assert.equal(loaded.kind, 'found');
  if (loaded.kind !== 'found') { throw new Error('Mission missing'); }
  // Settle the old in-process execution before launching a replacement with its own barrier.
  fixture.release(slug);
  assert.equal((await fixture.service.admit({ operationId: 'replacement', kind: 'active:execute', missionId: slug, capabilities: new Set(['active:execute']) })).status, 'accepted');
  await until(async () => (await fixture.service.operation('replacement'))?.phase === 'preparing', 'replacement claimed');
  configureMissionWriteAuthorization({ operationId: old.id, assert: async (_mission, read) => {
    assert.ok(read, 'fence must use the actual writer transaction');
    const owner = await read(old.id); assert.ok(owner); requireWorkflowOwner(owner, old.generation);
  } });
  try { await assert.rejects(() => fixture.store.save({ ...loaded.mission, title: 'stale writer' }, loaded.version), /fenced|stopped/i); }
  finally { configureMissionWriteAuthorization(null); }
  const unchanged = await fixture.store.load(slug as never);
  assert.equal(unchanged.kind === 'found' && unchanged.mission.title, loaded.mission.title);
  assert.equal((await fixture.service.operation('first'))?.phase, 'stopped');
});
