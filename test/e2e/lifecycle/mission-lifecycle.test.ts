

// This source-level lifecycle suite invokes the canonical CLI composition
// directly, so every case retains real workflow transitions without repeatedly
// starting a TypeScript CLI process.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import childProcess from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { run } from '../../../src/composition/create-cli.js';
import { configureMissionWriteAuthorization } from '../../../src/application/ports/mission-write-authorization.js';
import '../../fixtures/e2e-lifecycle-fake-agent-preload.js';

function runCommand(command: string, args: readonly string[], options: Omit<childProcess.SpawnSyncOptionsWithStringEncoding, 'encoding'> = {}) {
  assert.notEqual(command, 'codex', 'lifecycle test must not launch an agent executable');
  assert.notEqual(command, 'opencode', 'lifecycle test must not launch an agent executable');
  const result = childProcess.spawnSync(command, args, {
    encoding: 'utf8',
    ...options
  });
  if (result.error && result.status === null) {
    throw result.error;
  }
  return result;
}

function runGit(cwd: string, args: readonly string[], options: Omit<childProcess.SpawnSyncOptionsWithStringEncoding, 'encoding'> = {}) {
  const result = runCommand('git', args, { cwd, ...options });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
  }
  return (result.stdout || '').trim();
}

function commandDir(command: string) {
  const resolved = maybeCommandPath(command);
  if (!resolved) {
    throw new Error(`Could not resolve command on PATH: ${command}`);
  }
  return resolved;
}

function maybeCommandPath(command: string) {
  for (const directory of (process.env.PATH || '').split(path.delimiter)) {
    if (!directory) {continue;}
    const candidate = path.join(directory, command);
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      return candidate;
    } catch {
      // Keep searching PATH.
    }
  }
  return null;
}

function writeExecutable(filePath: string, content: string) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, 'utf8');
  fs.chmodSync(filePath, 0o755);
}

function postIntegrateHookMarkerPath(repoRoot: string) {
  return path.join(path.dirname(repoRoot), 'post-integrate-hook.log');
}

function createTask(repoRoot: string, slug: string, title: string) {
  const taskPath = path.join(repoRoot, 'backlog', 'tasks', `${slug} - ${title.replace(/\s+/g, '-').toLowerCase()}.md`);
  const taskId = slug.toUpperCase();
  const body = [
    '---',
    `id: ${taskId}`,
    `title: ${title}`,
    'status: backlog',
    'assignee: []',
    "created_date: '2026-07-01 00:00'",
    'labels: [ai_sdlc]',
    'dependencies: []',
    '---',
    '',
    '## Description',
    '',
    'End-to-end lifecycle probe.',
    ''
  ].join('\n');
  fs.writeFileSync(taskPath, body, 'utf8');
  return taskPath;
}

