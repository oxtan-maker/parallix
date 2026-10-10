// TASK-2709: the composed review loop hands its resolved configuration to the pre-review
// rebase's conflict-resolution launcher. Kept apart from rebase-before-review-contract.test.ts,
// whose module facades route the rebase to the ambient working tree instead of the disposable repo.
import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import childProcess from 'node:child_process';
import { resolveConfiguration } from '../../../src/composition/config.js';
import { createIntegratePorts } from '../../../src/adapters/cli/commands/integrate.js';
import { runReviewLoop } from '../../../src/application/review-loop/review-loop.js';
import { fakeReviewLoopPorts } from '../../helpers/review-loop-ports.js';
import { createReviewLoopPorts } from '../../../src/adapters/review/review-loop.js';

/** Disposable repo with a shared-file conflict, a codex-assigned task and a fake implementer that resolves it. */
function conflictRepo(root: string, extraConfig: Record<string, unknown> = {}) {
  const binDir = path.join(root, 'bin');
  const repo = path.join(root, 'repo');
  const git = (...args: string[]) => childProcess.spawnSync('git', args, { cwd: repo, encoding: 'utf8' });
  fs.mkdirSync(binDir);
  fs.mkdirSync(path.join(repo, 'backlog', 'tasks'), { recursive: true });
  git('init', '-b', 'main');
  git('config', 'user.email', 'test@example.com');
  git('config', 'user.name', 'Test User');
  fs.writeFileSync(path.join(repo, 'workflow.config.json'), JSON.stringify({ adapters: { review: { provider: 'forgejo' }, ...extraConfig } }));
  fs.writeFileSync(path.join(repo, 'backlog', 'tasks', 'task-lcfg-iso - t.md'), '---\nid: TASK-2709\ntitle: t\nstatus: active\nassignee: [codex]\n---\n');
  fs.writeFileSync(path.join(repo, 'shared.txt'), 'base\n');
  git('add', '.');
  git('commit', '-m', 'base');
  git('checkout', '-b', 'mission/task-lcfg-iso');
  fs.writeFileSync(path.join(repo, 'shared.txt'), 'mission\n');
  git('commit', '-am', 'mission change');
  git('checkout', 'main');
  fs.writeFileSync(path.join(repo, 'shared.txt'), 'main\n');
  git('commit', '-am', 'main change');
  git('checkout', 'mission/task-lcfg-iso');

  // Fake implementer: resolves the conflict and continues the rebase in its `--cd` directory.
  const launches = path.join(root, 'launches.log');
  fs.writeFileSync(path.join(binDir, 'codex'), [
    '#!/bin/sh',
    'while [ $# -gt 0 ] && [ "$1" != "--cd" ]; do shift; done',
    '[ $# -gt 0 ] || exit 0',
    `echo launched >> '${launches}'`,
    'cd "$2" || exit 1',
    'printf "resolved\\n" > shared.txt',
    'git add shared.txt',
    'GIT_EDITOR=true git rebase --continue',
  ].join('\n'), { mode: 0o755 });
  return { repo, binDir, launches, git };
}

