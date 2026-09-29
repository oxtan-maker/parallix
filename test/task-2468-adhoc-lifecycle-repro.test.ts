// TASK-2468 reproduction: a free-text adhoc mission must reach `active` (and
// beyond) on a DB-owned adhoc identity in a repository with no Backlog task.
// This is the red-to-green anchor: on the parent commit the `task-` prefix guard
// in `px active` refuses the adhoc identity, so the assertion below fails; it
// passes once the DB-owned adhoc identity and lifecycle work land.
//
// Runs the real CLI end to end against stub `codex`/`opencode` binaries on a
// fixture PATH — no real model, so it lives in the default suite.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import childProcess from 'node:child_process';
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const CLI_ENTRY = path.resolve(import.meta.dirname, '..', 'src', 'entry', 'px.ts');
const TSX_LOADER = createRequire(import.meta.url).resolve('tsx');
// The prebuilt integration lanes build the canonical bundle first. The stub
// agent's own `px` writes are harness, not the code under test, so there they
// run from the bundle and skip tsx's multi-second start-up on each spawn.
const PREBUILT_ENTRY = path.resolve(import.meta.dirname, '..', 'build', 'px.mjs');
const STUB_PX = process.env.PARALLIX_PREBUILT_PACK === '1' && fs.existsSync(PREBUILT_ENTRY)
  ? { entry: PREBUILT_ENTRY, loader: '' }
  : { entry: CLI_ENTRY, loader: TSX_LOADER };
function runCommand(command, args, options = {}) {
  const result = childProcess.spawnSync(command, args, {
    encoding: 'utf8',
    ...options
  });
  if (result.error && result.status === null) {
    throw result.error;
  }
  return result;
}

function runGit(cwd, args, options = {}) {
  const result = runCommand('git', args, { cwd, ...options });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
  }
  return (result.stdout || '').trim();
}

function commandDir(command) {
  const resolved = maybeCommandPath(command);
  if (!resolved) {
    throw new Error(`Could not resolve command on PATH: ${command}`);
  }
  return resolved;
}

function maybeCommandPath(command) {
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

function writeExecutable(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, 'utf8');
  fs.chmodSync(filePath, 0o755);
}

