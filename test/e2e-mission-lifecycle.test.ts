

// This is a source-level lifecycle suite. Run the canonical TypeScript
// entrypoint so concurrent package/publish tests rebuilding build/ cannot
// remove the CLI while a fixture is being created.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import childProcess from 'node:child_process';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const CLI_ENTRY = path.resolve(import.meta.dirname, '..', 'src', 'entry', 'px.ts');
// This file is ESM, so `require` is not in scope. Resolve the tsx loader the
// ESM way; the child processes below pass the result to `node --import`.
const TSX_LOADER = createRequire(import.meta.url).resolve('tsx');

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

function taskIdFromTask(taskPath) {
  const content = read(taskPath);
  const idMatch = content.match(/^id:\\s*([^\\r\\n]+)/m);
  return idMatch ? idMatch[1].trim() : 'TASK-UNKNOWN';
}

function missionTitleFromTask(taskPath, slug) {
  const content = read(taskPath);
  const titleMatch = content.match(/^title:\\s*([^\\r\\n]+)/m);
  return titleMatch ? titleMatch[1].trim() : slug;
}

const prompt = process.argv[process.argv.length - 1] || '';
const slug = match(prompt, /^Slug:\\s*((?:task-[a-z0-9-]+|parallix-adhoc-\\d+))/im)
  || match(prompt, /^Mode: act-on-review\\. Branch:\\s*mission\\/((?:task-[a-z0-9-]+|parallix-adhoc-\\d+))/im)
  || match(prompt, /^Mode: review\\. .*?Mission:\\s+.*?((?:task-[a-z0-9-]+|parallix-adhoc-\\d+))/im)
  || 'task-unknown';
const missionPath = match(prompt, /^Mission path:\\s*(.+)$/m) || match(prompt, /^Mission:\\s*(.+)$/m);
const missionDir = match(prompt, /^Mission dir:\\s*(.+)$/m) || (missionPath ? path.dirname(missionPath) : null);
const taskPath = match(prompt, /^Backlog task:\\s*(.+)$/m);
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
  const taskId = taskIdFromTask(taskPath);
  const title = missionTitleFromTask(taskPath, slug);
  const missionBody = [
    '---',
    'id: ' + taskId,
    'title: ' + title,
    'status: drafted',
    '---',
    '',
    '# Mission: ' + title + ' (' + slug + ')',
    '',
    '## Goal',
    'Exercise the real lifecycle with a deterministic stub agent.',
    '',
    '## Why Now',
    'Protect the TypeScript workflow surface from regression drift.',
    '',
    '## Refinement Signals',
    '- Predicted NEL bucket: Small (0-80)',
    '- Confidence: High',
    '- Selection note: activate as-is',
    '- Main drivers: e2e coverage',
    '',
    '## Scope',
    '- Run draft, active, review, and integrate through the real CLI.',
    '',
    '## Out of Scope',
    '- Real model execution',
    '',
    '## Success Criteria',
    '- Lifecycle completes with deterministic artifacts.',
    '',
    '## Risks and Assumptions',
    '- Stubbed codex replaces all agent output.',
    '',
    '## Checkpoints',
    '- CP 1: Draft and execute',
    '- CP 2: Review and integrate',
    '',
    '## Gates',
    '- [ ] node -e ""',
    '',
    '## Restricted Areas',
    '- None in the temp repo.',
    '',
    '## Stop Rules',
    '- Stop if the stub cannot satisfy the real workflow contract.',
    ''
  ].join('\\n');
  writeFile(missionPath, missionBody);
  writeFile(path.join(missionDir, 'milestone-1.md'), '# Milestone 1\\n\\nDraft scaffold complete.\\n');
}