function setupRepository({ slug, title }: { slug: string; title: string }) {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'parallix-e2e-'));
  const repoRoot = path.join(tmpRoot, 'repo');
  const binDir = path.join(repoRoot, 'bin');
  const stateHome = path.join(tmpRoot, 'parallix-home');
  const reviewTmpDir = path.join(tmpRoot, 'review-artifacts');

  fs.mkdirSync(path.join(repoRoot, 'backlog', 'tasks'), { recursive: true });
  fs.mkdirSync(path.join(repoRoot, 'backlog', 'completed'), { recursive: true });
  fs.mkdirSync(path.join(repoRoot, 'backlog', 'archive'), { recursive: true });
  fs.mkdirSync(path.join(repoRoot, 'config'), { recursive: true });
  fs.mkdirSync(binDir, { recursive: true });
  fs.mkdirSync(reviewTmpDir, { recursive: true });

  fs.symlinkSync('/usr/bin/node', path.join(binDir, 'node'));
  fs.symlinkSync(commandDir('git'), path.join(binDir, 'git'));
  fs.symlinkSync(commandDir('bash'), path.join(binDir, 'bash'));
  fs.symlinkSync(commandDir('id'), path.join(binDir, 'id'));
  // Git mutation admission uses the real kernel lease and its execution shell.
  fs.symlinkSync(commandDir('flock'), path.join(binDir, 'flock'));
  fs.symlinkSync(commandDir('sh'), path.join(binDir, 'sh'));
  const postIntegrateScript = path.join(repoRoot, 'scripts', 'e2e-post-integrate-hook.sh');
  writeExecutable(postIntegrateScript, [
    '#!/usr/bin/env bash',
    'set -euo pipefail',
    `printf 'slug=%s base_worktree=%s base_branch=%s variant=%s\\n' "$INTEGRATE_HOOK_SLUG" "$INTEGRATE_HOOK_BASE_WORKTREE" "$INTEGRATE_HOOK_BASE_BRANCH" "$INTEGRATE_HOOK_VARIANT" >> ${JSON.stringify(postIntegrateHookMarkerPath(repoRoot))}`,
    ''
  ].join('\n'));
  const preCommitScript = path.join(repoRoot, 'scripts', 'e2e-pre-commit-hook.sh');
  // The hook change has to stay verification-neutral: integrate admits the tests run recorded by the
  // review step, and the gate adapter only carries a run across a tagged patch-version bump of a
  // release manifest (TASK-2872.02). A bump of an arbitrary file would strand the mission.
  fs.writeFileSync(path.join(repoRoot, 'package.json'), `${JSON.stringify({ name: 'e2e-probe', version: '1.0.0' }, null, 2)}\n`, 'utf8');
  const bumpedManifest = JSON.stringify({ name: 'e2e-probe', version: '1.0.1' }, null, 2);
  writeExecutable(preCommitScript, ['#!/usr/bin/env bash', 'set -euo pipefail', `printf '%s\\n' '${bumpedManifest}' > package.json`, ''].join('\n'));

  const adapters = {
    tasks: { provider: 'backlog-md', storage: 'backlog', stateMap: 'config/state-map.json' },
    agents: { models: { custom: 'stub/custom' } },
    missions: { baseDir: 'missions', branchPrefix: 'mission/', worktreePattern: '../<repo>-<slug>' },
    verification: { command: ':', defaultArea: 'all', integrationCoverage: {
      command: ':', checks: { lifecycle: ['lifecycle-gate'] },
    } },
    gates: { preIntegration: [{ key: 'lifecycle-gate', command: ':', order: 1 }] },
    review: { provider: 'none', tmpDir: reviewTmpDir },
    integrate: {
      postIntegrateCommand: `./${path.relative(repoRoot, postIntegrateScript)}`,
      preCommitCommand: `./${path.relative(repoRoot, preCommitScript)}`,
    },
  };

  fs.writeFileSync(path.join(repoRoot, 'workflow.config.json'), JSON.stringify({
    product: {
      name: 'e2e-probe',
      targetUser: 'tests'
    },
    adapters
  }, null, 2));

  fs.writeFileSync(path.join(repoRoot, 'config', 'state-map.json'), JSON.stringify({
    ready: 'refined',
    approved: 'ready-for-integration'
  }, null, 2));

  fs.writeFileSync(path.join(repoRoot, 'README.md'), '# E2E Probe\n', 'utf8');
  createTask(repoRoot, slug, title);

  // `git init -b` was added in Git 2.28. Keep this real-Git E2E compatible
  // with older installations by creating the initial branch separately.
  runGit(repoRoot, ['init']);
  runGit(repoRoot, ['checkout', '-b', 'main']);
  runGit(repoRoot, ['config', 'user.email', 'test@example.com']);
  runGit(repoRoot, ['config', 'user.name', 'Parallix E2E']);
  runGit(repoRoot, ['add', '.']);
  runGit(repoRoot, ['commit', '-m', 'initial test repo']);

  return {
    tmpRoot,
    repoRoot,
    binDir,
    stateHome,
    reviewTmpDir
  };
}

function workflowEnv(binDir: string, stateHome: string, repoRoot: string) {
  return {
    ...process.env,
    FORCE_COLOR: '0',
    FORGEJO_USER: 'custom',
    PRIMARY_WORKTREE: repoRoot,
    PARALLIX_HOME: stateHome,
    PARALLIX_NO_BUBBLEWRAP: '1',
    PATH: binDir
  };
}