function lifecycleStubSource() {
  // The stub is written to an extensionless file on the fixture PATH, so Node
  // loads it as CommonJS. Its own `require` calls are part of the generated
  // script and are unrelated to this file's module system.
  return `#!${process.execPath}
const fs = require('node:fs');
const path = require('node:path');

// TASK-2521.03: activation refuses a mission whose contract draft never
// finished, so a drafting agent records it through \`px\` — the same commands the
// draft prompt names. The harness passes the CLI entry in the environment
// because this stub runs as a bare executable on the fixture PATH.
function px(args) {
  const entry = process.env.PARALLIX_E2E_PX_ENTRY;
  const loader = process.env.PARALLIX_E2E_PX_LOADER;
  if (!entry) { return null; }
  const run = require('node:child_process').spawnSync(
    process.execPath, (loader ? ['--import', loader] : []).concat([entry], args),
    { cwd: process.cwd(), encoding: 'utf8' }
  );
  return run.status === 0 ? (run.stdout || '') : null;
}

// Each write prints the Mission's new version, so the stub chains writes from
// that instead of re-reading \`px status\` between them: every \`px\` spawn
// costs a full CLI start-up.
function missionVersion(missionSlug) {
  const out = px(['status', missionSlug, '--json']);
  if (!out) { return null; }
  try { return String(JSON.parse(out).version); } catch (_) { return null; }
}

function writeChain(missionSlug, writes) {
  let v = missionVersion(missionSlug);
  for (const args of writes) {
    if (v === null) { return; }
    const out = px(args.concat(['--slug', missionSlug, '--expected-version', v]));
    try { v = out ? String(JSON.parse(out).version) : null; } catch (_) { v = null; }
  }
}

function recordMissionContract(missionSlug) {
  writeChain(missionSlug, [
    ['goal', 'set', '--goal', 'Exercise the real lifecycle with a deterministic stub agent',
      '--why', 'Protect the workflow surface from regression drift'],
    ['scope', 'set', '--scope', 'Run draft, active, review and integrate through the real CLI',
      '--out-of-scope', 'Real model execution'],
    ['gate', 'add', '--command', 'node -e ""'],
    ['criterion', 'add', '--text', 'The lifecycle reaches integration through the real CLI'],
    ['checkpoint', 'plan', '--name', 'CP-1', '--text', 'Execute the stub deliverable'],
    ['checkpoint', 'plan', '--name', 'CP-2', '--text', 'Ready the mission for review'],
    ['nel', 'set', '--predicted', 'Small'],
  ]);
}

function writeFile(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, 'utf8');
}

function read(filePath) {
  return fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : '';
}

function match(prompt, regex) {
  const found = prompt.match(regex);
  return found ? found[1].trim() : null;
}

const prompt = process.argv[process.argv.length - 1] || '';
const slug = match(prompt, /(parallix-adhoc-[0-9]+|task-[a-z0-9-]+)/im)
  || match(prompt, /^Mode: act-on-review\\. Branch:\\s*mission\\/(task-[a-z0-9-]+)/im)
  || match(prompt, /^Mode: review\\. .*?Mission:\\s+.*?(task-[a-z0-9-]+)/im)
  || 'task-unknown';
// Typed missions record the contract through px; the directory holds only
// optional mission-local artifacts.
const missionBaseDir = (() => {
  try {
    const cfg = JSON.parse(read(path.join(process.cwd(), 'workflow.config.json')) || '{}');
    return (cfg.adapters && cfg.adapters.missions && cfg.adapters.missions.baseDir) || 'missions';
  } catch (_) { return 'missions'; }
})();
const missionDir = match(prompt, /^Mission dir:\\s*(.+)$/m)
  || path.join(process.cwd(), missionBaseDir, slug);
const reviewFindingsPath = match(prompt, /\\\`([^\\\`\\n]+-review-findings\\.md)\\\`/);
const reviewOutcomePath = match(prompt, /\\\`([^\\\`\\n]+-review-outcome\\.md)\\\`/);
const reviewVerdictPath = match(prompt, /\\\`([^\\\`\\n]+-review-verdict\\.txt)\\\`/);
const resolutionPath = match(prompt, /\\\`([^\\\`\\n]+-round-resolution\\.md)\\\`/);
const dispositionPath = match(prompt, /\\\`([^\\\`\\n]+-review-disposition\\.txt)\\\`/);

if (process.argv.includes('--help')) {
  process.stdout.write('stub opencode help\\n');
  process.exit(0);
}

if (/^Mode: draft\\./m.test(prompt)) {
  recordMissionContract(slug);
  writeFile(path.join(missionDir, 'milestone-1.md'), '# Milestone 1\\n\\nTyped contract recorded.\\n');
}

if (/^Mode: execute after lock\\./m.test(prompt)) {
  writeFile(path.join(process.cwd(), 'deliverable.txt'), 'stub execute output\\n');
  writeChain(slug, [
    ['CP-1', 'Execute artifacts committed', 'Run review.'],
    ['CP-2', 'The lifecycle reaches integration through the real CLI', 'Approve the mission in review.'],
  ].map(([name, criterion, next]) => ['checkpoint', 'record', '--name', name,
    '--criterion', criterion, '--evidence', 'deliverable.txt:1', '--next', next]));
}

if (/^Mode: review\\./m.test(prompt)) {
  writeFile(reviewFindingsPath, '# Findings\\n\\nNo blocking findings. The lifecycle artifacts are present and consistent.\\n');
  writeFile(reviewOutcomePath, 'Verdict: approve\\n\\nLifecycle approved for integration.\\n');
  writeFile(reviewVerdictPath, 'approve\\n');
}

if (/^Mode: act-on-review\\./m.test(prompt)) {
  writeFile(resolutionPath, 'fixed_items: []\\npushed_back_items: []\\nparked_items: []\\nblocked_reason: ""\\n');
  writeFile(dispositionPath, 'CHANGES_MADE\\n');
}

process.stdout.write('{"sessionID":"ses_stubbed_opencode"}\\n');
`;
}

function postIntegrateHookMarkerPath(repoRoot) {
  return path.join(repoRoot, 'post-integrate-hook.log');
}

function writePostIntegrateHookScript(repoRoot) {
  const scriptPath = path.join(repoRoot, 'scripts', 'e2e-post-integrate-hook.sh');
  const markerPath = postIntegrateHookMarkerPath(repoRoot);
  writeExecutable(scriptPath, [
    '#!/usr/bin/env bash',
    'set -euo pipefail',
    `printf 'slug=%s base_worktree=%s base_branch=%s variant=%s\\n' "$INTEGRATE_HOOK_SLUG" "$INTEGRATE_HOOK_BASE_WORKTREE" "$INTEGRATE_HOOK_BASE_BRANCH" "$INTEGRATE_HOOK_VARIANT" >> ${JSON.stringify(markerPath)}`,
    ''
  ].join('\n'));
  return scriptPath;
}

