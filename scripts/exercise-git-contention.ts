import { commitWorkflowBaseline } from '../src/adapters/config/product-config.js';
import { bindGitAdmission, admittedBootstrapGitSpawn } from '../src/composition/git-admission.js';
import { resolveProcessConfiguration } from '../src/composition/config.js';
/** Manual disposable public-workflow workload. Run: npx tsx scripts/exercise-git-contention.ts */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { setTimeout as pause } from 'node:timers/promises';
import { git, runToExit, detectRebaseState } from '../src/adapters/git/git.js';
import { RebaseCommandUseCase } from '../src/application/rebase-command-use-case.js';
import { createRebaseWorkflowPort } from '../src/adapters/rebase/rebase-workflow-adapter.js';
import { commitDirtyFiles } from '../src/adapters/git/commit-dirty-files.js';
import { ensureReviewRemote } from '../src/adapters/review/setup-review-repository.js';
import { GitRepositoryPort } from '../src/adapters/git/github-publish-git.js';
import { fetchReviewBranch } from '../src/adapters/forgejo/forgejo-git.js';

const script = import.meta.filename;
const environment = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1', GIT_OPTIONAL_LOCKS: '0', PARALLIX_GIT_ADMISSION: undefined };
function raw(root: string, args: string[]): string {
  const result = spawnSync('git', ['-C', root, ...args], { encoding: 'utf8', env: environment, timeout: 2000 });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

async function worker(operation: string, root: string, argument: string) {
  bindGitAdmission(resolveProcessConfiguration());
  const runner: typeof git = (args, options) => git(args, { ...options, gitWaitLimitMs: 1800 });
  if (operation === 'rebase' || operation === 'partial') {
    let starts = 0; let continues = 0; let repairs = 0;
    if (operation === 'partial') {
      // Real rebase todo: execute controlled index contention after pick 22.
      const editor = path.join(root, '.git', 'editor.mjs');
      const lock = path.join(root, '.git', 'index.lock');
      const command = `node --input-type=module -e 'import fs from "node:fs"; fs.writeFileSync(${JSON.stringify(lock)}, "external");'`;
      fs.writeFileSync(editor, `import fs from 'node:fs'; const f=process.argv[2];const a=fs.readFileSync(f,'utf8').split('\\n'); a.splice(22,0,${JSON.stringify('exec ' + command)});fs.writeFileSync(f,a.join('\\n'));`);
    }
    const port = createRebaseWorkflowPort({
      cwd: root,
      executionContext: {
        missionId: 'exercise', missionWorktree: root, missionBranch: 'mission/exercise',
        baseWorktree: root, baseBranch: 'main',
      },
      inferSlugFn: () => 'exercise',
      findMissionDirFn: () => null,
      getTaskImplementerFn: () => 'codex',
      gitFn: (args, options) => {
        if (args.includes('rebase')) { args.includes('--continue') ? continues++ : starts++; }
        if (operation === 'partial' && args.includes('rebase') && args.at(-1) === 'main') {
          const editor = path.join(root, '.git', 'editor.mjs');
          const result = runner(['-C', root, '-c', `sequence.editor=node ${editor}`, 'rebase', '-i', 'main'], options);
          assert.notEqual(result.status, 0); assert.equal(detectRebaseState(root).inProgress, true);
          assert.equal(raw(root, ['diff', '--name-only', '--diff-filter=U']), '');
          process.stdout.write('PARTIAL_READY\n');
          return result;
        }
        return runner(args, options);
      },
      exitFn: code => { assert.equal(code, 0); },
    });
    // Mission persistence and external agents are boundary doubles. All Git
    // execution, state inspection and workflow continuation are production.
    port.readReviewState = async () => ({ implementer: 'codex' });
    port.startAgent = async () => { repairs++; throw new Error('Unexpected agent repair'); };
    port.transitionTask = async () => { repairs++; };
    await new RebaseCommandUseCase(port).execute(['exercise']);
    assert.equal(repairs, 0); assert.equal(starts, 1);
    assert.equal(raw(root, ['branch', '--show-current']), 'mission/exercise');
    assert.equal(detectRebaseState(root).inProgress, false);
    assert.equal(raw(root, ['rev-list', '--count', 'main..HEAD']), '26');
    assert.equal(raw(root, ['status', '--porcelain']), '');
    process.stdout.write(JSON.stringify({ starts, continues, repairs, branch: 'mission/exercise', picks: 26 }) + '\n');
  } else if (operation === 'commit' || operation === 'head') {
    fs.writeFileSync(path.join(root, 'mission.txt'), argument);
    const before = raw(root, ['rev-list', '--count', 'HEAD']);
    const result = commitDirtyFiles(root, 'exercise', runner, () => {}, () => {});
    assert.equal(result.repaired, true, result.blocker ?? '');
    assert.equal(Number(raw(root, ['rev-list', '--count', 'HEAD'])), Number(before) + 1);
    assert.equal(raw(root, ['status', '--porcelain']), '');
    assert.equal(fs.readFileSync(path.join(root, '.git', 'hook-count'), 'utf8'), 'pre\npost\n');
  } else if (operation === 'config-cancel') {
    process.on('SIGINT', () => {});
    ensureReviewRemote(root, 'local', argument);
    assert.fail('held config cannot complete');
  } else if (operation === 'config') {
    assert.equal(ensureReviewRemote(root, 'local', argument).ok, true);
    assert.equal(raw(root, ['remote', 'get-url', 'local']), argument);
  } else if (operation === 'fetch') {
    assert.equal(fetchReviewBranch('main', root).status, 0);
    assert.equal(raw(root, ['rev-parse', 'refs/remotes/review/main']), raw(argument, ['rev-parse', 'main']));
  } else if (operation === 'publish') {
    const sha = raw(root, ['rev-parse', 'HEAD']);
    assert.equal(new GitRepositoryPort(root, runner).push(argument, sha, 'refs/heads/exercise').ok, true);
    assert.equal(raw(argument, ['rev-parse', 'refs/heads/exercise']), sha);
  } else if (operation === 'bootstrap') {
    fs.writeFileSync(path.join(root, 'workflow'), 'fixture');
    assert.equal(commitWorkflowBaseline(root, { spawnSyncFn: admittedBootstrapGitSpawn }).committed, true);
  } else if (operation === 'holder') {
    assert.equal(runner(['-C', root, 'commit', '--allow-empty', '-m', 'owned-holder']).status, 0);
  } else if (operation === 'nested') {
    assert.equal(runner(['-C', root, 'add', '.']).status, 0);
  } else if (operation === 'async') {
    const result = await runToExit('git', ['-C', root, 'config', 'exercise.value', argument], { gitWaitLimitMs: 1800 });
    assert.equal(result.status, 0, result.stderr);
  } else { throw new Error(`Unknown operation ${operation}`); }
  process.stdout.write('WORKFLOW_OK\n');
}

interface Run { child: ChildProcess; done: Promise<number | null>; output: () => string }
const live = new Set<ChildProcess>();
function launch(operation: string, root: string, argument = ''): Run {
  let output = '';
  const child = spawn(process.execPath, [...process.execArgv, script, '--worker', operation, root, argument], {
    env: environment, stdio: ['ignore', 'pipe', 'pipe'], detached: true,
  });
  live.add(child);
  child.stdout!.on('data', data => { output += String(data); });
  child.stderr!.on('data', data => { output += String(data); });
  const timer = setTimeout(() => { try { process.kill(-child.pid!, 'SIGKILL'); } catch {} }, 3500);
  const done = new Promise<number | null>((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', code => { clearTimeout(timer); live.delete(child); resolve(code); });
  });
  return { child, done, output: () => output };
}
async function until(check: () => boolean, description: string, ms = 3000) {
  const deadline = Date.now() + ms;
  while (!check()) { assert.ok(Date.now() < deadline, `deadline: ${description}`); await pause(5); }
}

async function exercise() {
  const started = Date.now();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'px-git-exercise-'));
  const fixture = path.join(root, 'fixture'); fs.mkdirSync(fixture);
  const remote = path.join(root, 'remote.git'); fs.mkdirSync(remote);
  const counts: Record<string, number> = {};
  try {
    raw(fixture, ['init', '-qb', 'main']); raw(fixture, ['config', 'user.email', 'fixture@example.invalid']); raw(fixture, ['config', 'user.name', 'fixture']);
    fs.writeFileSync(path.join(fixture, 'base.txt'), 'base'); raw(fixture, ['add', '.']); raw(fixture, ['commit', '-qm', 'base']);
    raw(fixture, ['checkout', '-qb', 'mission/exercise']);
    for (let pick = 1; pick <= 26; pick++) {
      fs.writeFileSync(path.join(fixture, 'mission.txt'), String(pick)); raw(fixture, ['add', '.']); raw(fixture, ['commit', '-qm', `pick-${pick}`]);
    }
    raw(fixture, ['checkout', 'main']); fs.writeFileSync(path.join(fixture, 'base.txt'), 'advanced'); raw(fixture, ['commit', '-qam', 'advance']);
    raw(remote, ['init', '--bare', '-q']); raw(fixture, ['push', remote, 'main']); raw(fixture, ['remote', 'add', 'review', remote]);
    raw(fixture, ['checkout', 'mission/exercise']);
    const copy = (name: string) => {
      const target = path.join(root, name); fs.cpSync(fixture, target, { recursive: true });
      for (const [hook, label] of [['pre-commit', 'pre'], ['post-commit', 'post']]) {
        fs.writeFileSync(path.join(target, '.git', 'hooks', hook), `#!/bin/sh\nprintf '${label}\\n' >> "$(git rev-parse --git-dir)/hook-count"\n`, { mode: 0o700 });
      }
      return target;
    };
    const scenarios = [
      ['bootstrap', 'index.lock', ''], ['rebase', 'index.lock', remote], ['commit', 'index.lock', 'changed'], ['head', 'HEAD.lock', 'changed'],
      ['config', 'config.lock', remote], ['fetch', 'packed-refs.lock', remote], ['async', 'config.lock', 'async-value'],
    ];
    const elapsed: number[] = [];
    const trial = async (index: number) => {
      const trialStarted = Date.now();
      const [operation, family, argument] = scenarios[index % scenarios.length];
      const repo = copy(`trial-${index}`); const lock = path.join(repo, '.git', family);
      fs.writeFileSync(lock, 'protected-external');
      const run = launch(operation, repo, argument);
      await until(() => { if (run.child.exitCode !== null) { assert.fail(run.output()); } return /Waiting for Git/.test(run.output()); }, `${operation} visible waiting`);
      // Release after multiple 25/50/100ms polls; startup is included in deadline.
      await pause(index % 2 ? 180 : 100); assert.equal(fs.readFileSync(lock, 'utf8'), 'protected-external'); fs.unlinkSync(lock);
      assert.equal(await run.done, 0, run.output()); assert.match(run.output(), /WORKFLOW_OK/);
      elapsed.push(Date.now() - trialStarted);
      assert.ok(elapsed.at(-1)! <= 3500, 'trial includes clone, startup, hooks and requests');
      counts[operation] = (counts[operation] ?? 0) + 1;
    };
    const population = process.argv.includes('--extras') ? 0 : 126;
    for (let index = 0; index < population; index++) { await trial(index); if ((index + 1) % 18 === 0) { console.log(`Transient completed: ${index + 1}/${population}`); } }
    // Real partial rebase, clean detached state, public re-entry, no resolver.
    const partialRoot = copy('partial');
    const partial = launch('partial', partialRoot);
    await until(() => /PARTIAL_READY/.test(partial.output()), 'real paused rebase');
    await until(() => /Waiting for Git/.test(partial.output()), 'partial continuation waits');
    await pause(180); fs.unlinkSync(path.join(partialRoot, '.git', 'index.lock'));
    assert.equal(await partial.done, 0, partial.output()); assert.match(partial.output(), /"continues":1/);
    // Held unknown owner: explicit deadline and cancellation preserve bytes.
    for (const cancel of [false, true]) {
      const repo = copy(`held-${cancel}`); const lock = path.join(repo, '.git', 'config.lock'); fs.writeFileSync(lock, 'live-or-unknown');
      const run = launch(cancel ? 'config-cancel' : 'async', repo, 'held');
      await until(() => /Waiting for Git/.test(run.output()), 'held lock waiting');
      if (cancel) { process.kill(-run.child.pid!, 'SIGINT'); }
      const code = await run.done;
      assert.notEqual(code, 0); assert.equal(fs.readFileSync(lock, 'utf8'), 'live-or-unknown');
      if (cancel) { assert.equal(code, 1, 'cancellation must finish before the SIGKILL deadline'); assert.match(run.output(), /interrupted by SIGINT/); }
      if (!cancel) { assert.match(run.output(), /explicit wait limit reached/); }
    }
    // Exact-SHA local publication once; no real network/service.
    const published = copy('publish'); const push = launch('publish', published, remote);
    assert.equal(await push.done, 0, push.output());
    assert.equal(raw(remote, ['for-each-ref', '--format=%(refname)', 'refs/heads/exercise']), 'refs/heads/exercise');
    const hookRoot = copy('nested-hook');
    const quote = (value: string) => "'" + value.replaceAll("'", "'\\''") + "'";
    fs.appendFileSync(path.join(hookRoot, '.git', 'hooks', 'post-commit'),
      [process.execPath, ...process.execArgv, script, '--worker', 'nested', hookRoot, ''].map(quote).join(' ') + '\n');
    const hookRun = launch('commit', hookRoot, 'nested-hook');
    assert.equal(await hookRun.done, 0, hookRun.output());
    // Independent linked worktree remains usable while one checkout is held.
    const linkedBase = copy('linked-base'); const linked = path.join(root, 'linked'); raw(linkedBase, ['worktree', 'add', '-qb', 'independent', linked, 'main']);
    fs.writeFileSync(path.join(linkedBase, '.git', 'index.lock'), 'external');
    fs.writeFileSync(path.join(linked, 'independent.txt'), 'independent');
    assert.equal(git(['-C', linked, 'add', '.'], { gitWaitLimitMs: 250 }).status, 0);
    assert.equal(fs.readFileSync(path.join(linkedBase, '.git', 'index.lock'), 'utf8'), 'external');
    // Competing production mutations in one checkout wait for the full Git/hook lifetime.
    const owned = copy('owned-holder');
    const independent = path.join(root, 'owned-independent');
    raw(owned, ['worktree', 'add', '-qb', 'owned-independent', independent, 'main']);
    fs.appendFileSync(path.join(owned, '.git', 'hooks', 'pre-commit'),
      'touch "$(git rev-parse --git-dir)/holder-ready"\nfor i in $(seq 1 200); do test -e "$(git rev-parse --git-dir)/holder-release" && break; sleep 0.01; done\n');
    const holder = launch('holder', owned);
    await until(() => fs.existsSync(path.join(owned, '.git', 'holder-ready')), 'owned holder enters hook');
    fs.writeFileSync(path.join(independent, 'independent.txt'), 'parallel');
    assert.equal(git(['-C', independent, 'add', '.'], { gitWaitLimitMs: 250 }).status, 0);
    const competing = launch('nested', owned);
    await until(() => /Waiting for Git/.test(competing.output()), 'competing owned mutation waits');
    fs.writeFileSync(path.join(owned, '.git', 'holder-release'), 'release');
    assert.equal(await holder.done, 0, holder.output()); assert.equal(await competing.done, 0, competing.output());
    assert.equal(fs.readFileSync(path.join(owned, '.git', 'hook-count'), 'utf8'), 'pre\npost\n');
    assert.equal(raw(owned, ['rev-list', '--count', 'HEAD']), '28');
    console.log(JSON.stringify({ trials: population, completed: Object.values(counts).reduce((a, b) => a + b, 0), failures: 0, automaticRate: population ? Object.values(counts).reduce((a, b) => a + b, 0) / population : null, counts, releaseAfterWaitingMs: [100, 180],
      trialDeadlineMs: 3500, setupAndWorkloadDeadlineMs: 180000, elapsedMs: Date.now() - started, maxTrialMs: elapsed.length ? Math.max(...elapsed) : null,
      separate: { partial: 1, heldLimit: 1, cancelled: 1, independentWorktree: 1, reentrantHook: 1, competingOwnedMutations: 1, concurrentLinkedWorktree: 1, localPublicationRefs: 1, commitHookEffectsPerTrial: 2 } }, null, 2));
  } finally {
    await Promise.all([...live].map(child => new Promise<void>(resolve => { child.once('exit', () => resolve()); try { process.kill(-child.pid!, 'SIGKILL'); } catch { resolve(); } })));
    fs.rmSync(root, { recursive: true, force: true });
  }
}
if (process.argv[2] === '--worker') { await worker(process.argv[3], process.argv[4], process.argv[5]); }
else {
  const deadline = setTimeout(() => { for (const child of live) { try { process.kill(-child.pid!, 'SIGKILL'); } catch {} } process.exitCode = 1; }, 180000);
  try { await exercise(); } finally { clearTimeout(deadline); }
}
