/**
 * A write the review loop leaves in flight can outlive the database handle that
 * accepted it — the loop reported
 * `Could not record review stats ... Database is not open. Call open() before
 * using the adapter.` These tests pin both halves of the fix: the loop awaits
 * its stats write, and composition drains the store before closing.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { missionId, type Mission } from '../src/domain/mission.js';
import { agentFamily } from '../src/domain/agents.js';
import { repositoryId } from '../src/domain/repository.js';
import { SqliteDatabaseAdapter } from '../src/adapters/sqlite/database-adapter.js';
import { loadDefaultMigrations, SqliteMigrationRunner } from '../src/adapters/sqlite/migration-runner.js';
import { SqliteMissionStore } from '../src/adapters/sqlite/mission-store.js';
import { startReviewLoop } from '../src/adapters/review/review-loop.js';

function minimalMission(): Mission {
  return {
    id: missionId('task-9003'),
    repositoryId: repositoryId('repo-parallix'),
    title: 'writes outlive close',
    status: 'review',
    rawStatus: 'review',
    assignee: agentFamily('claude'),
    labels: [],
    checkpoints: [],
    netEngineeringLines: 0,
    closedAt: null,
    review: null,
  } as unknown as Mission;
}

test('drain resolves only after an in-flight aggregate write has settled', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'task-2339-drain-'));
  const db = new SqliteDatabaseAdapter();
  await db.open({ path: path.join(dir, 'parallix.db') });
  await new SqliteMigrationRunner(db).applyPending(loadDefaultMigrations());
  const store = new SqliteMissionStore(db);

  const order: string[] = [];
  const writing = store.save(minimalMission(), null).then(() => order.push('write'));
  const drained = store.drain().then(() => order.push('drain'));

  await Promise.all([writing, drained]);
  assert.deepEqual(order, ['write', 'drain'], 'drain must not resolve before the write settles');

  // Draining a quiet store is a no-op, and closing after it is safe.
  await store.drain();
  await db.close();
});

test('the review loop awaits its stage-stats write before moving on', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'task-2339-stats-'));
  fs.writeFileSync(
    path.join(root, 'workflow.config.json'),
    JSON.stringify({ product: {}, adapters: { review: { provider: 'none' } } }),
  );

  const order: string[] = [];
  let settleStats: () => void = () => {};
  const statsSettled = new Promise<void>((resolve) => { settleStats = resolve; });

  try {
    await startReviewLoop('task-999', {
      worktree: root,
      maxAttempts: 1,
      maybeUpdateGraphifyBeforeReviewFn: () => {},
      // Provider-disabled --start runs the inline handoff seam before the loop;
      // a no-op keeps the loop at the stats-write/consume ordering under test.
      performHandoffFn: async () => ({ ok: true }),
      resolveTaskFileFn: () => ({ ok: true, taskFile: '/tmp/task-999.md' }),
      getTaskImplementerFn: () => null,
      readReviewStateFn: () => null,
      eligibleAgentsForStepFn: () => ['codex', 'claude'],
      selectAgentFn: () => 'codex',
      rebaseBeforeReviewRoundFn: async () => ({ ok: true }),
      startAgentFn: async () => ({ ok: true, agent: 'codex', result: {} }),
      recordStageStatsSafeFn: () => {
        order.push('stats:start');
        setTimeout(() => { order.push('stats:end'); settleStats(); }, 5).unref?.();
        return statsSettled;
      },
      consumeReviewerArtifactsFn: async () => {
        order.push('consume');
        return { consumed: true, ok: true, reviewState: 'APPROVED' };
      },
      consumeImplementerArtifactsFn: async () => ({ consumed: true, ok: true, disposition: 'CHANGES_MADE' }),
      transitionTaskFn: () => true,
      transitionVirtualFn: () => true,
      writeReviewStateFn: () => {},
      log: () => {},
      error: () => {},
      exit: () => { throw new Error('exit'); },
    } as never);
  } catch {
    // The loop's later stages are not under test; the ordering already is.
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }

  const statsEnd = order.indexOf('stats:end');
  const consume = order.indexOf('consume');
  assert.ok(statsEnd !== -1, `stats write never ran: ${order.join(', ')}`);
  assert.ok(consume !== -1, `artifacts were never consumed: ${order.join(', ')}`);
  assert.ok(
    statsEnd < consume,
    `the stats write must settle before the next stage runs, got: ${order.join(', ')}`,
  );
});
