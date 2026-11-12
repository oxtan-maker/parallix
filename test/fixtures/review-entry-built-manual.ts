// Manual built-artifact probe. Runs build/px.mjs (run `npm run build` first)
// against a disposable Git/SQLite fixture holding the TASK-2789 shape: an active
// Mission whose round awaits review, with retained integration-repair history.
// The agent launcher is a PATH shim that exits 0; Git, shell checks and SQLite are real.
// Run: node --import tsx --import ./test/bootstrap-parallix-home.ts test/fixtures/review-entry-built-manual.ts
import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { seedRetainedRepair } from './review-repair-recovery.js';
import { captureRecoveryEvidence } from '../../src/application/recovery-evidence.js';
import { missionVersion } from '../../src/application/domain-ports.js';
import { SqliteMissionStore } from '../../src/adapters/sqlite/mission-store.js';
import { applyReviewerCommand, reviewFindingId } from '../../src/domain/review.js';
import { openRepairFixture } from '../lib/integration-repair-fixture.js';

const BUILT = path.resolve('build/px.mjs');

function builtEnvironment(t: TestContext): NodeJS.ProcessEnv {
  const shim = fs.mkdtempSync(path.join(os.tmpdir(), 'px-shim-'));
  t.after(() => { fs.rmSync(shim, { recursive: true, force: true }); });
  for (const name of ['opencode', 'pi', 'claude', 'codex']) {
    fs.writeFileSync(path.join(shim, name), '#!/bin/sh\necho "shim $0 $*" >&2\nexit 0\n', { mode: 0o755 });
  }
  return { ...process.env, PATH: `${shim}:${process.env.PATH}`, PARALLIX_NO_BUBBLEWRAP: '1' };
}

for (const phase of ['recovery', 'failed-check'] as const) {
  test(`built px review: retained repair ${phase}`, { timeout: 60000 }, async t => {
    const { fixture, opened, command } = await seedRetainedRepair(phase, t);
    const env = builtEnvironment(t);
    const px = (...args: string[]) => spawnSync('node', [BUILT, ...args], { cwd: fixture.worktree, env, encoding: 'utf8', timeout: 50000 });
    const recorded = px('checkpoint', 'record', '--slug', fixture.slug, '--name', opened.name, '--criterion', 'feature ships', '--evidence', 'feature.txt', '--next', 'Run authorized checks');
    t.diagnostic(`checkpoint record exit=${recorded.status}`);
    captureRecoveryEvidence({ missionId: fixture.slug, cwd: fixture.worktree, command, capturedRevision: fixture.approvedRevision, signal: null, exitCode: 1, stdout: 'original interrupted check', stderr: 'original gate failure' });
    const result = px('review', fixture.slug);
    const output = `${result.stdout}${result.stderr}`;
    t.diagnostic(`built px review ${phase}: exit=${result.status}\n${output.slice(-1200)}`);
    assert.doesNotMatch(output, /Review is not ready to resume/);
    const after = await fixture.load();
    t.diagnostic(`status=${after.status} repair.verified=${after.checkpoints.at(-1)?.repair?.verified}`);
    if (phase === 'failed-check') {
      assert.notEqual(result.status, 0, 'a false original check never succeeds');
      assert.equal(after.checkpoints.at(-1)?.repair?.verified, false);
      const returns = await fixture.database.query<{ from_status: string | null; to_status: string; trigger: string; return_stage: string | null }>(
        'SELECT from_status, to_status, trigger, return_stage FROM board_lane_events WHERE mission_id = ? ORDER BY id',
        [fixture.slug],
      );
      t.diagnostic(`built px review lane returns: ${JSON.stringify(returns)}`);
      assert.deepEqual(returns.filter(event => event.return_stage !== null)
        .map(event => [event.from_status, event.to_status, event.trigger, event.return_stage]),
        [['review', 'active', 'rebound-to-active', 'declared-gates']],
        'the built CLI records the gate send-back return at declared-gates');
      assert.ok(returns.every(event => event.return_stage !== 'agent-review'),
        'a declared-gate send-back never claims an agent-review return');
    }
  });
}

for (const sentBy of ['operator', 'reviewer'] as const) {
  test(`built px active resumes a ${sentBy}-sent fixing round at the stage it left`, { timeout: 90000 }, async t => {
    const fixture = await openRepairFixture({ slug: `task-resume-${sentBy}`, state: 'undecided-review' });
    t.after(() => fixture.close());
    const store = new SqliteMissionStore(fixture.database);
    const mission = await fixture.load();
    const review = applyReviewerCommand(mission.review!, {
      type: 'request-changes',
      ...(sentBy === 'operator' ? { source: { kind: 'operator' as const, author: 'magnus' } } : {}),
      decidedAt: '2026-11-10T10:30:00.000Z', comment: null,
      findings: [{ id: reviewFindingId('resume-finding'), summary: 'Unresolved resume finding', location: null }],
    });
    await store.save({ ...mission, review }, missionVersion(await fixture.version()));
    const result = spawnSync('node', [BUILT, 'active', fixture.slug], {
      cwd: fixture.worktree, env: builtEnvironment(t), encoding: 'utf8', timeout: 80000,
    });
    t.diagnostic(`built px active (${sentBy} round): exit=${result.status}\n${`${result.stdout}${result.stderr}`.slice(-1200)}`);
    const returns = await fixture.database.query<{ from_status: string | null; to_status: string;
      trigger: string; return_stage: string | null }>(
      'SELECT from_status, to_status, trigger, return_stage FROM board_lane_events WHERE mission_id = ? ORDER BY id',
      [fixture.slug],
    );
    assert.deepEqual(returns.filter(event => event.trigger === 'rebound-to-active')
      .map(event => [event.from_status, event.to_status, event.return_stage]),
    [['review', 'active', sentBy === 'operator' ? 'human-review' : 'agent-review']]);
  });
}
