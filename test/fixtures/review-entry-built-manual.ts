// Manual built-artifact probe. Runs build/px.mjs (run `npm run build` first)
// against a disposable Git/SQLite fixture holding the TASK-2789 shape: an active
// Mission whose round awaits review, with retained integration-repair history.
// The agent launcher is a PATH shim that exits 0; Git, shell checks and SQLite are real.
// Run: node --import tsx --import ./test/bootstrap-parallix-home.ts test/fixtures/review-entry-built-manual.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { seedRetainedRepair } from './review-repair-recovery.js';
import { captureRecoveryEvidence } from '../../src/application/recovery-evidence.js';

const BUILT = path.resolve('build/px.mjs');

for (const phase of ['recovery', 'failed-check'] as const) {
  test(`built px review: retained repair ${phase}`, { timeout: 60000 }, async t => {
    const { fixture, opened, command } = await seedRetainedRepair(phase, t);
    const shim = fs.mkdtempSync(path.join(os.tmpdir(), 'px-shim-'));
    t.after(() => { fs.rmSync(shim, { recursive: true, force: true }); });
    for (const name of ['opencode', 'pi', 'claude', 'codex']) {
      fs.writeFileSync(path.join(shim, name), '#!/bin/sh\necho "shim $0 $*" >&2\nexit 0\n', { mode: 0o755 });
    }
    const env = { ...process.env, PATH: `${shim}:${process.env.PATH}`, PARALLIX_NO_BUBBLEWRAP: '1' };
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
    }
  });
}