describe("pre-review rebase launcher configuration", () => {
  // TASK-2709: the composed review loop must hand its resolved configuration to the
  // conflict-resolution launcher, or executable discovery falls back to an empty search path.
  test('shared conflicts reach the recorded implementer found through the composed configuration (TASK-2709)', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'px-launcher-cfg-'));
    const priorHome = process.env.PARALLIX_HOME;
    process.env.PARALLIX_HOME = path.join(root, 'home');
    try {
      const { repo, binDir, launches, git } = conflictRepo(root);
      const configuration = resolveConfiguration({ PATH: `${binDir}:${process.env.PATH}`, PARALLIX_TEST_NO_FORGEJO: '1', FORGEJO_URL: 'http://127.0.0.1:1', PARALLIX_HOME: path.join(root, 'home') });
      const logs: string[] = [];
      const ports = createReviewLoopPorts('task-lcfg-iso', { worktree: repo, verbose: true }, {
        configuration, log: line => logs.push(line), error: line => logs.push(line), exit: () => {},
      });
      await ports.preReview.rebase();

      assert.equal(fs.existsSync(launches), true, `implementer was never launched: ${logs.join(' | ')}`);
      assert.equal(git('status', '--porcelain', '--untracked-files=no').stdout.trim(), '', 'rebase must leave a clean tree');
      assert.equal(fs.existsSync(path.join(repo, '.git', 'rebase-merge')), false, 'rebase must be finished');
      assert.equal(fs.readFileSync(path.join(repo, 'shared.txt'), 'utf8'), 'resolved\n');
      // Publication needs a provider this disposable repository does not have; a conflict failure would not.
      assert.equal(logs.some(line => /Shared-file rebase conflicts detected/.test(line)), false, logs.join(' | '));
    } finally {
      if (priorHome === undefined) { delete process.env.PARALLIX_HOME; } else { process.env.PARALLIX_HOME = priorHome; }
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test('conflict rebase completes and the verification gate runs before the renewed reviewer launches (TASK-2709)', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'px-launcher-cfg-order-'));
    const priorHome = process.env.PARALLIX_HOME;
    process.env.PARALLIX_HOME = path.join(root, 'home');
    try {
      const order = path.join(root, 'order.log');
      const { repo, binDir, launches } = conflictRepo(root, { verification: { command: `echo verify-gate >> '${order}'` } });
      const configuration = resolveConfiguration({ PATH: `${binDir}:${process.env.PATH}`, PARALLIX_TEST_NO_FORGEJO: '1', FORGEJO_URL: 'http://127.0.0.1:1', PARALLIX_HOME: path.join(root, 'home') });
      const real = createReviewLoopPorts('task-lcfg-iso', { worktree: repo, verbose: true }, {
        configuration, log: () => {}, error: () => {}, exit: () => {},
      });
      const note = (event: string) => fs.appendFileSync(order, `${event}\n`);
      const fake = fakeReviewLoopPorts({
        slug: 'task-lcfg-iso',
        worktree: repo,
        routing: { eligibleFamilies: () => ['codex', 'claude'] },
        preReview: {
          // Real composed rebase (publication is not reachable here) and real verification gate.
          rebase: async () => { await real.preReview.rebase(); note(fs.existsSync(launches) ? 'rebase-with-implementer' : 'rebase-without-implementer'); return { ok: true }; },
          runGate: real.preReview.runGate,
        },
        agents: { launch: async launch => { note(`launch:${launch.role}`); return { agent: launch.agent, result: { status: 0 } }; } },
        artifacts: { consumeReviewer: async () => ({ consumed: true, ok: true, reviewState: 'APPROVED' }) },
      });
      await runReviewLoop({ slug: 'task-lcfg-iso', implementer: 'codex', reviewer: 'claude', maxAttempts: 1, skipHandoff: true }, fake.ports);

      // The rebase's own push check may also run the gate; what matters is the loop's gate after the rebase.
      const events = fs.readFileSync(order, 'utf8').trim().split('\n');
      assert.deepEqual(events.slice(-3), ['rebase-with-implementer', 'verify-gate', 'launch:reviewer'], events.join(','));
      assert.equal(fs.existsSync(path.join(repo, '.git', 'rebase-merge')), false, 'rebase must be finished');
    } finally {
      if (priorHome === undefined) { delete process.env.PARALLIX_HOME; } else { process.env.PARALLIX_HOME = priorHome; }
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test('integration rebase port discovers the implementer through the composed configuration (TASK-2709)', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'px-launcher-cfg-int-'));
    try {
      fs.writeFileSync(path.join(root, 'codex'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
      const configuration = resolveConfiguration({ PATH: `${root}:${process.env.PATH}` });
      const port = createIntegratePorts(configuration).rebase.createRebaseWorkflowPort({ gitFn: (() => ({ status: 0, stdout: '', stderr: '' })) as never, exitFn: () => {} });
      assert.equal(port.workflowLauncherStatus('codex').supported, true, JSON.stringify(port.workflowLauncherStatus('codex')));
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
