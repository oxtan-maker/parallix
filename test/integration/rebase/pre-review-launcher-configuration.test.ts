import { fixtureMission, inMemoryTransitionStore } from '../../fixtures/mission-builders.js';
import { agentFamily } from '../../../src/domain/agents.js';
// TASK-2709: the composed review loop hands its resolved configuration to the pre-review
// rebase's conflict-resolution launcher. Kept apart from rebase-before-review-contract.test.ts,
// whose module facades route the rebase to the ambient working tree instead of the disposable repo.
import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import childProcess from 'node:child_process';
import { createRebaseWorkflowPort } from '../../../src/adapters/rebase/rebase-workflow-adapter.js';
import { setCommandPathProbe, setLauncherHealthProbe } from '../../../src/adapters/agents/agents.js';
import { createHandoffPorts } from '../../../src/adapters/cli/commands/handoff.js';
import { resolveConfiguration } from '../../../src/composition/config.js';
import { createIntegratePorts } from '../../../src/adapters/cli/commands/integrate.js';
import { runReviewLoop } from '../../../src/application/review-loop/review-loop.js';
import { fakeReviewLoopPorts } from '../../helpers/review-loop-ports.js';
import { createRebaseCommand } from '../../../src/interfaces/cli/rebase.js';
import { rebase } from '../../../src/adapters/cli/commands/rebase.js';
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
    `printf '%s' "$TASK_2744_ENV" > '${path.join(root, 'child-environment')}'`,
    'cd "$2" || exit 1',
    'printf "resolved\\n" > shared.txt',
    'git add shared.txt',
    'GIT_EDITOR=true git rebase --continue',
  ].join('\n'), { mode: 0o755 });
  return { repo, binDir, launches, git };
}

