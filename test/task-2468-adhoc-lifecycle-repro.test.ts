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
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const CLI_ENTRY = path.resolve(import.meta.dirname, '..', 'src', 'entry', 'px.ts');
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
const slug = match(prompt, /(parallix-adhoc-[0-9]+|task-[a-z0-9-]+)/im)
  || match(prompt, /^Mode: act-on-review\\. Branch:\\s*mission\\/(task-[a-z0-9-]+)/im)
  || match(prompt, /^Mode: review\\. .*?Mission:\\s+.*?(task-[a-z0-9-]+)/im)
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
      : ['| Adhoc identity authoritative | DB-owned parallix-adhoc counter | PASS |']),
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

test('a free-text adhoc mission reaches active on a DB-owned adhoc identity in a Backlog-less repo', () => {
  const repo = setupRepository({ slug: 'fix-hello-world-greeting', title: 'fix hello world greeting' });
  const env = workflowEnv(repo.binDir, repo.stateHome, repo.repoRoot);

  try {
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
  } finally {
    fs.rmSync(repo.tmpRoot, { recursive: true, force: true });
  }
});

// F9 (task-2468): Success Criterion 5 guards the draft-side rejection path this
// mission edited (`resolveDraftTarget` / `resolveTaskFile` in draft-setup.ts /
// draft-stats.ts). The prior CP-4 row cited active.test:220, a mission-start
// test — a different command. This test runs the real `px draft` against a
// Backlog-less repo with a missing `task-<N>` argument and asserts the
// draft command itself rejects it (exit 1), not a sibling command.
test('px draft task-<missing> rejects a missing task file at the draft boundary', () => {
  const repo = setupRepository({ slug: 'task-missing', title: 'missing task' });
  const env = workflowEnv(repo.binDir, repo.stateHome, repo.repoRoot);

  try {
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
  } finally {
    fs.rmSync(repo.tmpRoot, { recursive: true, force: true });
  }
});