async function runWorkflow(repoRoot: string, env: NodeJS.ProcessEnv, args: string[], _timeout = 60000, { allowFailure = false, invokeFromTarget = false } = {}) {
  const previousCwd = process.cwd();
  const previous = new Map(Object.entries(process.env));
  const previousStdoutWrite = process.stdout.write;
  const previousStderrWrite = process.stderr.write;
  let stdout = '';
  let stderr = '';
  // This fixture executes the worker body with an in-process fake agent.
  // Keep writes scoped to its explicit mission, without spawning an owner
  // process that cannot inherit the fake launcher port.
  // Free-text drafts allocate their px identity during intake. Bind that
  // identity on the first write, then keep the same single-mission fence.
  let authorizedSlug = args[0] === 'draft' && !/^(?:task-[a-z0-9-]+|px-\d+)$/.test(args[1]) ? null : args[1];
  configureMissionWriteAuthorization({ operationId: `lifecycle-fixture:${args[1]}`, async assert(id) {
    if (authorizedSlug === null) {
      assert.match(id, /^px-\d+$/, 'free-text intake must allocate a DB-owned mission identity');
      authorizedSlug = id;
    }
    assert.equal(id, authorizedSlug, 'the fixture worker may write only its invoked mission');
  } });
  try {
    if (invokeFromTarget) { process.chdir(repoRoot); }
    for (const key of Object.keys(process.env)) {
      if (!(key in env)) { delete process.env[key]; }
    }
    Object.assign(process.env, env);
    process.stdout.write = ((chunk, ...args) => {
      // node --test serializes its worker events as binary writes. Preserve
      // those events while capturing the CLI's text output.
      if (typeof chunk !== 'string') { return Reflect.apply(previousStdoutWrite, process.stdout, [chunk, ...args]) as boolean; }
      stdout += chunk; return true;
    }) as typeof process.stdout.write;
    process.stderr.write = ((chunk, ...args) => {
      if (typeof chunk !== 'string') { return Reflect.apply(previousStderrWrite, process.stderr, [chunk, ...args]) as boolean; }
      stderr += chunk; return true;
    }) as typeof process.stderr.write;
    const status = await run(args, {
      baseCwd: repoRoot,
      log: line => { stdout += `${line}\n`; return ''; },
      error: line => { stderr += `${line}\n`; return ''; },
    });
    if (!allowFailure && status !== 0) {
      throw new Error(`px ${args.join(' ')} failed (status=${status})\nstdout:\n${stdout}\nstderr:\n${stderr}`);
    }
    return { status, stdout, stderr };
  } finally {
    configureMissionWriteAuthorization(null);
    if (invokeFromTarget) { process.chdir(previousCwd); }
    process.stdout.write = previousStdoutWrite;
    process.stderr.write = previousStderrWrite;
    for (const key of Object.keys(process.env)) {
      if (!previous.has(key)) { delete process.env[key]; }
    }
    Object.assign(process.env, Object.fromEntries(previous));
  }
}

/**
 * The tests-action turn under the recorded-facts contract (TASK-2872.02 SC2): `px review` on the
 * approved candidate runs the configured integration gates and records the run; `px integrate`
 * admits that record and starts no gate.
 */
async function runIntegrationTestsTurn(rootDir: string, env: NodeJS.ProcessEnv, slug: string,
  options: { allowFailure?: boolean } = {}) {
  return runWorkflow(rootDir, env, ['review', slug], 60000, options);
}

/**
 * px-0050.01: two independent failures, one passing gate and one dependent of a failed prerequisite,
 * committed in the mission worktree so the tests action reads them from the reviewed head.
 */
function installFailingIntegrationGates(worktree: string, slug: string, markers: string) {
  const worktreeConfigPath = path.join(worktree, 'workflow.config.json');
  const worktreeConfig = JSON.parse(fs.readFileSync(worktreeConfigPath, 'utf8'));
  fs.mkdirSync(markers, { recursive: true });
  worktreeConfig.adapters.gates = { preIntegration: [
    { key: 'failing-gate', command: `: > ${markers}/failing; printf first-defect >&2; exit 7`, order: 1 },
    { key: 'second-failing-gate', command: `: > ${markers}/second; printf second-defect >&2; exit 3`, order: 2 },
    { key: 'passing-gate', command: `: > ${markers}/passing`, order: 3 },
    { key: 'dependent-gate', command: `: > ${markers}/dependent`, order: 4, after: ['failing-gate'] },
  ] };
  fs.writeFileSync(worktreeConfigPath, JSON.stringify(worktreeConfig, null, 2));
  runGit(worktree, ['add', '--', 'workflow.config.json']);
  runGit(worktree, ['commit', '-m', `test(${slug}): install failing integration gate`]);
}

function worktreePathFor(repoRoot: string, slug: string) {
  return path.resolve(repoRoot, '..', `${path.basename(repoRoot)}-${slug}`);
}