describe("pre-review rebase launcher configuration", () => {
  test.before(() => { setCommandPathProbe(null); setLauncherHealthProbe(null); });
  test('nested handoff resolves shared conflicts with Codex only in supplied PATH (TASK-2744)', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'px-handoff-cfg-'));
    const prior = process.env.TASK_2744_ENV;
    process.env.TASK_2744_ENV = 'ambient';
    try {
      const { repo, binDir, launches, git } = conflictRepo(root);
      const configuration = resolveConfiguration({ PATH: `${binDir}:/usr/bin:/bin`, PARALLIX_HOME: path.join(root, 'home'), TASK_2744_ENV: 'composed' });
      const logs: string[] = [];
      const options = {
        isForgejoReviewEnabledFn: () => true,
        worktree: repo, log: (line: string) => logs.push(line), error: (line: string) => logs.push(line),
        rebaseWorkflowOptions: {
          readTokenFn: () => 'fixture-token', resolveForgejoUserFn: () => 'fixture-user',
          createPrFn: () => ({ ok: true as const }),
        },
      };
      const result = await createHandoffPorts(configuration).rebase.rebaseBeforeReviewRound('task-lcfg-iso', options);
      assert.equal(fs.existsSync(launches), true, `Codex was not detected/launched: ${logs.join(' | ')}`);
      assert.equal(result.ok, true, JSON.stringify(result));
      assert.equal(fs.readFileSync(path.join(root, 'child-environment'), 'utf8'), 'composed');
      assert.equal(git('status', '--porcelain', '--untracked-files=no').stdout.trim(), '');
      assert.equal(fs.existsSync(path.join(repo, '.git', 'rebase-merge')), false);
      assert.equal(fs.readFileSync(path.join(repo, 'shared.txt'), 'utf8'), 'resolved\n');
    } finally {
      if (prior === undefined) { delete process.env.TASK_2744_ENV; } else { process.env.TASK_2744_ENV = prior; }
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test('nested handoff reports genuinely missing pinned Codex and never launches (TASK-2744)', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'px-handoff-missing-'));
    const prior = process.env.TASK_2744_ENV;
    process.env.TASK_2744_ENV = 'ambient';
    try {
      const { repo, launches } = conflictRepo(root);
      // Keep the discovery shell available while excluding every Codex executable.
      fs.mkdirSync(path.join(root, 'empty'));
      fs.symlinkSync('/bin/bash', path.join(root, 'empty', 'bash'));
      const configuration = resolveConfiguration({ PATH: path.join(root, 'empty'), PARALLIX_HOME: path.join(root, 'home'), TASK_2744_ENV: 'composed' });
      let probes = 0;
      const options = {
        isForgejoReviewEnabledFn: () => true,
        worktree: repo, log: () => {}, error: () => {},
        createRebaseWorkflowPortFn: (options: Parameters<typeof createRebaseWorkflowPort>[0]) => {
          assert.strictEqual(options?.configuration, configuration);
          const port = createRebaseWorkflowPort(options);
          const status = port.workflowLauncherStatus('codex', repo);
          assert.equal(status.supported, false);
          assert.equal('health' in status ? status.health : undefined, 'missing');
          assert.equal(configuration.forwardedEnvironment.TASK_2744_ENV, 'composed');
          probes += 1;
          return port;
        },
      };
      const result = await createHandoffPorts(configuration).rebase.rebaseBeforeReviewRound('task-lcfg-iso', options);
      assert.equal(probes, 1);
      assert.equal(result.ok, false);
      assert.equal(fs.existsSync(launches), false);
      assert.equal(fs.existsSync(path.join(repo, '.git', 'rebase-merge')), true);
    } finally {
      if (prior === undefined) { delete process.env.TASK_2744_ENV; } else { process.env.TASK_2744_ENV = prior; }
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

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
        rebaseWorkflowOptions: {
          readTokenFn: () => 'fixture-token',
          resolveForgejoUserFn: () => 'fixture-user',
          createPrFn: () => ({ ok: false as const, error: 'controlled publication rejection (TASK-2717)' }),
        },
      });
      const result = await ports.preReview.rebase();

      assert.equal(fs.existsSync(launches), true, `implementer was never launched: ${logs.join(' | ')}`);
      assert.equal(git('status', '--porcelain', '--untracked-files=no').stdout.trim(), '', 'rebase must leave a clean tree');
      assert.equal(fs.existsSync(path.join(repo, '.git', 'rebase-merge')), false, 'rebase must be finished');
      assert.equal(fs.readFileSync(path.join(repo, 'shared.txt'), 'utf8'), 'resolved\n');
      assert.equal(result.ok, false, 'publication rejection must stop review');
      assert.match(result.diagnostic ?? '', /controlled publication rejection/, 'actual publication cause must survive');
      assert.equal(result.gate, undefined, 'publication is not a verification gate failure');
      // The completed rebase must not leave historical conflict diagnostics on publication failure.
      assert.equal(logs.some(line => /Shared-file rebase conflicts detected/.test(line)), false, logs.join(' | '));
    } finally {
      if (priorHome === undefined) { delete process.env.PARALLIX_HOME; } else { process.env.PARALLIX_HOME = priorHome; }
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test('resolved rebase reports missing publication credentials instead of historical conflicts (TASK-2717)', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'px-launcher-token-'));
    try {
      const { repo, binDir, git } = conflictRepo(root);
      const configuration = resolveConfiguration({ PATH: `${binDir}:${process.env.PATH}`, PARALLIX_HOME: path.join(root, 'home') });
      const logs: string[] = [];
      let publications = 0;
      const ports = createReviewLoopPorts('task-lcfg-iso', { worktree: repo }, {
        configuration, log: line => logs.push(line), error: line => logs.push(line), exit: () => {},
        rebaseWorkflowOptions: {
          readTokenFn: () => null,
          resolveForgejoUserFn: () => 'fixture-user',
          createPrFn: () => { publications += 1; throw new Error('publication without credentials'); },
        },
      });
      const result = await ports.preReview.rebase();
      assert.equal(result.ok, false);
      assert.match(result.diagnostic ?? '', /No Forgejo token found for user "fixture-user"/);
      assert.equal(result.gate, undefined);
      assert.equal(publications, 0);
      assert.equal(git('status', '--porcelain', '--untracked-files=no').stdout.trim(), '');
      assert.equal(fs.existsSync(path.join(repo, '.git', 'rebase-merge')), false);
      assert.equal(logs.some(line => /Shared-file rebase conflicts detected/.test(line)), false, logs.join(' | '));
    } finally {
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
        rebaseWorkflowOptions: { readTokenFn: () => 'fixture-token', resolveForgejoUserFn: () => 'fixture-user', createPrFn: () => ({ ok: true as const }) },
      });
      const note = (event: string) => fs.appendFileSync(order, `${event}\n`);
      const fake = fakeReviewLoopPorts({
        slug: 'task-lcfg-iso',
        worktree: repo,
        routing: { eligibleFamilies: () => ['codex', 'claude'] },
        preReview: {
          // Real composed rebase with controlled publication and real verification gate.
          rebase: async () => { assert.equal((await real.preReview.rebase()).ok, true); note(fs.existsSync(launches) ? 'rebase-with-implementer' : 'rebase-without-implementer'); return { ok: true as const }; },
          runGate: real.preReview.runGate,
        },
        agents: { launch: async launch => { note(`launch:${launch.role}`); return { agent: launch.agent, result: { status: 0 } }; } },
        artifacts: { consumeReviewer: async () => ({ consumed: true, ok: true as const, reviewState: 'APPROVED' }) },
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

  test('public rebase CLI preserves publication failure after resolved conflicts (TASK-2717)', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'px-launcher-cli-'));
    try {
      const { repo, binDir, git } = conflictRepo(root);
      const configuration = resolveConfiguration({ PATH: `${binDir}:${process.env.PATH}`, PARALLIX_HOME: path.join(root, 'home') });
      const exits: number[] = [];
      const command = createRebaseCommand((args, options) => rebase(args, {
        ...options, resolveWorktreeFn: () => repo,
        readTokenFn: () => 'fixture-token', resolveForgejoUserFn: () => 'fixture-user',
        createPrFn: () => ({ ok: false as const, error: 'controlled CLI publication rejection (TASK-2717)' }),
      }));
      const code = await command(['task-lcfg-iso', '--push'], { configuration, exitFn: (value: number) => { exits.push(value); } });
      assert.equal(code, 1, 'public CLI must not overwrite publication failure with success');
      assert.deepEqual(exits, [1]);
      assert.equal(fs.existsSync(path.join(repo, '.git', 'rebase-merge')), false);
      assert.equal(git('status', '--porcelain', '--untracked-files=no').stdout.trim(), '');
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });

  test('integration rebase port discovers the implementer through the composed configuration (TASK-2709)', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'px-launcher-cfg-int-'));
    try {
      fs.writeFileSync(path.join(root, 'codex'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
      const configuration = resolveConfiguration({ PATH: `${root}:${process.env.PATH}` });
      const port = createIntegratePorts(configuration).rebase.createRebaseWorkflowPort({ gitFn: (() => ({ status: 0, stdout: '', stderr: '' })), exitFn: () => {} });
      assert.equal(port.workflowLauncherStatus('codex').supported, true, JSON.stringify(port.workflowLauncherStatus('codex')));
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});

test('database-only replay preserves squashed work, relocation and completed tasks (TASK-2778)', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'px-replay-history-'));
  const repo = path.join(root, 'repo');
  fs.mkdirSync(repo);
  const git = (...args: string[]) => {
    const result = childProcess.spawnSync('git', ['-C', repo, ...args], {
      encoding: 'utf8', env: { ...process.env, GIT_EDITOR: 'true' },
    });
    return { status: result.status, stdout: result.stdout, stderr: result.stderr };
  };
  const ok = (...args: string[]) => { const result = git(...args); assert.equal(result.status, 0, result.stderr); return result.stdout; };
  const write = (file: string, body: string) => {
    fs.mkdirSync(path.dirname(path.join(repo, file)), { recursive: true });
    fs.writeFileSync(path.join(repo, file), body);
  };
  try {
    ok('init', '-b', 'main'); ok('config', 'user.email', 'test@example.com'); ok('config', 'user.name', 'Fixture');
    write('old.txt', 'base\n'); write('shared.txt', 'base\n'); ok('add', '.'); ok('commit', '-m', 'base');
    ok('checkout', '-b', 'mission/task-replay');
    write('shared.txt', 'squashed\n'); write('backlog/tasks/completed.md', 'old creation\n');
    ok('add', '.'); ok('commit', '-m', 'already landed work');
    ok('checkout', 'main'); ok('merge', '--squash', 'mission/task-replay'); ok('commit', '-m', 'landed squash');
    ok('mv', 'old.txt', 'new.txt'); write('new.txt', 'new main behavior\n');
    ok('mv', 'backlog/tasks/completed.md', 'backlog/completed.md');
    write('backlog/completed.md', 'completed on main\n'); write('shared.txt', 'newer main\n');
    ok('add', '.'); ok('commit', '-m', 'main relocation and completion');
    const baseHead = ok('rev-parse', 'main').trim();
    ok('checkout', 'mission/task-replay');
    write('old.txt', 'unique mission intent\n'); write('shared.txt', 'mission intent\n');
    write('backlog/tasks/completed.md', 'stale duplicate\n'); write('unique.txt', 'unique change\n');
    ok('add', '.'); ok('commit', '-m', 'unique work plus stale paths');
    const store = inMemoryTransitionStore(fixtureMission('task-replay', { assignee: agentFamily('codex'), review: null }));
    let launches = 0;
    const exits: number[] = [];
    await rebase(['task-replay'], {
      resolveWorktreeFn: () => repo, gitFn: args => {
        assert.equal(args.includes('merge-tree'), false, 'paused path never predicts a merge');
        return git(...args.slice(args[0] === '-C' ? 2 : 0));
      }, missionServicesFn: async () => ({ store }), exitFn: code => { exits.push(code); },
      startAgentFn: async (_step, options) => {
        launches++;
        assert.equal(options.agent, 'codex');
        assert.match(String(options.prompt), /Review shared conflicts semantically/);
        // Explicit semantic review: carry unique intent to the relocated file;
        // keep newer main state and completed work, removing only stale paths.
        for (let pauses = 0; pauses < 5; pauses++) {
          const files = ok('diff', '--name-only', '--diff-filter=U').trim().split('\n').filter(Boolean);
          for (const file of files) {
            if (file === 'old.txt' || file === 'backlog/tasks/completed.md') { ok('rm', '-f', '--', file); }
            else if (file === 'shared.txt') { write(file, 'newer main\nmission intent\n'); ok('add', '--', file); }
            else { assert.fail(`unexpected conflict ${file}`); }
          }
          write('new.txt', 'new main behavior\nunique mission intent\n'); ok('add', 'new.txt');
          const continued = git('rebase', '--continue');
          if (continued.status === 0) { break; }
          assert.match(continued.stdout + continued.stderr, /CONFLICT/);
        }
        return { agent: 'codex', result: { status: 0 } };
      },
    });
    assert.deepEqual(exits, [0]); assert.equal(launches, 1);
    assert.equal(ok('rev-parse', 'main').trim(), baseHead);
    assert.equal(ok('status', '--porcelain').trim(), '');
    assert.equal(fs.existsSync(path.join(repo, '.git/rebase-merge')), false);
    assert.equal(fs.existsSync(path.join(repo, 'old.txt')), false);
    assert.equal(fs.existsSync(path.join(repo, 'backlog/tasks/completed.md')), false);
    assert.equal(fs.readFileSync(path.join(repo, 'backlog/completed.md'), 'utf8'), 'completed on main\n');
    assert.equal(fs.readFileSync(path.join(repo, 'unique.txt'), 'utf8'), 'unique change\n');
    assert.equal(fs.readFileSync(path.join(repo, 'new.txt'), 'utf8'), 'new main behavior\nunique mission intent\n');
    assert.equal(fs.readFileSync(path.join(repo, 'shared.txt'), 'utf8'), 'newer main\nmission intent\n');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