function setupRepository({ slug, title, postIntegrateHook = false }) {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'parallix-e2e-'));
  const repoRoot = path.join(tmpRoot, 'repo');
  const binDir = path.join(repoRoot, 'bin');
  const stateHome = path.join(tmpRoot, 'parallix-home');
  const reviewTmpDir = path.join(tmpRoot, 'review-artifacts');

  // Adhoc-only fixture: no backlog/ directory at all. The mission identity is
  // DB-owned (parallix-adhoc-<NNNN>), so this draft must reach `active` with no
  // Backlog task file — the red->green anchor for the free-text first-value
  // path (task-2468). Any backlog/ creation here would contradict the fixture.
  fs.mkdirSync(path.join(repoRoot, 'config'), { recursive: true });
  fs.mkdirSync(reviewTmpDir, { recursive: true });

  const agentStub = lifecycleStubSource();
  writeExecutable(path.join(binDir, 'opencode'), agentStub);
  writeExecutable(path.join(binDir, 'codex'), agentStub);
  fs.symlinkSync(process.execPath, path.join(binDir, 'node'));
  fs.symlinkSync(commandDir('git'), path.join(binDir, 'git'));
  fs.symlinkSync(commandDir('bash'), path.join(binDir, 'bash'));
  fs.symlinkSync(commandDir('id'), path.join(binDir, 'id'));
  const bwrapPath = maybeCommandPath('bwrap');
  if (bwrapPath) {
    fs.symlinkSync(bwrapPath, path.join(binDir, 'bwrap'));
  }
  const graphifyPath = maybeCommandPath('graphify');
  if (graphifyPath) {
    fs.symlinkSync(graphifyPath, path.join(binDir, 'graphify'));
  }

  const adapters = {
    tasks: { provider: 'backlog-md', storage: 'backlog', stateMap: 'config/state-map.json' },
    agents: { models: { custom: 'stub/custom' } },
    missions: { baseDir: 'missions', branchPrefix: 'mission/', worktreePattern: '../<repo>-<slug>' },
    verification: { command: ':', defaultArea: 'all' },
    review: { provider: 'none', tmpDir: reviewTmpDir }
  };

  if (postIntegrateHook) {
    const scriptPath = writePostIntegrateHookScript(repoRoot);
// @ts-expect-error -- Legacy fixture intentionally accesses runtime-only `integrate` absent from its inferred mock shape.
    adapters.integrate = { postIntegrateCommand: `./${path.relative(repoRoot, scriptPath)}` };
  }

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

function workflowEnv(binDir, stateHome, repoRoot) {
  return {
    ...process.env,
    FORCE_COLOR: '0',
    FORGEJO_USER: 'custom',
    PRIMARY_WORKTREE: repoRoot,
    PARALLIX_HOME: stateHome,
    // The agent stub records the mission contract with `px`, the same commands
    // the draft prompt names, because activation now refuses an incomplete one.
    // It runs as a bare executable on the fixture PATH, so it cannot resolve
    // the CLI entry itself.
    PARALLIX_E2E_PX_ENTRY: STUB_PX.entry,
    PARALLIX_E2E_PX_LOADER: STUB_PX.loader,
    PATH: binDir
  };
}

// This test launches real CLI and agent-stub processes. Coverage instrumentation
// and concurrent integration workers can delay startup beyond one minute even
// though the fixture remains healthy, so keep the boundary bounded but give it
// the same two-minute allowance used by the end-to-end workflow lane.
function runWorkflow(repoRoot, env, args, timeout = 120000, { allowFailure = false } = {}) {
  const stdoutPath = path.join(os.tmpdir(), `parallix-e2e-stdout-${process.pid}-${Date.now()}.log`);
  const stderrPath = path.join(os.tmpdir(), `parallix-e2e-stderr-${process.pid}-${Date.now()}.log`);
  const stdoutFd = fs.openSync(stdoutPath, 'w');
  const stderrFd = fs.openSync(stderrPath, 'w');
  let result;
  try {
    result = childProcess.spawnSync(process.execPath, ['--import', TSX_LOADER, CLI_ENTRY, ...args], {
      cwd: repoRoot,
      env,
      timeout,
      stdio: ['ignore', stdoutFd, stderrFd]
    });
  } finally {
    fs.closeSync(stdoutFd);
    fs.closeSync(stderrFd);
  }
  result.stdout = fs.existsSync(stdoutPath) ? fs.readFileSync(stdoutPath, 'utf8') : '';
  result.stderr = fs.existsSync(stderrPath) ? fs.readFileSync(stderrPath, 'utf8') : '';
  fs.rmSync(stdoutPath, { force: true });
  fs.rmSync(stderrPath, { force: true });
  if (result.error && result.status === null) {
    throw result.error;
  }
  if (!allowFailure && result.status !== 0) {
    throw new Error(
      `px ${args.join(' ')} failed (status=${result.status}, signal=${result.signal}, error=${result.error ? result.error.message : 'none'})\n` +
      `stdout:\n${result.stdout}\nstderr:\n${result.stderr}`
    );
  }
  return result;
}

