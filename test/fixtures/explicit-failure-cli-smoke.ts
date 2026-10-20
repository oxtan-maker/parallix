// Manual smoke fixture, not an executable test suite.
// Run: node --import tsx test/fixtures/explicit-failure-cli-smoke.ts
// Public CLI dispatch and review orchestration are real; mission/provider/agent
// effects use disposable ports. No operator database or model is contacted.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { resolveConfiguration } from '../../src/composition/config.js';
import { main } from '../../src/interfaces/cli/runtime.js';
import { createReviewCommand } from '../../src/interfaces/cli/review.js';
import { ReviewCommandUseCase } from '../../src/application/review-command-use-case.js';
import type { ReviewWorkflowPort } from '../../src/application/ports/review-workflow.js';
import { runReviewLoop } from '../../src/application/review-loop/review-loop.js';
import { classifyReboundReason } from '../../src/application/rebound-kernel.js';
import { gateFailureReason } from '../../src/adapters/review/review-gate-handling.js';
import { fakeReviewLoopPorts } from '../helpers/review-loop-ports.js';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'explicit-failure-cli-'));
try {
  for (const [name, diagnostic, expectedClass, repairs] of [
    ['state', 'Task state invalid for review', 'StateMachineViolation', 0],
    ['implementer', 'No recorded implementer; cannot launch conflict resolution.', 'StateMachineViolation', 0],
    ['repairable', 'AssertionError: expected 3 to equal 4', 'GateFailure', 1],
  ] as const) {
    const worktree = path.join(root, name);
    fs.mkdirSync(worktree);
    fs.writeFileSync(path.join(worktree, 'diagnostic'), diagnostic);
    const command = 'test -f repaired || { cat diagnostic; exit 1; }';
    let checks = 0;
    let classification: ReturnType<typeof classifyReboundReason> | undefined;
    const fake = fakeReviewLoopPorts({
      slug: 'disposable-smoke', worktree, provider: {},
      preReview: {
        runGate: async () => {
          checks++;
          const result = spawnSync('bash', ['-c', command], { cwd: worktree, encoding: 'utf8', timeout: 2000 });
          if (result.status === 0) { return { ok: true, command }; }
          const reason = gateFailureReason({
            ok: false, area: 'all', command, exitCode: result.status,
            stdout: result.stdout, stderr: result.stderr,
          });
          classification = classifyReboundReason(reason);
          return { ok: false, command, area: 'all', exitCode: result.status, diagnostic: result.stdout, reason };
        },
      },
      agents: { launch: async launch => {
        if (launch.role === 'implementer') { fs.writeFileSync(path.join(worktree, 'repaired'), 'verified by exact rerun'); }
        return { agent: launch.agent, result: { status: 0 } };
      } },
      artifacts: { consumeReviewer: async () => ({ consumed: true, ok: true, reviewState: 'APPROVED' }) },
    });
    const unexpected = () => { throw new Error('unexpected workflow operation'); };
    const workflow: ReviewWorkflowPort = {
      preflight: (args, options = {}) => ({ slug: 'disposable-smoke', args, options }),
      start: async () => runReviewLoop({ slug: 'disposable-smoke', implementer: 'codex', reviewer: 'claude' }, fake.ports),
      verify: unexpected, submit: unexpected, push: unexpected, continue: unexpected,
      resume: unexpected, comment: unexpected, readComments: unexpected,
      submitReview: unexpected, close: unexpected, status: unexpected, createEvent: unexpected,
      backfillReview: unexpected, reconcileReview: unexpected, importLegacy: unexpected,
    };
    await main(['review', 'disposable-smoke', '--start'], {
      runtime: resolveConfiguration({ PARALLIX_HOME: path.join(root, 'operator') }).runtime,
      cwdFn: () => worktree, commandFns: { review: createReviewCommand(new ReviewCommandUseCase(workflow)) },
      exitFn: unexpected,
    });
    assert.equal(classification?.failureClass, expectedClass);
    assert.equal(classification.dispatchAction, repairs ? 'AutoSendBack' : 'HumanOnly');
    assert.equal(fake.launches.filter(launch => launch.role === 'implementer').length, repairs);
    assert.equal(fake.launches.filter(launch => launch.role === 'reviewer').length, repairs);
    assert.deepEqual(fake.exits, repairs ? [] : [1]);
    assert.equal(checks, repairs ? 2 : 1);
    console.log(JSON.stringify({ name, ...classification, checks, launches: fake.launches.map(launch => launch.role), exits: fake.exits }));
  }
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