if (/^Mode: execute after lock\\./m.test(prompt)) {
  const cp1 = [
    '# CP-1: Execute stub',
    '',
    '## Goal Check',
    '',
    '| Criterion | Evidence | Status |',
    '|-----------|----------|--------|',
    '| Mission scaffold exists | missions/' + slug + '/MISSION.md:1 | PASS |',
    ...(taskPath
      ? ['| Backlog task preserved | backlog/tasks/' + path.basename(taskPath) + ':1 | PASS |']
      : ['| Adhoc identity authoritative | test/task-2468-adhoc-lifecycle-repro.test.ts | PASS |']),
    '',
    'Next action: Run review.',
    ''
  ].join('\\n');
  const cp2 = [
    '# CP-2: Ready for review',
    '',
    '## Goal Check',
    '',
    '| Criterion | Evidence | Status |',
    '|-----------|----------|--------|',
    '| Execute artifacts committed | missions/' + slug + '/CP-1.md:1 | PASS |',
    '| Final checkpoint present | missions/' + slug + '/CP-2.md:1 | PASS |',
    '',
    'Next action: Approve the mission in review.',
    ''
  ].join('\\n');
  writeFile(path.join(missionDir, 'CP-1.md'), cp1);
  writeFile(path.join(missionDir, 'CP-2.md'), cp2);
  writeFile(path.join(process.cwd(), 'deliverable.txt'), 'stub execute output\\n');
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

function createTask(repoRoot, slug, title) {
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

  fs.mkdirSync(path.join(repoRoot, 'backlog', 'tasks'), { recursive: true });
  fs.mkdirSync(path.join(repoRoot, 'backlog', 'completed'), { recursive: true });
  fs.mkdirSync(path.join(repoRoot, 'backlog', 'archive'), { recursive: true });
  fs.mkdirSync(path.join(repoRoot, 'config'), { recursive: true });
  fs.mkdirSync(reviewTmpDir, { recursive: true });

  const agentStub = lifecycleStubSource();
  writeExecutable(path.join(binDir, 'opencode'), agentStub);
  writeExecutable(path.join(binDir, 'codex'), agentStub);
  fs.symlinkSync(process.execPath, path.join(binDir, 'node'));
  fs.symlinkSync(commandDir('git'), path.join(binDir, 'git'));
  fs.symlinkSync(commandDir('bash'), path.join(binDir, 'bash'));
  fs.symlinkSync(commandDir('id'), path.join(binDir, 'id'));
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

function workflowEnv(binDir, stateHome, repoRoot) {
  return {
    ...process.env,
    FORCE_COLOR: '0',
    FORGEJO_USER: 'custom',
    PRIMARY_WORKTREE: repoRoot,
    PARALLIX_HOME: stateHome,
    PATH: binDir
  };
}

function runWorkflow(repoRoot, env, args, timeout = 60000, { allowFailure = false } = {}) {
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

function shouldKeepTmp() {
  return process.env.PARALLIX_E2E_KEEP_TMP === '1';
}

function pauseAfterWorktreeFixture(repo, worktree) {
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
function cleanInterruptedFixtureSource(parentPid, root, repoRoot, worktree, cleanupMarker) {
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

function watchInterruptedFixture(root, repoRoot, worktree) {
  const cleanupMarker = process.env.PARALLIX_E2E_CLEANUP_MARKER || '';
  const watcher = childProcess.spawn(process.execPath, [
    '-e', cleanInterruptedFixtureSource(process.pid, root, repoRoot, worktree, cleanupMarker)
  ], { detached: true, stdio: 'ignore' });
  watcher.unref();
}

function taskFileIn(rootDir, slug) {
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

function taskStatus(taskPath) {
  const content = fs.readFileSync(taskPath, 'utf8');
  const match = content.match(/^status:\s*([^\r\n]+)/m);
  return match ? match[1].trim().toLowerCase() : null;
}

function missionPath(rootDir, slug) {
  return path.join(rootDir, 'missions', slug, 'MISSION.md');
}

function missionDir(rootDir, slug) {
  return path.join(rootDir, 'missions', slug);
}

// After the TASK-2322.12 cutover the review loop's state lives on the Review
// aggregate in the operator database, not in missions/<slug>/review-state.json.
// This suite stays black-box about that: it asks the CLI for the state through
// `px review <slug> --status`, which reads the same authority the loop writes.
// A mission whose loop never persisted its state therefore still fails here,
// exactly as the missing-file read used to.
function reviewState(rootDir, slug, env) {
  const result = runWorkflow(rootDir, env, ['review', slug, '--status']);
  const output = `${result.stdout}${result.stderr}`.replace(/\x1B\[[0-9;]*m/g, '');
  if (/No persisted review state found/.test(output)) {
    throw new Error(`px review ${slug} --status found no persisted review state\n${output}`);
  }
  const field = label => {
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

function reviewEventFiles(rootDir, slug) {
  const eventDir = path.join(missionDir(rootDir, slug), 'review-events');
  return fs.existsSync(eventDir)
    ? fs.readdirSync(eventDir).sort()
    : [];
}

function checkpointFiles(rootDir, slug) {
  return fs.readdirSync(missionDir(rootDir, slug))
    .filter(name => /^CP-\d+\.md$/.test(name))
    .sort();
}

function readMissionId(missionFile) {
  const content = fs.readFileSync(missionFile, 'utf8');
  const match = content.match(/^id:\s*([^\r\n]+)/m);
  return match ? match[1].trim() : null;
}

function countTaskIds(rootDir, id) {
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

function assertCheckpointShape(rootDir, slug, expectedFiles) {
  const files = checkpointFiles(rootDir, slug);
  assert.deepEqual(files, expectedFiles);
  for (const file of files) {
    const content = fs.readFileSync(path.join(missionDir(rootDir, slug), file), 'utf8');
    assert.match(content, /^# CP-\d+:/m, `${file} should have a checkpoint heading`);
    assert.match(content, /^## Goal Check$/m, `${file} should have an exact Goal Check heading`);
    assert.match(content, /^Next action:\s+\S/m, `${file} should have a non-generic Next action line`);
  }
}

function runScenario({ launchFromFeatureBranch = false, integrate = true, postIntegrateHook = false, failIntegrationGate = false }) {
  const slug = launchFromFeatureBranch ? 'task-2001' : 'task-2002';
  const title = launchFromFeatureBranch ? 'Feature Branch Lifecycle' : 'Primary Branch Lifecycle';
  const repo = setupRepository({ slug, title, postIntegrateHook });
  const env = workflowEnv(repo.binDir, repo.stateHome, repo.repoRoot);
  const worktree = worktreePathFor(repo.repoRoot, slug);
  /** @type {any} */
  const summary = {
    slug,
    repoRoot: repo.repoRoot,
    worktree,
    draft: null,
    active: null,
    integrate: null
  };

  if (!shouldKeepTmp() || process.env.PARALLIX_E2E_CLEANUP_MARKER) {
    watchInterruptedFixture(repo.tmpRoot, repo.repoRoot, worktree);
  }

  try {
    const mainHeadBefore = runGit(repo.repoRoot, ['rev-parse', 'HEAD']);

    if (launchFromFeatureBranch) {
      runGit(repo.repoRoot, ['checkout', '-b', 'feature/e2e-base']);
    }

    runWorkflow(repo.repoRoot, env, ['draft', slug, '--agent', 'custom']);

    assert.ok(fs.existsSync(worktree), `expected mission worktree at ${worktree}`);
    pauseAfterWorktreeFixture(repo, worktree);
    const worktreeTask = taskFileIn(worktree, slug);
    assert.ok(worktreeTask, 'draft should bootstrap the backlog task into the worktree');
    assert.equal(taskStatus(worktreeTask), 'refined');

    const draftedMission = fs.readFileSync(missionPath(worktree, slug), 'utf8');
    assert.match(draftedMission, /^---[\s\S]*^---$/m);
    assert.match(draftedMission, /^## Goal$/m);
    if (launchFromFeatureBranch) {
      assert.match(draftedMission, /^Base-Branch:\s*feature\/e2e-base$/m);
    } else {
      assert.doesNotMatch(draftedMission, /^Base-Branch:/m);
    }

    summary.draft = {
      taskStatus: taskStatus(worktreeTask),
      missionId: readMissionId(missionPath(worktree, slug)),
      missionHasBaseBranch: /^Base-Branch:/m.test(draftedMission)
    };

    runWorkflow(worktree, env, ['active', slug, '--implementer', 'custom']);

    const state = reviewState(worktree, slug, env);
    summary.active = {
      taskStatus: taskStatus(worktreeTask),
      checkpointFiles: checkpointFiles(worktree, slug),
      milestoneFiles: fs.readdirSync(missionDir(worktree, slug))
        .filter(name => name.startsWith('milestone-') && name.endsWith('.md'))
        .sort(),
      reviewState: {
        phase: state.phase,
        disposition: state.disposition
      },
      reviewEvents: reviewEventFiles(worktree, slug),
      taskIdCount: countTaskIds(worktree, summary.draft.missionId)
    };

    if (!integrate) {
      return summary;
    }

    // The review loop deliberately leaves its event-store files for the next
    // checkpoint boundary. Final integration gates require the exact tree they
    // verify to be committed, so model that boundary before invoking integrate.
    runGit(worktree, ['add', '--', path.relative(worktree, path.join(missionDir(worktree, slug), 'review-events'))]);
    runGit(worktree, ['commit', '-m', `test(${slug}): finalize review events`]);

    if (failIntegrationGate) {
      // px integrate reads repository gates from the mission worktree, so adding
      // a failing gate only here — after handoff/review used the passing base
      // config — makes integrate abort before any success seam can invoke the
      // post-integrate hook.
      const worktreeConfigPath = path.join(worktree, 'workflow.config.json');
      const worktreeConfig = JSON.parse(fs.readFileSync(worktreeConfigPath, 'utf8'));
      worktreeConfig.adapters.gates = { preIntegration: [{ key: 'failing-gate', command: 'exit 7' }] };
      fs.writeFileSync(worktreeConfigPath, JSON.stringify(worktreeConfig, null, 2));
      runGit(worktree, ['add', '--', 'workflow.config.json']);
      runGit(worktree, ['commit', '-m', `test(${slug}): install failing integration gate`]);

      const gateResult = runWorkflow(worktree, env, ['integrate', slug], 60000, { allowFailure: true });
      summary.integrate = {
        gateFailed: true,
        exitCode: gateResult.status,
        worktreeStillExists: fs.existsSync(worktree),
        postIntegrateHookLines: fs.existsSync(postIntegrateHookMarkerPath(repo.repoRoot))
          ? fs.readFileSync(postIntegrateHookMarkerPath(repo.repoRoot), 'utf8').trim().split('\n').filter(Boolean)
          : []
      };
      return summary;
    }

    runWorkflow(worktree, env, ['integrate', slug]);

    const rootTask = taskFileIn(repo.repoRoot, slug);
    assert.ok(rootTask, 'integrate should leave the task in the base checkout');
    assert.equal(taskStatus(rootTask), 'done');
    assert.ok(!fs.existsSync(worktree), 'integrate should clean up the mission worktree');

    const mainHeadAfter = runGit(repo.repoRoot, ['rev-parse', 'main']);
    if (launchFromFeatureBranch) {
      const featureHeadAfter = runGit(repo.repoRoot, ['rev-parse', 'feature/e2e-base']);
      assert.equal(mainHeadAfter, mainHeadBefore, 'main must remain unchanged for feature-branch missions');
      assert.notEqual(featureHeadAfter, mainHeadBefore, 'feature base branch should receive the landed squash commit');
    } else {
      assert.notEqual(mainHeadAfter, mainHeadBefore, 'main should advance after integrating a primary-branch mission');
    }

    summary.integrate = {
      rootTaskStatus: taskStatus(rootTask),
      worktreeExistsAfter: fs.existsSync(worktree),
      mainHeadBefore,
      mainHeadAfter
    };
    if (launchFromFeatureBranch) {
      summary.integrate.featureHeadAfter = runGit(repo.repoRoot, ['rev-parse', 'feature/e2e-base']);
    }

    if (postIntegrateHook) {
      const markerPath = postIntegrateHookMarkerPath(repo.repoRoot);
      summary.integrate.postIntegrateHookLines = fs.existsSync(markerPath)
        ? fs.readFileSync(markerPath, 'utf8').trim().split('\n').filter(Boolean)
        : [];
    }

    return summary;
  } finally {
    if (!shouldKeepTmp()) {
      fs.rmSync(repo.tmpRoot, { recursive: true, force: true });
      fs.rmSync(worktree, { recursive: true, force: true });
    }
  }
}

/**
 * Discover the adhoc slug a free-text draft materialized. The draft writes the
 * mission under the mission worktree's `missions/` dir; the worktree is the
 * sibling of the base repo named `<repo>-<slug>` (the configured worktree
 * pattern). The adhoc identity is the non-`task-` mission dir.
 */
function discoverAdhocSlug(repoRoot) {
  const parent = path.dirname(repoRoot);
  const base = path.basename(repoRoot);
  if (!fs.existsSync(parent)) {return null;}
  const siblings = fs.readdirSync(parent).filter((d) => d.startsWith(base + '-') && d !== base);
  for (const sibling of siblings) {
    const missionsDir = path.join(parent, sibling, 'missions');
    if (!fs.existsSync(missionsDir)) {continue;}
    const adhoc = fs.readdirSync(missionsDir)
      .filter((d) => !d.startsWith('.'))
      .find((d) => !d.startsWith('task-'));
    if (adhoc) {return adhoc;}
  }
  return null;
}

/**
 * Adhoc-only fixture: a repository with no `backlog/` directory at all. This is
 * intake case (2) from task-2468. Without a backlog dir, `px draft` of a
 * free-text prompt must still materialize a DB-owned `parallix-adhoc-<NNNN>`
 * mission and reach the lifecycle.
 */
function setupAdhocRepository({ title }) {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'parallix-e2e-'));
  const repoRoot = path.join(tmpRoot, 'repo');
  const binDir = path.join(repoRoot, 'bin');
  const stateHome = path.join(tmpRoot, 'parallix-home');
  const reviewTmpDir = path.join(tmpRoot, 'review-artifacts');

  // No backlog/ directory: the defining trait of the adhoc-only intake.
  fs.mkdirSync(path.join(repoRoot, 'config'), { recursive: true });
  fs.mkdirSync(reviewTmpDir, { recursive: true });

  const agentStub = lifecycleStubSource();
  writeExecutable(path.join(binDir, 'opencode'), agentStub);
  writeExecutable(path.join(binDir, 'codex'), agentStub);
  fs.symlinkSync(process.execPath, path.join(binDir, 'node'));
  fs.symlinkSync(commandDir('git'), path.join(binDir, 'git'));
  fs.symlinkSync(commandDir('bash'), path.join(binDir, 'bash'));
  fs.symlinkSync(commandDir('id'), path.join(binDir, 'id'));
  const graphifyPath = maybeCommandPath('graphify');
  if (graphifyPath) {
    fs.symlinkSync(graphifyPath, path.join(binDir, 'graphify'));
  }

  const adapters = {
    tasks: { provider: 'backlog-md', storage: 'backlog', stateMap: 'config/state-map.json' },
    agents: { models: { custom: 'stub/custom' } },
    missions: { baseDir: 'missions', branchPrefix: 'mission/', worktreePattern: '../<repo>-<slug>' },
    verification: { command: ':', defaultArea: 'all' },
    review: { provider: 'none', tmpDir: reviewTmpDir },
  };

  fs.writeFileSync(path.join(repoRoot, 'workflow.config.json'), JSON.stringify({
    product: { name: 'e2e-probe', targetUser: 'tests' },
    adapters,
  }, null, 2));

  fs.writeFileSync(path.join(repoRoot, 'config', 'state-map.json'), JSON.stringify({
    ready: 'refined',
    approved: 'ready-for-integration',
  }, null, 2));

  fs.writeFileSync(path.join(repoRoot, 'README.md'), '# E2E Probe\n', 'utf8');

  runGit(repoRoot, ['init']);
  runGit(repoRoot, ['checkout', '-b', 'main']);
  runGit(repoRoot, ['config', 'user.email', 'test@example.com']);
  runGit(repoRoot, ['config', 'user.name', 'Parallix E2E']);
  runGit(repoRoot, ['add', '.']);
  runGit(repoRoot, ['commit', '-m', 'initial test repo']);

  return { tmpRoot, repoRoot, binDir, stateHome, reviewTmpDir };
}

/**
 * Adhoc-only lifecycle: draft a free-text prompt, then drive the real CLI
 * through `active` and `review`. This is the regression net for the README's
 * free-text first-value path and proves the DB-owned adhoc identity flows the
 * full lifecycle without a Backlog task file.
 */
/**
 * Run `px status` for a slug and return the normalized (ANSI-stripped) output.
 * Read-only: the authority for review-loop state is the operator database, so
 * status must resolve the DB-owned adhoc identity without a Backlog task file.
 */
function statusOutputFor(slug, rootDir, env) {
  const result = runWorkflow(rootDir, env, ['status', slug]);
  return `${result.stdout}${result.stderr}`.replace(/\x1B\[[0-9;]*m/g, '');
}

/**
 * Locate the best-effort Backlog mirror the draft minted for a DB-owned adhoc
 * identity under the worktree's `backlog/tasks/` dir. Returns the first task
 * file found, or null when the mirror is absent.
 */
function findMirroredTaskFile(worktree, slug) {
  const tasksDir = path.join(worktree, 'backlog', 'tasks');
  if (!fs.existsSync(tasksDir)) {return null;}
  const entries = fs.readdirSync(tasksDir).filter(f => f.endsWith('.md'));
  return entries.length > 0 ? path.join(tasksDir, entries[0]) : null;
}

function runAdhocScenario() {
  const title = 'fix hello world greeting';
  const repo = setupAdhocRepository({ title });
  const env = workflowEnv(repo.binDir, repo.stateHome, repo.repoRoot);

  if (!shouldKeepTmp() || process.env.PARALLIX_E2E_CLEANUP_MARKER) {
    // No worktree pre-known for adhoc (slug is discovered after draft); the
    // interrupted-fixture watcher is a backlog-scenario concern.
  }

  try {
    runWorkflow(repo.repoRoot, env, ['draft', 'fix hello world greeting', '--agent', 'custom']);

    const slug = discoverAdhocSlug(repo.repoRoot);
    assert.ok(slug, 'draft must materialize an adhoc mission under missions/');
    assert.match(slug, /^parallix-adhoc-\d+$/i, 'adhoc identity must be the DB-owned parallix-adhoc-<NNNN> form');

    const worktree = worktreePathFor(repo.repoRoot, slug);
    assert.ok(fs.existsSync(worktree), `expected mission worktree at ${worktree}`);

    // F1 (task-2468 round 2): delete the best-effort Backlog mirror immediately
    // after draft — before `px active` — and prove the DB-authoritative lifecycle
    // still drives active → review → integrate. When the mirror is gone, the
    // execute path must not be mirror-gated: `px active` must still record the
    // authoritative MissionLifecycleService.activate() transition and reach an
    // approved review, and `px integrate` must still complete.
    const mirrorBeforeActive = findMirroredTaskFile(worktree, slug);
    if (mirrorBeforeActive) {
      fs.rmSync(mirrorBeforeActive, { force: true });
      assert.ok(!fs.existsSync(mirrorBeforeActive), 'the mirrored task file was removed before active');
    }

    // The red line on the parent commit: the `task-` prefix guard refuses this
    // with "slug must begin with task-". Green once the DB-owned adhoc identity
    // and shared-validator guard land.
    runWorkflow(worktree, env, ['active', slug, '--implementer', 'custom']);

    // F3 (task-2468): `px status` must resolve the DB-owned adhoc identity from
    // the operator database, not a Backlog task file. A `task-`-shaped
    // assumption would fail to recognize the namespace here.
    const statusOutput = statusOutputFor(slug, worktree, env);
    assert.match(statusOutput, /parallix-adhoc-\d+/i, 'px status must resolve the DB-owned adhoc identity');

    // F4 (task-2468): the Backlog task file is a best-effort one-way mirror for
    // a DB-owned adhoc identity. Delete it mid-mission and prove the operator
    // database still resolves the identity — `px status` reads lifecycle state
    // from the DB store, not the mirror. A reintroduced unguarded task-file
    // read on the status/active path throws here exactly as the old
    // missing-file read did.
    const mirror = findMirroredTaskFile(worktree, slug);
    if (mirror) {
      fs.rmSync(mirror, { force: true });
      assert.ok(!fs.existsSync(mirror), 'the mirrored task file was removed before status');
    }
    const statusAfterDeletion = statusOutputFor(slug, worktree, env);
    assert.match(statusAfterDeletion, /parallix-adhoc-\d+/i, 'px status must still resolve the DB-owned adhoc identity after the mirror is deleted');

    // `px review --status` reads lifecycle state from DB authority, not the
    // (best-effort) Backlog mirror. A missing review state fails here exactly as
    // the old missing-file read did.
    const state = reviewState(worktree, slug, env);
    assert.equal(state.phase, 'approved', 'adhoc mission should reach an approved review phase after a deleted mirror');

    // F1 (task-2468 round 2): `px integrate` must complete for a DB-owned adhoc
    // identity whose mirror was deleted before active. This drives the full
    // lifecycle end to end with no Backlog task file. The execute agent's fallback
    // commit and review artifacts leave the worktree dirty; commit them so the
    // integration checkout is finalized, exactly as the Backlog scenarios do.
    runGit(worktree, ['add', '-A']);
    runGit(worktree, ['commit', '-m', 'adhoc: capture execute artifacts before integrate']);
    runWorkflow(worktree, env, ['integrate', slug]);

    return { slug, worktree, reviewPhase: state.phase };
  } finally {
    if (!shouldKeepTmp()) {
      fs.rmSync(repo.tmpRoot, { recursive: true, force: true });
    }
  }
}

/**
 * Mixed-repository lifecycle: one repo that carries a real Backlog task AND
 * supports a DB-owned adhoc free-text draft (task-2468 round 3). This proves
 * both intake cases complete in the same repository without cross-intake
 * identity, lifecycle, or mirror interference.
 *
 * The Backlog task-2002 drives the full draft → active → review → integrate →
 * done lifecycle. The free-text draft materializes a DB-owned
 * parallix-adhoc-<NNNN> that drives draft → active → review (approved) in the
 * same repo. Assertions confirm distinct slugs/worktrees, that the Backlog
 * task reaches `done`, that the adhoc mirror lives in the adhoc worktree and
 * never clobbers the base repo's Backlog task, and that the Backlog task still
 * resolves after the adhoc draft.
 */
function runMixedScenario() {
  const title = 'Primary Branch Lifecycle';
  const repo = setupRepository({ slug: 'task-2002', title });
  const env = workflowEnv(repo.binDir, repo.stateHome, repo.repoRoot);

  try {
    // --- Backlog intake: full lifecycle to done ---
    runWorkflow(repo.repoRoot, env, ['draft', 'task-2002', '--agent', 'custom']);
    assert.ok(taskFileIn(repo.repoRoot, 'task-2002'), 'draft should create the Backlog task in the base repo');

    const backlogWorktree = worktreePathFor(repo.repoRoot, 'task-2002');
    assert.ok(fs.existsSync(backlogWorktree), `expected Backlog mission worktree at ${backlogWorktree}`);

    runWorkflow(backlogWorktree, env, ['active', 'task-2002', '--implementer', 'custom']);
    const backlogState = reviewState(repo.repoRoot, 'task-2002', env);
    assert.equal(backlogState.phase, 'approved', 'Backlog task should reach an approved review');

    // Integrate the Backlog task: squash into main, mark done, delete worktree.
    runGit(backlogWorktree, ['add', '-A']);
    runGit(backlogWorktree, ['commit', '-m', 'task-2002: capture execute artifacts']);
    runWorkflow(backlogWorktree, env, ['integrate', 'task-2002']);
    const rootTask = taskFileIn(repo.repoRoot, 'task-2002');
    assert.ok(rootTask, 'integrate should leave the Backlog task in the base repo');
    assert.equal(taskStatus(rootTask), 'done', 'Backlog task should be done after integrate');
    assert.ok(!fs.existsSync(backlogWorktree), 'integrate should clean up the Backlog worktree');

    // --- Adhoc intake: draft in the SAME repo, prove it works alongside ---
    runWorkflow(repo.repoRoot, env, ['draft', 'fix hello world greeting', '--agent', 'custom']);
    const adhocSlug = discoverAdhocSlug(repo.repoRoot);
    assert.ok(adhocSlug, 'adhoc draft must materialize under missions/');
    assert.match(adhocSlug, /^parallix-adhoc-\d+$/i, 'adhoc identity must be DB-owned');
    assert.notEqual(adhocSlug, 'task-2002', 'adhoc and Backlog identities must be distinct');

    const adhocWorktree = worktreePathFor(repo.repoRoot, adhocSlug);
    assert.ok(fs.existsSync(adhocWorktree), `expected adhoc mission worktree at ${adhocWorktree}`);
    assert.notEqual(adhocWorktree, backlogWorktree, 'adhoc and Backlog worktrees must be distinct');

    // The adhoc mirror lives in the adhoc worktree, not the base repo's Backlog.
    // The base repo's Backlog task must survive the adhoc draft untouched.
    assert.ok(taskFileIn(repo.repoRoot, 'task-2002'), 'base repo Backlog task must survive the adhoc draft');

    runWorkflow(adhocWorktree, env, ['active', adhocSlug, '--implementer', 'custom']);
    const adhocState = reviewState(repo.repoRoot, adhocSlug, env);
    assert.equal(adhocState.phase, 'approved', 'adhoc mission should reach an approved review');

    // Complete the adhoc half of the mixed scenario: integrate the DB-owned
    // adhoc identity through the real CLI, proving it completes the full
    // lifecycle end to end without a Backlog task file. The execute agent's
    // fallback commit and review artifacts leave the worktree dirty; commit
    // them so the integration checkout is finalized, exactly as the Backlog
    // scenarios do. Integrate squashes into main and cleans up the worktree.
    runGit(adhocWorktree, ['add', '-A']);
    runGit(adhocWorktree, ['commit', '-m', 'adhoc: capture execute artifacts before integrate']);
    runWorkflow(adhocWorktree, env, ['integrate', adhocSlug]);
    assert.ok(!fs.existsSync(adhocWorktree), 'integrate should clean up the adhoc worktree');

    // The Backlog task must still resolve after the adhoc draft (no mirror
    // clobbering across intake). The DB-owned adhoc identity never appears in
    // the base repo's Backlog task storage.
    assert.ok(taskFileIn(repo.repoRoot, 'task-2002'), 'Backlog task must still resolve after the adhoc draft');

    return {
      backlogSlug: 'task-2002',
      backlogStatus: 'done',
      adhocSlug,
      adhocReviewPhase: adhocState.phase,
      adhocStatus: 'integrated',
    };
  } finally {
    if (!shouldKeepTmp()) {
      fs.rmSync(repo.tmpRoot, { recursive: true, force: true });
    }
  }
}

function runScenarioInChild(options) {
  const encoded = Buffer.from(JSON.stringify(options), 'utf8').toString('base64');
  const stdoutPath = path.join(os.tmpdir(), `parallix-e2e-child-stdout-${process.pid}-${Date.now()}.log`);
  const stderrPath = path.join(os.tmpdir(), `parallix-e2e-child-stderr-${process.pid}-${Date.now()}.log`);
  const stdoutFd = fs.openSync(stdoutPath, 'w');
  const stderrFd = fs.openSync(stderrPath, 'w');
  let result;
  try {
    result = childProcess.spawnSync(process.execPath, [import.meta.filename, '--scenario', encoded], {
      cwd: path.resolve(import.meta.dirname, '..'),
      encoding: 'utf8',
      timeout: 120000,
      env: { ...process.env, FORCE_COLOR: '0' },
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
  if (result.status !== 0) {
    throw new Error(
      `scenario child failed (status=${result.status}, signal=${result.signal})\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`
    );
  }
  return JSON.parse((result.stdout || '').trim());
}

if (process.argv[2] === '--scenario') {
  const payload = JSON.parse(Buffer.from(process.argv[3], 'base64').toString('utf8'));
  const summary = runScenario(payload);
  process.stdout.write(JSON.stringify(summary));
  process.exit(0);
}

test('feature-branch lifecycle drafts from the recorded base and integrates back into that feature branch', () => {
  const summary = runScenarioInChild({ launchFromFeatureBranch: true, integrate: true });
  assert.equal(summary.draft.taskStatus, 'refined');
  assert.equal(summary.draft.missionHasBaseBranch, true);
  assert.equal(summary.active.taskStatus, 'ready-for-integration');
  assert.equal(summary.active.reviewState.phase, 'approved');
  assert.equal(summary.active.reviewState.disposition, 'APPROVED');
  assert.deepEqual(summary.active.checkpointFiles, ['CP-1.md', 'CP-2.md']);
  assert.equal(summary.integrate.rootTaskStatus, 'done');
  assert.equal(summary.integrate.worktreeExistsAfter, false);
  assert.equal(summary.integrate.mainHeadAfter, summary.integrate.mainHeadBefore);
  assert.notEqual(summary.integrate.featureHeadAfter, summary.integrate.mainHeadBefore);
});

test('primary-branch lifecycle integrates cleanly to main and marks the task done', () => {
  const summary = runScenarioInChild({ launchFromFeatureBranch: false, integrate: true });
  assert.equal(summary.draft.taskStatus, 'refined');
  assert.equal(summary.draft.missionHasBaseBranch, false);
  assert.equal(summary.active.taskStatus, 'ready-for-integration');
  assert.deepEqual(summary.active.checkpointFiles, ['CP-1.md', 'CP-2.md']);
  assert.equal(summary.integrate.rootTaskStatus, 'done');
  assert.equal(summary.integrate.worktreeExistsAfter, false);
  assert.notEqual(summary.integrate.mainHeadAfter, summary.integrate.mainHeadBefore);
});

test('configured post-integrate hook runs exactly once with slug/base-worktree/base-branch/variant env vars (SC2/SC3)', () => {
  const summary = runScenarioInChild({ launchFromFeatureBranch: false, integrate: true, postIntegrateHook: true });
  assert.equal(summary.integrate.rootTaskStatus, 'done');
  assert.equal(summary.integrate.postIntegrateHookLines.length, 1, 'hook must run exactly once for a successful integrate');
  assert.match(
    summary.integrate.postIntegrateHookLines[0],
    /^slug=task-2002 base_worktree=\S+ base_branch=main variant=variant-b$/
  );
});

test('a failed integration gate aborts before the post-integrate hook can run (SC4)', () => {
  const summary = runScenarioInChild({ launchFromFeatureBranch: false, integrate: true, postIntegrateHook: true, failIntegrationGate: true });
  assert.equal(summary.integrate.gateFailed, true);
  assert.notEqual(summary.integrate.exitCode, 0);
  assert.deepEqual(summary.integrate.postIntegrateHookLines, []);
});

test('a repo with no post-integrate hook configured runs px integrate with unchanged behavior (SC1)', () => {
  const summary = runScenarioInChild({ launchFromFeatureBranch: false, integrate: true, postIntegrateHook: false });
  assert.equal(summary.integrate.rootTaskStatus, 'done');
  assert.equal(summary.integrate.postIntegrateHookLines, undefined);
});

test('artifact-focused run produces mission, checkpoint, milestone, and review artifacts with the expected structure', () => {
  const summary = runScenarioInChild({ launchFromFeatureBranch: true, integrate: false });
  assert.ok(summary.draft.missionId, 'MISSION.md should contain a frontmatter id');
  assert.equal(summary.active.taskIdCount, 1, 'mission id should map to exactly one backlog task in the test repo');
  assert.deepEqual(summary.active.milestoneFiles, ['milestone-1.md']);
  assert.deepEqual(summary.active.checkpointFiles, ['CP-1.md', 'CP-2.md']);
  assert.ok(summary.active.reviewEvents.some(name => name.includes('reviewer_findings')));
  assert.ok(summary.active.reviewEvents.some(name => name.includes('reviewer_outcome')));
});

test('adhoc-only intake: a free-text draft reaches an approved review with a DB-owned adhoc identity', () => {
  const summary = runAdhocScenario();
  assert.match(summary.slug, /^parallix-adhoc-\d+$/i, 'the materialized identity must be the DB-owned adhoc form');
  assert.equal(summary.reviewPhase, 'approved', 'DB-authoritative review read must resolve the adhoc mission');
});

test('mixed intake: a Backlog task and a DB-owned adhoc mission both complete in one repository', () => {
  const summary = runMixedScenario();
  assert.equal(summary.backlogSlug, 'task-2002', 'the Backlog intake must run a task-<slug> mission');
  assert.equal(summary.backlogStatus, 'done', 'the Backlog intake must integrate to done');
  assert.match(summary.adhocSlug, /^parallix-adhoc-\d+$/i, 'the adhoc intake must materialize a DB-owned identity');
  assert.equal(summary.adhocReviewPhase, 'approved', 'the DB-owned adhoc intake must reach an approved review');
  assert.equal(summary.adhocStatus, 'integrated', 'the DB-owned adhoc intake must complete its lifecycle through px integrate');
});
