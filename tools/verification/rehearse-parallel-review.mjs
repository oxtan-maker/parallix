import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { initCommittedRepository } from '../../test/fixtures/git-repository.ts';

const cli = path.resolve(process.argv[2] ?? '');
assert.ok(path.isAbsolute(cli) && fs.existsSync(cli), 'supply the built public px executable');
const repository = path.resolve(import.meta.dirname, '../..');
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'px-parallel-review-'));
const root = path.join(scratch, 'repo');
const mainSlug = 'task-parallel-review';
const holderSlug = 'task-capacity-holder';
const mainWorktree = `${root}-${mainSlug}`;
const holderWorktree = `${root}-${holderSlug}`;
const agentSource = fs.readFileSync(path.join(import.meta.dirname, 'parallel-review-agent.cjs'), 'utf8');
const env = { ...process.env, PARALLIX_HOME: path.join(scratch, 'home'), PRIMARY_WORKTREE: root,
  PARALLIX_EXECUTION_ROOT: '', PARALLIX_NO_BUBBLEWRAP: '1', PARALLIX_NO_TUI: '1', FORCE_COLOR: '0',
  PARALLEL_REVIEW_STATE: scratch, PARALLEL_REVIEW_CLI: cli };
for (const key of ['NODE_OPTIONS', 'NODE_V8_COVERAGE', 'PARALLIX_WORKFLOW_OPERATION', 'PARALLIX_WORKFLOW_GENERATION',
  'PARALLIX_OPERATION_CAPTURE', 'PARALLIX_MISSION_TERMINAL', 'PARALLIX_MISSION_SOCKET']) delete env[key];

function installAgent(name) {
  const file = path.join(scratch, name);
  fs.writeFileSync(file, `#!${process.execPath}\n${agentSource}`, { mode: 0o755 });
  return file;
}
env.OPENCODE_BIN = installAgent('opencode');
env.CODEX_BIN = installAgent('codex');
env.CLAUDE_BIN = installAgent('claude');
env.PATH = `${scratch}${path.delimiter}${env.PATH}`;