function worktreePathFor(repoRoot, slug) {
  return path.resolve(repoRoot, '..', `${path.basename(repoRoot)}-${slug}`);
}


/**
 * The draft materializes the mission under the mission worktree's `missions/`
 * dir, so discover the adhoc slug there. The worktree is the sibling of the
 * base repo named `<repo>-<slug>` (the configured worktree pattern).
 */
function missionDir(rootDir, slug) {
  return path.join(rootDir, 'missions', slug);
}

function discoverAdhocSlug(repoRoot) {
  const parent = path.dirname(repoRoot);
  const base = path.basename(repoRoot);
  const siblings = fs.existsSync(parent)
    ? fs.readdirSync(parent).filter((d) => d.startsWith(base + '-') && d !== base)
    : [];
  for (const sibling of siblings) {
    const missionsDir = path.join(parent, sibling, 'missions');
    if (!fs.existsSync(missionsDir)) {continue;}
    const entries = fs.readdirSync(missionsDir).filter((d) => !d.startsWith('.'));
    const adhoc = entries.find((d) => !d.startsWith('task-'));
    if (adhoc) {return adhoc;}
  }
  return null;
}

let sharedFixture: ReturnType<typeof setupRepository> | undefined;
after(() => {
  if (sharedFixture) {
    fs.rmSync(sharedFixture.tmpRoot, { recursive: true, force: true });
  }
});

test('a free-text adhoc mission reaches active on a DB-owned adhoc identity in a Backlog-less repo', () => {
  const repo = setupRepository({ slug: 'fix-hello-world-greeting', title: 'fix hello world greeting' });
  sharedFixture = repo;
  const env = workflowEnv(repo.binDir, repo.stateHome, repo.repoRoot);

  runWorkflow(repo.repoRoot, env, ['draft', 'fix hello world greeting', '--agent', 'custom']);

  const slug = discoverAdhocSlug(repo.repoRoot);
  assert.ok(slug, 'draft must materialize an adhoc mission under missions/');
  assert.match(slug, /^(parallix-adhoc|adhoc)-/i, 'materialized identity must be adhoc-owned');

  const worktree = worktreePathFor(repo.repoRoot, slug);
  assert.ok(fs.existsSync(worktree), `expected mission worktree at ${worktree}`);

  // The red line on the parent commit: the `task-` prefix guard refuses this
  // with "slug must begin with task-". It passes once the DB-owned adhoc
  // identity and lifecycle work land.
  runWorkflow(worktree, env, ['active', slug, '--implementer', 'custom']);
});

// F9 (task-2468): Success Criterion 5 guards the draft-side rejection path this
// mission edited (`resolveDraftTarget` / `resolveTaskFile` in draft-setup.ts /
// draft-stats.ts). The prior CP-4 row cited active.test:220, a mission-start
// test — a different command. This test runs the real `px draft` against a
// Backlog-less repo with a missing `task-<N>` argument and asserts the
// draft command itself rejects it (exit 1), not a sibling command.
test('px draft task-<missing> rejects a missing task file at the draft boundary', () => {
  assert.ok(sharedFixture, 'the lifecycle fixture must be available for the draft rejection proof');
  const repo = sharedFixture;
  const env = workflowEnv(repo.binDir, repo.stateHome, repo.repoRoot);

  const result = runWorkflow(
    repo.repoRoot,
    env,
    ['draft', 'task-missing-missing'],
    60000,
    { allowFailure: true }
  );
  assert.equal(result.status, 1, 'px draft must reject a missing task file with a non-zero exit');
  assert.match(
    `${result.stdout}${result.stderr}`,
    /task.*(not found|ambiguous|could not be resolved)/i,
    'the draft rejection must name the missing/ambiguous task file'
  );
});