function shouldKeepTmp() {
  return process.env.PARALLIX_E2E_KEEP_TMP === '1';
}

function pauseAfterWorktreeFixture(repo: ReturnType<typeof setupRepository>, worktree: string) {
  const readyMarker = process.env.PARALLIX_E2E_WORKTREE_READY_MARKER || '';
  if (!readyMarker) { return; }
  fs.writeFileSync(readyMarker, JSON.stringify({
    tmpRoot: repo.tmpRoot,
    repoRoot: repo.repoRoot,
    worktree,
    pid: process.pid,
  }), 'utf8');
  // TASK-2212 kills the fixture process group after observing the marker.
  // SIGSTOP gives the parent a deterministic interruption point without a
  // timed sleep or polling delay in the lifecycle suite.
  if (process.platform !== 'win32') {
    process.kill(process.pid, 'SIGSTOP');
  }
}

// The watcher body runs in a separate `node -e` process, so it is written as
// source text rather than as a function serialized with `toString()`: this file
// is transpiled before it runs, and the transpiler rewrites function bodies
// (name-preserving `__name(...)` wrappers) into a form that no longer evaluates
// standalone. It is plain CommonJS with no closure over this module.
function cleanInterruptedFixtureSource(parentPid: number, root: string, repoRoot: string, worktree: string, cleanupMarker: string) {
  return `
    const fs = require('node:fs');
    const childProcess = require('node:child_process');
    const parentPid = ${JSON.stringify(parentPid)};
    const root = ${JSON.stringify(root)};
    const repoRoot = ${JSON.stringify(repoRoot)};
    const worktree = ${JSON.stringify(worktree)};
    const cleanupMarker = ${JSON.stringify(cleanupMarker)};
    const isAlive = () => {
      try {
        process.kill(parentPid, 0);
        return true;
      } catch (_) {
        return false;
      }
    };
    while (isAlive()) {
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25);
    }
    childProcess.spawnSync('git', ['-C', repoRoot, 'worktree', 'remove', '--force', worktree], { stdio: 'ignore' });
    fs.rmSync(root, { recursive: true, force: true });
    if (cleanupMarker) {
      fs.writeFileSync(cleanupMarker, 'cleaned\\n', 'utf8');
    }
  `;
}

function watchInterruptedFixture(root: string, repoRoot: string, worktree: string) {
  const cleanupMarker = process.env.PARALLIX_E2E_CLEANUP_MARKER || '';
  // The watcher outlives the test process and exits after the enclosing run may
  // already be reading raw V8 coverage; an inherited coverage directory leaves a
  // half-written file that fails the whole run ("coverage file is empty").
  const watcherEnv = { ...process.env };
  delete watcherEnv.NODE_V8_COVERAGE;
  const watcher = childProcess.spawn(process.execPath, [
    '-e', cleanInterruptedFixtureSource(process.pid, root, repoRoot, worktree, cleanupMarker)
  ], { detached: true, stdio: 'ignore', env: watcherEnv });
  watcher.unref();
}

function taskFileIn(rootDir: string, slug: string) {
  const candidateDirs = [
    path.join(rootDir, 'backlog', 'tasks'),
    path.join(rootDir, 'backlog', 'completed'),
    path.join(rootDir, 'backlog', 'archive')
  ];
  for (const dir of candidateDirs) {
    if (!fs.existsSync(dir)) {
      continue;
    }
    const match = fs.readdirSync(dir)
      .map(name => path.join(dir, name))
      .find(filePath => path.basename(filePath).startsWith(slug));
    if (match) {
      return match;
    }
  }
  return null;
}

function taskStatus(taskPath: fs.PathOrFileDescriptor) {
  const content = fs.readFileSync(taskPath, 'utf8');
  const match = content.match(/^status:\s*([^\r\n]+)/m);
  return match ? match[1].trim().toLowerCase() : null;
}

function missionPath(rootDir: string, slug: string) {
  return path.join(rootDir, 'missions', slug, 'MISSION.md');
}

function missionDir(rootDir: string, slug: string) {
  return path.join(rootDir, 'missions', slug);
}

