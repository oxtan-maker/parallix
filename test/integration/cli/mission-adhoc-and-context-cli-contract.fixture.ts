// TASK-2468 — shared fixtures for the Ad hoc lifecycle integration suite.
//
// Non-runnable support file (`.fixture.ts`) kept beside its suite. It holds the
// large, reusable adhoc-repo scaffolding (stub agent source, repo builder,
// workflow runner) so the suite file stays under the test line cap without
// merging unrelated source files.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import childProcess from 'node:child_process';
import { pxNodeArgs, resolvePxEntryLoader } from '../../lib/px-entry.js';

// Both the CLI under test and the stub agent's own `px` writes run from the
// prebuilt bundle in the prebuilt integration lanes, skipping tsx's
// multi-second start-up on each spawn.
export const PX = resolvePxEntryLoader();

function runCommand(command: string, args: string[], options: Record<string, unknown> = {}) {
  const result = childProcess.spawnSync(command, args, {
    encoding: 'utf8',
    ...options
  });
  if (result.error && result.status === null) {
    throw result.error;
  }
  return result;
}

function runGit(cwd: string, args: string[], options: Record<string, unknown> = {}) {
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

function lifecycleStubSource() {
  // The stub is written to an extensionless file on the fixture PATH, so Node
  // loads it as CommonJS. Its own `require` calls are part of the generated
  // script and are unrelated to this file's module system.
  return `#!${process.execPath}
  const fs = require('node:fs');
  const path = require('node:path');

  // Activation requires a recorded contract. Agent setup applies the same
  // typed commands through the production command graph in one child.
  function writeChain(missionSlug, writes) {
    // Contract setup is agent fixture work. Run the same production command
    // graph once for the chain instead of starting a CLI per setup mutation.
    const result = require('node:child_process').spawnSync(process.execPath,
      ['--import', ${JSON.stringify(path.resolve('node_modules/tsx/dist/loader.mjs'))},
       ${JSON.stringify(path.resolve('test/fixtures/mission-contract-agent-writes.ts'))},
       missionSlug, JSON.stringify(writes)], { cwd: process.cwd(), env: process.env, encoding: 'utf8' });
    if (result.status !== 0) { throw new Error(result.stdout + result.stderr); }
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
  const slug = match(prompt, /(px-[0-9]+|task-[a-z0-9-]+)/im)
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
      '--criterion', criterion, '--evidence', 'deliverable.txt:1', '--next', next]).concat([
      ['mission', 'mark-complete', '--all'],
    ]));
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

function postIntegrateHookMarkerPath(repoRoot: string) {
  return path.join(repoRoot, 'post-integrate-hook.log');
}

function writePostIntegrateHookScript(repoRoot: string) {
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

interface SetupRepoResult {
  tmpRoot: string;
  repoRoot: string;
  binDir: string;
  stateHome: string;
  reviewTmpDir: string;
}

function setupRepository({ slug, title, postIntegrateHook = false }: { slug: string; title: string; postIntegrateHook?: boolean }): SetupRepoResult {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'parallix-e2e-'));
  const repoRoot = path.join(tmpRoot, 'repo');
  const binDir = path.join(repoRoot, 'bin');
  const stateHome = path.join(tmpRoot, 'parallix-home');
  const reviewTmpDir = path.join(tmpRoot, 'review-artifacts');

  // Adhoc-only fixture: no backlog/ directory at all. The mission identity is
  // DB-owned (px-<NNNN>), so this draft must reach `active` with no
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

function workflowEnv(binDir: string, stateHome: string, repoRoot: string) {
  return {
    ...process.env,
    FORCE_COLOR: '0',
    FORGEJO_USER: 'custom',
    PRIMARY_WORKTREE: repoRoot,
    PARALLIX_HOME: stateHome,
    PATH: binDir
  };
}

// This test launches real CLI and agent-stub processes. Coverage instrumentation
// and concurrent integration workers can delay startup beyond one minute even
// though the fixture remains healthy, so keep the boundary bounded but give it
// the same two-minute allowance used by the end-to-end workflow lane.
function runWorkflow(repoRoot: string, env: NodeJS.ProcessEnv, args: string[], timeout = 120000, { allowFailure = false }: { allowFailure?: boolean } = {}) {
  // The CLI contract output is small. Capturing it directly keeps the same
  // subprocess boundary while avoiding four file operations per invocation.
  const result = childProcess.spawnSync(process.execPath, pxNodeArgs(PX, args), {
    cwd: repoRoot,
    env,
    timeout,
    encoding: 'utf8'
  });
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

function worktreePathFor(repoRoot: string, slug: string) {
  return path.resolve(repoRoot, '..', `${path.basename(repoRoot)}-${slug}`);
}

/**
 * The draft materializes the mission under the mission worktree's `missions/`
 * dir, so discover the adhoc slug there. The worktree is the sibling of the
 * base repo named `<repo>-<slug>` (the configured worktree pattern).
 */
function missionDir(rootDir: string, slug: string) {
  return path.join(rootDir, 'missions', slug);
}

function discoverAdhocSlug(repoRoot: string) {
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

export {
  runGit,
  runWorkflow,
  worktreePathFor,
  missionDir,
  discoverAdhocSlug,
  setupRepository,
  workflowEnv
};