function run(cwd, args) {
  const result = spawnSync(cli, args, { cwd, env, encoding: 'utf8', timeout: 120000, maxBuffer: 20 * 1024 * 1024 });
  fs.appendFileSync(path.join(scratch, 'commands.log'), `px ${args.join(' ')}\n${result.stdout}${result.stderr}\n`);
  assert.equal(result.status, 0, `px ${args.join(' ')}\n${result.stdout}\n${result.stderr}`);
  return result.stdout;
}
function waitFor(test, label, timeoutMs = 30000) {
  const end = Date.now() + timeoutMs;
  while (!test()) {
    if (Date.now() >= end) throw new Error(`timed out waiting for ${label}`);
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25);
  }
}
function spawnPx(cwd, args, logName) {
  const out = fs.openSync(path.join(scratch, logName), 'w');
  const child = spawn(cli, args, { cwd, env, detached: true, stdio: ['ignore', out, out] });
  fs.closeSync(out);
  return child;
}
let main;
let holder;
try {
  fs.mkdirSync(root);
  initCommittedRepository(root, {
    'config/agents.json': JSON.stringify({ steps: {
      draft: { eligible: ['custom'] }, active: { eligible: ['codex', 'custom'] }, review: { eligible: ['claude', 'custom'] }, integrate: { eligible: ['custom'] },
    } }),
    '.gitignore': 'node_modules\n',
    [`backlog/tasks/${mainSlug} - Parallel-review.md`]: `---\nid: TASK-PARALLEL-REVIEW\ntitle: Parallel review\nstatus: backlog\nassignee: []\nlabels: [ai_sdlc]\ndependencies: []\n---\n`,
    [`backlog/tasks/${holderSlug} - Capacity-holder.md`]: `---\nid: TASK-CAPACITY-HOLDER\ntitle: Capacity holder\nstatus: backlog\nassignee: []\nlabels: [ai_sdlc]\ndependencies: []\n---\n`,
    'src/value.js': 'export const value = 0;\n',
    'package.json': JSON.stringify({ type: 'module', version: '1.0.0', scripts: { build: 'node -e ""', test: 'node -e ""' } }),
    'scripts/verify-local.sh': '#!/bin/sh\nexit 0\n',
    'workflow.config.json': JSON.stringify({ adapters: {
      terminal: { host: 'pipe' }, tasks: { provider: 'backlog-md', storage: 'backlog' },
      agents: { maxConcurrentCustom: 1, models: { custom: 'stub/custom' }, runners: { custom: 'opencode' } },
      missions: { baseDir: 'missions', branchPrefix: 'mission/', worktreePattern: '../<repo>-<slug>' },
      verification: { command: './scripts/verify-local.sh all', defaultArea: 'all' }, review: { provider: 'none', tmpDir: path.join(scratch, 'review') },
    } }),
  });
  fs.chmodSync(path.join(root, 'scripts/verify-local.sh'), 0o755);
  spawnSync('git', ['add', '.'], { cwd: root });
  assert.equal(spawnSync('git', ['commit', '-m', 'install parallel rehearsal'], { cwd: root }).status, 0);
  run(root, ['draft', holderSlug, '--agent', 'custom']);
  run(root, ['draft', mainSlug, '--agent', 'custom']);
  for (const worktree of [mainWorktree, holderWorktree]) fs.symlinkSync(path.join(repository, 'node_modules'), path.join(worktree, 'node_modules'));

  main = spawnPx(mainWorktree, ['active', mainSlug, '--implementer', 'codex', '--reviewer', 'claude'], 'main.log');
  waitFor(() => fs.existsSync(path.join(scratch, 'implementation-ready')), 'main implementation');
  holder = spawnPx(holderWorktree, ['active', holderSlug, '--implementer', 'custom'], 'holder.log');
  waitFor(() => fs.existsSync(path.join(scratch, 'holder-started')), 'custom capacity holder');
  fs.writeFileSync(path.join(scratch, 'implementation-release'), 'release');
  waitFor(() => fs.existsSync(path.join(scratch, 'reviewer-claude.json')), 'first admitted reviewer');
  waitFor(() => fs.existsSync(path.join(scratch, 'main.log')) && /launching reviewer \(custom\)/i.test(fs.readFileSync(path.join(scratch, 'main.log'), 'utf8')), 'selected custom reviewer launch');
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1200);
  assert.equal(fs.existsSync(path.join(scratch, 'reviewer-custom.json')), false,
    'the selected custom reviewer remains queued while its admitted capacity is occupied');
  const releasedAt = Date.now();
  fs.writeFileSync(path.join(scratch, 'holder-release'), 'release');
  waitFor(() => fs.existsSync(path.join(scratch, 'reviewer-custom.json')), 'queued reviewer admission');
  fs.writeFileSync(path.join(scratch, 'reviewers-release'), 'release');
  const mainExit = await new Promise(resolve => { main.once('exit', (code, signal) => resolve({ code, signal })); });
  assert.deepEqual(mainExit, { code: 0, signal: null }, fs.readFileSync(path.join(scratch, 'main.log'), 'utf8'));

  const reviewers = ['claude', 'custom'].map(family => JSON.parse(fs.readFileSync(path.join(scratch, `reviewer-${family}.json`), 'utf8')));
  assert.equal(new Set(reviewers.map(item => item.sha)).size, 1, 'both reviewers judge one immutable revision');
  assert.equal(new Set(reviewers.map(item => item.sourceHash)).size, 1, 'both reviewers see one immutable source tree');
  assert.ok(reviewers.every(item => !item.stdinIsTTY), 'both native agents receive private non-interactive input');
  assert.ok(reviewers.find(item => item.family === 'claude').startedAt < releasedAt, 'first reviewer stays active while custom capacity is queued');
  assert.ok(reviewers.find(item => item.family === 'custom').startedAt >= releasedAt, 'queued reviewer starts only after admission releases');
  const status = JSON.parse(run(mainWorktree, ['status', mainSlug, '--json']));
  assert.equal(status.missionStatus, 'integration');
  const history = JSON.parse(run(mainWorktree, ['history', mainSlug, 'list', '--json']));
  const reviewRuns = history.map(item => item.record).filter(record => record.captureKind === 'agent' && ['claude', 'custom'].includes(record.family) && record.role === 'review');
  assert.deepEqual(reviewRuns.map(record => record.family).sort(), ['claude', 'custom']);
  assert.equal(new Set(reviewRuns.map(record => record.runId)).size, 2, 'review histories keep distinct labels and run identities');
  assert.ok(reviewRuns.every(record => record.revision === reviewers[0].sha));
  assert.equal(fs.readFileSync(path.join(mainWorktree, 'src/value.js'), 'utf8'), 'export const value = 1;\n');
  console.log(JSON.stringify({ lifecycle: 'public-px-parallel-review', revision: reviewers[0].sha,
    overlap: true, queuedBeforeAdmission: true, stdin: 'private pipes', histories: reviewRuns.map(({ runId, family, revision, state }) => ({ runId, family, revision, state })),
    status: status.missionStatus, disposableRoot: scratch }, null, 2));
} catch (error) {
  for (const name of ['main.log', 'holder.log', 'commands.log']) {
    const file = path.join(scratch, name);
    if (fs.existsSync(file)) console.error(`--- ${name} ---\n${fs.readFileSync(file, 'utf8').slice(-12000)}`);
  }
  throw error;
} finally {
  const holderMarker = path.join(scratch, 'holder-started');
  if (fs.existsSync(holderMarker)) {
    try { process.kill(JSON.parse(fs.readFileSync(holderMarker, 'utf8')).pid, 'SIGTERM'); } catch {}
  }
  for (const child of [main, holder]) {
    if (!child?.pid) continue;
    try { process.kill(-child.pid, 'SIGTERM'); } catch {}
  }
  await new Promise(resolve => setTimeout(resolve, 300));
  for (const child of [main, holder]) {
    if (!child?.pid) continue;
    try { process.kill(-child.pid, 'SIGKILL'); } catch {}
  }
  await new Promise(resolve => setTimeout(resolve, 300));
  fs.rmSync(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  assert.equal(fs.existsSync(scratch), false, 'disposable repository, histories and operator state are cleaned up');
}