// After the TASK-2322.12 cutover the review loop's state lives on the Review
// aggregate in the operator database, not in missions/<slug>/review-state.json.
// This suite stays black-box about that: it asks the CLI for the state through
// `px review <slug> --status`, which reads the same authority the loop writes.
// A mission whose loop never persisted its state therefore still fails here,
// exactly as the missing-file read used to.
async function reviewState(rootDir: string, slug: string, env: { FORCE_COLOR: string; FORGEJO_USER: string; PRIMARY_WORKTREE: string; PARALLIX_HOME: string; PARALLIX_NO_BUBBLEWRAP: string; PATH: string; }) {
  const result = await runWorkflow(rootDir, env, ['review', slug, '--status']);
  const output = `${result.stdout}${result.stderr}`.replace(/\x1B\[[0-9;]*m/g, '');
  if (/No persisted review state found/.test(output)) {
    throw new Error(`px review ${slug} --status found no persisted review state\n${output}`);
  }
  const field = (label: string) => {
    const match = output.match(new RegExp(`^\\s*${label}:\\s*(.+)$`, 'm'));
    return match ? match[1].trim() : null;
  };
  const round = field('Round');
  const phase = field('Phase');
  if (phase === null) {
    throw new Error(`px review ${slug} --status did not report a review phase\n${output}`);
  }
  return {
    round: round === null ? null : Number(round),
    phase,
    reviewer: field('Reviewer'),
    implementer: field('Implementer'),
    startedAt: field('Started at'),
    disposition: field('Disposition')
  };
}

function checkpointFiles(rootDir: string, slug: string) {
  return fs.readdirSync(missionDir(rootDir, slug))
    .filter(name => /^CP-\d+\.md$/.test(name))
    .sort();
}

function countTaskIds(rootDir: string, id: string) {
  let count = 0;
  for (const dir of ['tasks', 'completed', 'archive']) {
    const fullDir = path.join(rootDir, 'backlog', dir);
    if (!fs.existsSync(fullDir)) {
      continue;
    }
    for (const name of fs.readdirSync(fullDir)) {
      const content = fs.readFileSync(path.join(fullDir, name), 'utf8');
      if (new RegExp(`^id:\\s*${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'm').test(content)) {
        count += 1;
      }
    }
  }
  return count;
}

function discoverAdhocSlug(repoRoot: string) {
  const parent = path.dirname(repoRoot);
  const prefix = `${path.basename(repoRoot)}-px-`;
  const worktree = fs.readdirSync(parent).find(name => name.startsWith(prefix));
  return worktree ? worktree.slice(path.basename(repoRoot).length + 1) : null;
}

async function statusOutputFor(slug: string, rootDir: string, env: NodeJS.ProcessEnv) {
  const result = await runWorkflow(rootDir, env, ['status', slug]);
  return `${result.stdout}${result.stderr}`.replace(/\x1B\[[0-9;]*m/g, '');
}

function postIntegrateHookLines(repoRoot: string) {
  const marker = postIntegrateHookMarkerPath(repoRoot);
  return fs.existsSync(marker)
    ? fs.readFileSync(marker, 'utf8').trim().split('\n').filter(Boolean)
    : [];
}

interface LifecycleSummary {
  slug: string; repoRoot: string; worktree: string;
  draft: { taskStatus: string | null; missionId: string } | null;
  active: { checkpointFiles: string[]; milestoneFiles: string[]; reviewState: { phase: string; disposition: string | null }; taskIdCount: number } | null;
  integrate: {
    backlogStatus?: string | null; worktreeExistsAfter?: boolean;
    closeout?: { mission: Record<string, import('node:sqlite').SQLOutputValue> | undefined; measurements: Record<string, import('node:sqlite').SQLOutputValue> | undefined };
    mainHeadBefore?: string; mainHeadAfter?: string; featureHeadAfter?: string;
    hookLines?: string[]; landedSubject?: string; landedBody?: string; landedFiles?: string[]; versionAtFeature?: string;
  } | null;
}

async function runScenario(t: TestContext) {
  const backlogSlug = 'task-2001';
  const repo = setupRepository({ slug: backlogSlug, title: 'Completed Backlog Intake' });
  const env = workflowEnv(repo.binDir, repo.stateHome, repo.repoRoot);
  let slug = '';
  let worktree = '';
  let mainHeadBefore = '';
  let adhocMirror: string | null = null;
  const summary: LifecycleSummary = { slug, repoRoot: repo.repoRoot, worktree, draft: null, active: null, integrate: null };

  try {
    await t.test('free-text draft records a feature-base contract beside completed Backlog intake', async () => {
      const backlogTask = taskFileIn(repo.repoRoot, backlogSlug);
      assert.ok(backlogTask);
      const completedTask = path.join(repo.repoRoot, 'backlog', 'completed', path.basename(backlogTask));
      fs.writeFileSync(backlogTask, fs.readFileSync(backlogTask, 'utf8').replace('status: backlog', 'status: done'));
      fs.renameSync(backlogTask, completedTask);
      runGit(repo.repoRoot, ['add', '-A']);
      runGit(repo.repoRoot, ['commit', '-m', 'test: seed completed Backlog intake']);
      mainHeadBefore = runGit(repo.repoRoot, ['rev-parse', 'HEAD']);
      runGit(repo.repoRoot, ['checkout', '-b', 'feature/e2e-base']);

      await runWorkflow(repo.repoRoot, env, ['draft', 'fix hello world greeting', '--agent', 'custom']);
      slug = discoverAdhocSlug(repo.repoRoot) ?? '';
      assert.match(slug, /^px-\d+$/, 'free-text intake must allocate a DB-owned identity');
      worktree = worktreePathFor(repo.repoRoot, slug);
      summary.slug = slug;
      summary.worktree = worktree;
      assert.ok(fs.existsSync(worktree), `expected mission worktree at ${worktree}`);
      if (!shouldKeepTmp() || process.env.PARALLIX_E2E_CLEANUP_MARKER) {
        watchInterruptedFixture(repo.tmpRoot, repo.repoRoot, worktree);
      }
      pauseAfterWorktreeFixture(repo, worktree);
      adhocMirror = taskFileIn(worktree, slug);
      assert.ok(adhocMirror, 'draft should create a best-effort Backlog mirror in the adhoc worktree');
      assert.equal(taskStatus(adhocMirror), 'refined');
      assert.notEqual(worktree, worktreePathFor(repo.repoRoot, backlogSlug), 'Backlog and adhoc identities have distinct conventional worktree paths');
      assert.equal(taskStatus(completedTask), 'done', 'adhoc draft must not clobber the completed Backlog intake');
      assert.equal(fs.existsSync(missionPath(worktree, slug)), false, 'typed draft must not generate MISSION.md');
      const recordedBase = runGit(repo.repoRoot, ['config', '--get', `branch.mission/${slug}.parallixBase`]);
      assert.equal(recordedBase, 'feature/e2e-base');
      const missionId = /^id:\s*([^\r\n]+)/m.exec(fs.readFileSync(adhocMirror, 'utf8'))?.[1]?.trim();
      assert.equal(missionId?.toLowerCase(), slug, 'adhoc mirror must retain the DB-owned identity');
      summary.draft = { taskStatus: taskStatus(adhocMirror), missionId: missionId! };
    });

    await t.test('DB-owned active and review stay authoritative after mirror deletion', async () => {
      assert.ok(adhocMirror);
      fs.rmSync(adhocMirror);
      assert.equal(fs.existsSync(adhocMirror), false, 'active must not depend on the best-effort Backlog mirror');
      await runWorkflow(worktree, env, ['active', slug, '--implementer', 'custom']);
      assert.match(await statusOutputFor(slug, worktree, env), new RegExp(slug, 'i'), 'status must resolve the DB-owned identity after mirror deletion');
      const state = await reviewState(worktree, slug, env);
      summary.active = {
        checkpointFiles: checkpointFiles(worktree, slug),
        milestoneFiles: fs.readdirSync(missionDir(worktree, slug)).filter(name => name.startsWith('milestone-') && name.endsWith('.md')).sort(),
        reviewState: { phase: state.phase, disposition: state.disposition },
        taskIdCount: countTaskIds(worktree, summary.draft!.missionId),
      };
    });

    await t.test('integrate lands hook output inside the feature-base squash and closes out', async () => {
      const mainBeforeDryRun = runGit(repo.repoRoot, ['rev-parse', 'main']);
      const featureBeforeDryRun = runGit(repo.repoRoot, ['rev-parse', 'feature/e2e-base']);
      // TASK-2872.02 SC2: the review step's tests action is the only owner that starts the
      // configured gates; integrate admits its record.
      await runIntegrationTestsTurn(worktree, env, slug);
      await runWorkflow(worktree, env, ['integrate', slug, '--dry-run'], 60000, { invokeFromTarget: true });
      assert.ok(fs.existsSync(worktree), 'passing dry-run must preserve the mission worktree');
      assert.equal(runGit(repo.repoRoot, ['rev-parse', 'main']), mainBeforeDryRun, 'passing dry-run must not advance main');
      assert.equal(runGit(repo.repoRoot, ['rev-parse', 'feature/e2e-base']), featureBeforeDryRun, 'passing dry-run must not advance the feature base');
      await runWorkflow(worktree, env, ['integrate', slug], 60000, { invokeFromTarget: true });

      const backlogTask = taskFileIn(repo.repoRoot, backlogSlug);
      assert.ok(backlogTask, 'integration must preserve the completed Backlog intake');
      assert.equal(taskStatus(backlogTask), 'done');
      assert.ok(!fs.existsSync(worktree), 'integration must clean up the adhoc worktree');
      const authority = new DatabaseSync(path.join(repo.stateHome, 'parallix.db'), { readOnly: true });
      const closeout = {
        mission: authority.prepare('SELECT status, closed_at FROM missions WHERE id = ?').get(slug),
        measurements: authority.prepare("SELECT COUNT(*) AS total FROM usage_statistics WHERE mission = ? AND stage = 'default'").get(slug),
      };
      authority.close();
      const mainHeadAfter = runGit(repo.repoRoot, ['rev-parse', 'main']);
      const featureHeadAfter = runGit(repo.repoRoot, ['rev-parse', 'feature/e2e-base']);
      assert.equal(mainHeadAfter, mainHeadBefore, 'main must remain unchanged for feature-branch missions');
      assert.notEqual(featureHeadAfter, mainHeadBefore, 'feature base branch should receive the landed squash commit');
      const hookLines = postIntegrateHookLines(repo.repoRoot);
      assert.equal(hookLines.length, 1, 'post-integrate hook must run exactly once');
      assert.match(hookLines[0], new RegExp(`^slug=${slug} base_worktree=\\S+ base_branch=feature/e2e-base variant=variant-b$`));
      const landedSubject = runGit(repo.repoRoot, ['log', '-1', '--format=%s', 'feature/e2e-base']);
      const landedBody = runGit(repo.repoRoot, ['log', '-1', '--format=%b', 'feature/e2e-base']);
      const landedFiles = runGit(repo.repoRoot, ['show', '--name-only', '--format=', 'feature/e2e-base']).split('\n').filter(Boolean);
      const versionAtFeature = JSON.parse(runGit(repo.repoRoot, ['show', 'feature/e2e-base:package.json'])).version;
      assert.match(landedSubject, /fix hello world greeting/i);
      assert.ok(landedBody.split('\n').includes(`Task: ${slug}`));
      assert.ok(landedFiles.includes('package.json'), 'pre-commit hook output must land inside the squash commit');
      assert.equal(versionAtFeature, '1.0.1');
      summary.integrate = { ...summary.integrate, backlogStatus: taskStatus(backlogTask), worktreeExistsAfter: fs.existsSync(worktree), closeout, mainHeadBefore, mainHeadAfter, featureHeadAfter, hookLines, landedSubject, landedBody, landedFiles, versionAtFeature };
    });

    return summary;
  } finally {
    if (!shouldKeepTmp()) {
      fs.rmSync(repo.tmpRoot, { recursive: true, force: true });
      if (worktree) { fs.rmSync(worktree, { recursive: true, force: true }); }
    }
  }
}

/**
 * TASK-2872.02 SC1/SC2: gate execution belongs to the tests action, not to integrate. A red
 * recorded run keeps integrate refusing with the tests named, no gate started and no landing effect.
 */
async function runGateFailureScenario() {
  const slug = 'task-2003';
  const repo = setupRepository({ slug, title: 'Recorded Gate Failure Refusal' });
  const env = workflowEnv(repo.binDir, repo.stateHome, repo.repoRoot);
  let worktree = '';
  try {
    // This case owns the tests-action/integrate boundary. The sibling lifecycle case owns
    // free-text intake, so use the fixture's existing Backlog identity here and avoid paying
    // for a second unrelated ad-hoc intake path inside the 3.5 s integration CPU budget.
    await runWorkflow(repo.repoRoot, env, ['draft', slug, '--agent', 'custom']);
    worktree = worktreePathFor(repo.repoRoot, slug);
    const markers = path.join(repo.tmpRoot, 'gate-markers');
    // Agent approval covers the head it reviewed, so the failing gate is part of that head: a commit
    // made after approval would make the review non-current and the tests action would decline.
    installFailingIntegrationGates(worktree, slug, markers);
    await runWorkflow(worktree, env, ['active', slug, '--implementer', 'custom']);
    const testsRun = await runIntegrationTestsTurn(worktree, env, slug, { allowFailure: true });
    const testsMarkers = fs.readdirSync(markers).sort();
    const mainHeadBefore = runGit(repo.repoRoot, ['rev-parse', 'main']);
    const integrate = await runWorkflow(worktree, env, ['integrate', slug], 60000, { allowFailure: true, invokeFromTarget: true });
    return {
      slug,
      exitCode: integrate.status,
      testsOutput: `${testsRun.stdout}\n${testsRun.stderr}`,
      integrateOutput: `${integrate.stdout}\n${integrate.stderr}`,
      testsMarkers,
      integrateMarkers: fs.readdirSync(markers).sort(),
      hookLines: postIntegrateHookLines(repo.repoRoot),
      worktreeExists: fs.existsSync(worktree),
      mainHeadBefore,
      mainHeadAfter: runGit(repo.repoRoot, ['rev-parse', 'main']),
    };
  } finally {
    if (!shouldKeepTmp()) {
      fs.rmSync(repo.tmpRoot, { recursive: true, force: true });
      if (worktree) { fs.rmSync(worktree, { recursive: true, force: true }); }
    }
  }
}

test('the tests action records the gate run and integrate refuses it without starting a gate (px-0050.01, TASK-2872.02)', async () => {
  const result = await runGateFailureScenario();
  assert.equal(result.slug, 'task-2003');
  // px-0050.01: the tests action runs every independent gate to completion, blocks the dependent of
  // a failed prerequisite and reports each failure.
  assert.deepEqual(result.testsMarkers, ['failing', 'passing', 'second'], 'the tests action ran every independent gate and blocked the dependent one');
  assert.match(result.testsOutput, /first-defect/);
  assert.match(result.testsOutput, /second-defect/);
  assert.match(result.testsOutput, /2 failed, 1 blocked, 0 cancelled/);
  assert.match(result.testsOutput, /dependent-gate blocked by failing-gate/);
  assert.notEqual(result.exitCode, 0, 'a red recorded run must not admit integration');
  assert.match(result.integrateOutput, /\[FAIL\]/);
  assert.doesNotMatch(result.integrateOutput, /Repository gate \(integration\): /, 'px integrate must not start an integration gate');
  assert.deepEqual(result.integrateMarkers, result.testsMarkers, 'px integrate started no additional gate');
  assert.deepEqual(result.hookLines, [], 'the post-integrate hook must not run after the recorded gate failure');
  assert.ok(result.worktreeExists, 'a refused integration must preserve the mission worktree');
  assert.equal(result.mainHeadAfter, result.mainHeadBefore, 'a refused integration must not advance main');
});

test('feature-branch lifecycle drafts, activates, reviews and integrates through the public CLI', async t => {
  const summary = await runScenario(t);
  assert.match(summary.slug, /^px-\d+$/);
  assert.ok(summary.draft);
  assert.equal(summary.draft.taskStatus, 'refined');
  assert.equal(summary.draft.missionId.toLowerCase(), summary.slug);
  assert.ok(summary.active);
  assert.equal(summary.active.reviewState.phase, 'approved');
  assert.equal(summary.active.reviewState.disposition, 'APPROVED');
  assert.equal(summary.active.taskIdCount, 0, 'the deleted adhoc mirror must not be recreated');
  assert.deepEqual(summary.active.milestoneFiles, ['milestone-1.md']);
  assert.deepEqual(summary.active.checkpointFiles, []);
  assert.ok(summary.integrate);
  assert.equal(summary.integrate.backlogStatus, 'done');
  assert.equal(summary.integrate.worktreeExistsAfter, false);
  assert.equal(summary.integrate.mainHeadAfter, summary.integrate.mainHeadBefore);
  assert.notEqual(summary.integrate.featureHeadAfter, summary.integrate.mainHeadBefore);
  assert.equal(summary.integrate.closeout?.mission?.status, 'done');
  assert.ok(summary.integrate.closeout?.mission?.closed_at);
  assert.equal(summary.integrate.closeout?.measurements?.total, 1);
  assert.equal(summary.integrate.hookLines?.length, 1);
  assert.equal(summary.integrate.versionAtFeature, '1.0.1');
});
