// Tier 2 blocking e2e: launches the REAL `custom` agent family (opencode + a
// pinned local model) through the production launcher path in
// lib/agents/opencode.ts, over a throwaway repo, using the real `px` CLI.
//
// This is deliberately separate from test/e2e-mission-lifecycle.test.js
// (Tier 1), which stubs `opencode` entirely and stays the deterministic
// workflow-composition harness. This file proves the launcher boundary that
// the stub cannot see: real CLI argument construction, real model selection,
// and real agent output parseability (see missions/task-1359/MISSION.md).
//
// This gate requires a workstation with `opencode` on PATH and the repo's
// configured custom-family local model reachable. See docs/real-agent-smoke.md
// for prerequisites, invocation, expected runtime, and failure buckets.
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const childProcess = require('node:child_process');
const test = require('node:test');
const assert = require('node:assert/strict');

const packageJson = require('../package.json');
const CLI_ENTRY = path.resolve(__dirname, '..', packageJson.bin.px);

// Custom-family model for the smoke run comes from this repository's own
// workflow.config.json (adapters.agents.models.custom), so the e2e test always
// exercises the exact agent configuration Parallix itself runs with. The
// throwaway repo below still writes this value into its own workflow.config.json
// explicitly (config route), so the smoke run never depends on the developer's
// ambient PARALLIX_HOME/global state.
const workflowConfig = require('../workflow.config.json');
const CUSTOM_MODEL = workflowConfig?.adapters?.agents?.models?.custom;
const RUN_TIMEOUT_MS = Number(process.env.PARALLIX_REAL_AGENT_TIMEOUT_MS || 600000);
// A cold local backend or a queued shared model can need longer than the
// original 45-second probe cap before it emits its first response. Keep the
// probe bounded so an unavailable backend still fails ahead of the lifecycle,
// while allowing it enough time to establish that the configured model works.
// Operators can tighten or extend this independently when needed, but it can
// never outlive the corresponding single-session workflow budget.
const HEALTHCHECK_TIMEOUT_MS = Math.min(
  Number(process.env.PARALLIX_REAL_AGENT_HEALTHCHECK_TIMEOUT_MS || 120000),
  RUN_TIMEOUT_MS
);
// The active phase runs up to three sequential model sessions in one px
// invocation (execute agent, a possible repair relaunch, and the autonomous
// review loop), so it gets twice the single-session budget. Observed: a run
// where the relaunch machinery was legitimately recovering an
// incomplete-evidence checkpoint was killed at 600s mid-recovery.
const ACTIVE_TIMEOUT_MS = RUN_TIMEOUT_MS * 2;

function runCommand(command, args, options = {}) {
  const result = childProcess.spawnSync(command, args, { encoding: 'utf8', ...options });
  if (result.error && result.status === null) {
    throw result.error;
  }
  return result;
}

// Resolve against this process's own PATH first — this is the PATH the real
// `px` CLI (and the launcher's bare `opencode` spawn in lib/agents/opencode.ts)
// actually sees. A login-shell `bash -lc` fallback only covers tools whose
// location comes from profile scripts this process didn't inherit (rare, but
// git/bash/id can live there in some setups); user-local installs like
// opencode are frequently PATH-only in the current process, not in a fresh
// login shell, so checking the login shell first would produce false negatives.
function maybeCommandPath(command) {
  const dirs = (process.env.PATH || '').split(path.delimiter);
  for (const dir of dirs) {
    if (!dir) {continue;}
    const candidate = path.join(dir, command);
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      return candidate;
    } catch (_) { /* keep looking */ }
  }
  const probe = runCommand('bash', ['-lc', `command -v ${command}`], { encoding: 'utf8' });
  return probe.status === 0 ? (probe.stdout || '').trim() : null;
}

function opencodeCommandCandidates() {
  const candidates = [];
  const seen = new Set();
  const pushCandidate = (candidate) => {
    if (!candidate || seen.has(candidate)) {return;}
    seen.add(candidate);
    candidates.push(candidate);
  };

  pushCandidate(process.env.OPENCODE_BIN);
  pushCandidate('opencode');
  pushCandidate(path.join(os.homedir(), '.opencode', 'bin', 'opencode'));
  pushCandidate(path.join(os.homedir(), '.local', 'bin', 'opencode'));

  return candidates;
}

function maybeOpencodePath() {
  for (const candidate of opencodeCommandCandidates()) {
    if (candidate.includes(path.sep)) {
      try {
        fs.accessSync(candidate, fs.constants.X_OK);
        return candidate;
      } catch (_) {
        continue;
      }
    }
    const resolved = maybeCommandPath(candidate);
    if (resolved) {return resolved;}
  }
  return null;
}

function piCommandCandidates() {
  const candidates = [];
  const seen = new Set();
  const pushCandidate = (candidate) => {
    if (!candidate || seen.has(candidate)) {return;}
    seen.add(candidate);
    candidates.push(candidate);
  };

  pushCandidate(process.env.PI_BIN);
  // Pi is often installed through nvm. The controlling agent can narrow
  // PATH before it starts this gate while retaining NVM_BIN; use the absolute
  // executable so setupRepository can place its real-pi symlink in binDir.
  if (process.env.NVM_BIN) {
    pushCandidate(path.join(process.env.NVM_BIN, 'pi'));
  }
  // Match the production launcher's fallback for runners started from a
  // stripped environment that retains neither PATH nor NVM_BIN.
  pushCandidate(path.join(path.dirname(process.execPath), 'pi'));
  pushCandidate('pi');
  pushCandidate(path.join(os.homedir(), '.local', 'bin', 'pi'));

  return candidates;
}

function maybePiPath() {
  for (const candidate of piCommandCandidates()) {
    if (candidate.includes(path.sep)) {
      try {
        fs.accessSync(candidate, fs.constants.X_OK);
        return candidate;
      } catch (_) {
        continue;
      }
    }
    const resolved = maybeCommandPath(candidate);
    if (resolved) {return resolved;}
  }
  return null;
}

function requireCommandPath(command, resolver = maybeCommandPath) {
  const resolved = resolver(command);
  assert.ok(resolved, `Expected command path for ${command}`);
  return resolved;
}

function runGit(cwd, args) {
  const result = runCommand('git', args, { cwd });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
  }
  return (result.stdout || '').trim();
}

// ---- Failure classification (SC6) ----
// Distinguishes failure buckets so a red run is diagnosable rather than
// mysterious:
//   local-model-environment  — opencode / pinned model unavailable, or the
//                               real backend hung/timed out
//   opencode-launcher-failure — the real opencode invocation rejected the
//                               launch itself (bad -m argument, auth,
//                               missing binary) — the TASK-1351 class
//   parallix-workflow-failure — opencode launched and ran, but Parallix's
//                               own contract broke (e.g. unparseable
//                               MISSION.md) — the TASK-1273 class
const LAUNCHER_FAILURE_PATTERNS = [
  /\bmodel not found\b/i,
  /\bno such model\b/i,
  /\bunknown model\b/i,
  /\binvalid (?:api )?key\b/i,
  /\bunauthorized\b/i,
  /\bwal_checkpoint\b/i,
  /\bsqlite\b/i,
  /\bunrecognized option\b|\bunknown option\b|\bno such option\b|\binvalid option\b/i,
  /\bENOENT\b/,
];

const MODEL_UNAVAILABLE_PATTERNS = [
  /\bECONNREFUSED\b/i,
  /\bECONNRESET\b/i,
  /\bETIMEDOUT\b/i,
  /\bENOTFOUND\b/i,
  /connection (?:refused|reset|timed? ?out)/i,
  /\bservice (?:is )?unavailable\b/i,
  /\b(?:502|503|504)\b/,
];

function classifyFailure({ stdout, stderr, status, signal }) {
  const text = `${stdout || ''}\n${stderr || ''}`;
  if (signal) {
    return { bucket: 'local-model-environment', detail: `run was killed by signal ${signal} (likely a timeout waiting on the local model backend)` };
  }
  if (MODEL_UNAVAILABLE_PATTERNS.some((re) => re.test(text))) {
    return { bucket: 'local-model-environment', detail: 'local model backend appears unreachable (connection error)' };
  }
  if (LAUNCHER_FAILURE_PATTERNS.some((re) => re.test(text))) {
    return { bucket: 'opencode-launcher-failure', detail: 'opencode rejected the launch (bad model argument, auth failure, or missing binary)' };
  }
  return { bucket: 'parallix-workflow-failure', detail: `px draft exited ${status} without a recognizable launcher/model error signature` };
}

// Cheap preflight: confirms the real opencode binary exists before spending
// the full run budget. Model/config validity is exercised by the actual
// `px draft --agent custom` launch below; do not fail early on auxiliary
// opencode subcommands like `opencode models`, which can be tighter or flakier
// than the launcher path this smoke test is meant to verify.
function preflightCheck(runner) {
  // adapters.agents.models.custom is an optional override (see MISSION.md
  // "Amended during CP-3 execution"): when unset, the launcher omits -m and
  // the runner (opencode/pi) falls back to its own configured default model,
  // so this gate no longer requires a pinned model string to exist.
  if (runner === 'pi') {
    const piPath = maybePiPath();
    if (!piPath) {
      return 'pi binary not found on PATH. Install @earendil-works/pi-coding-agent and configure a working default model (~/.pi/agent/models.json + settings.json defaultModel) before running this gate.';
    }
    return null;
  }
  const opencodePath = maybeOpencodePath();
  if (!opencodePath) {
    return 'opencode binary not found on PATH. Install opencode and configure a working custom-family default model before running this gate.';
  }
  return null;
}

function runOpencodeHealthcheck(repoRoot, env, timeoutMs = HEALTHCHECK_TIMEOUT_MS) {
  const command = maybeOpencodePath() || 'opencode';
  const args = ['run', '--pure', '--dangerously-skip-permissions', '--format', 'json'];
  if (CUSTOM_MODEL) {args.push('-m', CUSTOM_MODEL);}
  args.push('Reply with exactly OK');
  return runWorkflowAllowFail(
    repoRoot,
    env,
    [command, ...args],
    timeoutMs,
    { directCommand: true }
  );
}

function runPiHealthcheck(repoRoot, env, timeoutMs = HEALTHCHECK_TIMEOUT_MS) {
  const command = maybePiPath() || 'pi';
  const args = ['--print', '--mode', 'json', '--approve'];
  if (CUSTOM_MODEL) {args.push('--model', CUSTOM_MODEL);}
  args.push('Reply with exactly OK');
  return runWorkflowAllowFail(
    repoRoot,
    env,
    [command, ...args],
    timeoutMs,
    { directCommand: true }
  );
}

function runHealthcheck(runner, repoRoot, env, timeoutMs = HEALTHCHECK_TIMEOUT_MS) {
  return runner === 'pi'
    ? runPiHealthcheck(repoRoot, env, timeoutMs)
    : runOpencodeHealthcheck(repoRoot, env, timeoutMs);
}

function setupRepository({ slug, title, runner = 'opencode' }) {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'parallix-real-agent-'));
  const repoRoot = path.join(tmpRoot, 'repo');
  const binDir = path.join(repoRoot, 'bin');
  const stateHome = path.join(tmpRoot, 'parallix-home');
  const reviewTmpDir = path.join(tmpRoot, 'review-artifacts');
  const piAgentHome = path.join(tmpRoot, 'pi-agent');

  // Pi takes an exclusive lock on its global settings and writes sessions
  // beneath its agent directory. Seed the model/default configuration into a
  // disposable writable directory so the real runner can execute in a
  // sandboxed integration process without mutating the operator's Pi state.
  if (runner === 'pi') {
    fs.mkdirSync(piAgentHome, { recursive: true });
    const configuredPiAgentHome = path.join(os.homedir(), '.pi', 'agent');
    for (const fileName of ['models.json', 'settings.json', 'auth.json']) {
      const source = path.join(configuredPiAgentHome, fileName);
      if (fs.existsSync(source)) {
        fs.copyFileSync(source, path.join(piAgentHome, fileName));
      }
    }
  }

  // Hand-rolled backlog.md structure: equivalent to `backlog init` +
  // `backlog task create`, written directly for speed (no CLI dependency,
  // no interactive prompts) but complete enough that the `backlog` CLI and
  // px's backlog adapter both operate on it: full directory skeleton plus a
  // config.yml whose statuses cover every transition the px lifecycle
  // performs (backlog -> refined -> active -> review -> ready-for-integration).
  for (const dir of [
    ['backlog', 'tasks'],
    ['backlog', 'drafts'],
    ['backlog', 'completed'],
    ['backlog', 'archive', 'tasks'],
    ['backlog', 'archive', 'drafts'],
    ['backlog', 'decisions'],
    ['backlog', 'docs'],
    ['backlog', 'milestones']
  ]) {
    fs.mkdirSync(path.join(repoRoot, ...dir), { recursive: true });
  }
  fs.mkdirSync(path.join(repoRoot, 'config'), { recursive: true });
  fs.mkdirSync(binDir, { recursive: true });
  fs.mkdirSync(reviewTmpDir, { recursive: true });
  fs.mkdirSync(stateHome, { recursive: true });

  // Force every workflow step onto the `custom` family via the product's own
  // blocklist mechanism (docs/agents.md "Local blocklist overrides", merged
  // from <PARALLIX_HOME>/agents.local.json). This does two things:
  //   1. Reviewer forcing: with no different-family agent eligible, the review
  //      loop takes its single-family fallback and assigns `custom` as the
  //      reviewer on its own PR (lib/review/review-loop.js), which the test
  //      asserts explicitly.
  //   2. Cost containment: no fallback or reviewer selection can ever launch
  //      an expensive cloud agent (claude/codex) from this blocking gate.
  fs.writeFileSync(path.join(stateHome, 'agents.local.json'), JSON.stringify({
    blocklist: {
      claude: { blocked: true },
      codex: { blocked: true },
      vibe: { blocked: true }
    }
  }, null, 2), 'utf8');

  // Minimal repo verification gate: drafted missions declare gates like
  // `./scripts/verify-local.sh docs` (the scaffold default), and the workflow
  // executes mission-declared gates literally at handoff. A real px-managed
  // repo ships this script, so the throwaway repo must too — otherwise every
  // draft fails its own declared gates on a missing file.
  fs.mkdirSync(path.join(repoRoot, 'scripts'), { recursive: true });
  const verifyStub = path.join(repoRoot, 'scripts', 'verify-local.sh');
  fs.writeFileSync(verifyStub, '#!/usr/bin/env bash\n# Smoke-repo verification gate: nothing to verify in the throwaway repo.\nexit 0\n', 'utf8');
  fs.chmodSync(verifyStub, 0o755);

  fs.writeFileSync(path.join(repoRoot, 'backlog', 'config.yml'), [
    'project_name: "real-agent-smoke"',
    'default_status: "backlog"',
    'statuses: ["backlog", "refined", "active", "review", "ready-for-integration", "done"]',
    'labels: []',
    'date_format: yyyy-mm-dd',
    'max_column_width: 20',
    'auto_open_browser: false',
    // default_port must be present: the backlog CLI adds it when absent, which
    // would dirty the committed tree mid-draft and fail draft's repo-state check.
    'default_port: 6420',
    'remote_operations: false',
    'auto_commit: false',
    'bypass_git_hooks: false',
    'check_active_branches: true',
    'active_branch_days: 30',
    'task_prefix: "task"',
    ''
  ].join('\n'), 'utf8');

  // Real launcher on PATH — unlike test/e2e-mission-lifecycle.test.js, no
  // scripted stub is installed here (SC3: the production launch path must
  // actually be reached). Symlink whichever binary the runner under test
  // needs (resolveCustomRunner dispatches to it at runtime).
  if (runner === 'pi') {
    fs.symlinkSync(requireCommandPath('pi', maybePiPath), path.join(binDir, 'pi'));
  } else {
    fs.symlinkSync(requireCommandPath('opencode', maybeOpencodePath), path.join(binDir, 'opencode'));
  }
  fs.symlinkSync(process.execPath, path.join(binDir, 'node'));
  fs.symlinkSync(requireCommandPath('git'), path.join(binDir, 'git'));
  fs.symlinkSync(requireCommandPath('bash'), path.join(binDir, 'bash'));
  fs.symlinkSync(requireCommandPath('id'), path.join(binDir, 'id'));

  fs.writeFileSync(path.join(repoRoot, 'workflow.config.json'), JSON.stringify({
    product: { name: 'real-agent-smoke', targetUser: 'tests' },
    adapters: {
      tasks: { provider: 'backlog-md', storage: 'backlog', stateMap: 'config/state-map.json' },
      agents: { models: CUSTOM_MODEL ? { custom: CUSTOM_MODEL } : {}, runners: { custom: runner } },
      missions: { baseDir: 'missions', branchPrefix: 'mission/', worktreePattern: '../<repo>-<slug>' },
      verification: { command: ':', defaultArea: 'all' },
      review: { provider: 'none', tmpDir: reviewTmpDir }
    }
  }, null, 2));

  fs.writeFileSync(path.join(repoRoot, 'config', 'state-map.json'), JSON.stringify({
    ready: 'refined',
    approved: 'ready-for-integration'
  }, null, 2));

  fs.writeFileSync(path.join(repoRoot, 'README.md'), '# Real Agent Smoke Probe\n', 'utf8');
  fs.writeFileSync(path.join(repoRoot, 'hello.sh'), '#!/usr/bin/env bash\necho "Helo, Wrld!"\n', 'utf8');

  const taskPath = path.join(repoRoot, 'backlog', 'tasks', `${slug} - ${title.replace(/\s+/g, '-').toLowerCase()}.md`);
  fs.writeFileSync(taskPath, [
    '---',
    `id: ${slug.toUpperCase()}`,
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
    'Fix the typo in hello.sh so it prints Hello, World!',
    ''
  ].join('\n'), 'utf8');

  runGit(repoRoot, ['init', '-b', 'main']);
  runGit(repoRoot, ['config', 'user.email', 'test@example.com']);
  runGit(repoRoot, ['config', 'user.name', 'Parallix Real-Agent Smoke']);
  runGit(repoRoot, ['add', '.']);
  runGit(repoRoot, ['commit', '-m', 'initial smoke repo']);

  return { tmpRoot, repoRoot, binDir, stateHome, piAgentHome };
}

function runWorkflowAllowFail(repoRoot, env, args, timeout, options = {}) {
  const {
    directCommand = false
  } = options;
  const stdoutPath = path.join(os.tmpdir(), `parallix-real-agent-stdout-${process.pid}-${Date.now()}.log`);
  const stderrPath = path.join(os.tmpdir(), `parallix-real-agent-stderr-${process.pid}-${Date.now()}.log`);
  const stdoutFd = fs.openSync(stdoutPath, 'w');
  const stderrFd = fs.openSync(stderrPath, 'w');
  let result;
  try {
    const command = directCommand ? args[0] : process.execPath;
    const commandArgs = directCommand ? args.slice(1) : [CLI_ENTRY, ...args];
    result = childProcess.spawnSync(command, commandArgs, {
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
  return result;
}

function shouldKeepTmp() {
  return process.env.PARALLIX_E2E_KEEP_TMP === '1';
}

// Default Parallix state roots that must never receive smoke-run writes
// (resolveParallixHome fallbacks when PARALLIX_HOME is unset: Linux default
// and the generic-UNIX fallback).
const DEFAULT_PARALLIX_HOMES = [
  path.join(os.homedir(), '.local', 'state', 'parallix'),
  path.join(os.homedir(), '.parallix')
];

// Snapshot the developer's default-location Parallix state before the run so
// the isolation assertions can be delta-based (only lines added by THIS run
// count as leakage).
function snapshotDefaultParallixState() {
  const snapshots = new Map();
  for (const home of DEFAULT_PARALLIX_HOMES) {
    for (const file of ['stats.csv', 'agents.local.json']) {
      const filePath = path.join(home, file);
      if (fs.existsSync(filePath)) {
        snapshots.set(filePath, fs.readFileSync(filePath, 'utf8'));
      }
    }
  }
  return snapshots;
}

function runRealAgentSmoke(runner) {
  const preflightError = preflightCheck(runner);
  if (preflightError) {
    assert.fail(
      `[local-model-environment] Cannot run the real custom-agent smoke test (runner=${runner}): ${preflightError}\n` +
      `This blocking gate requires a workstation with ${runner} installed and a working default local model ` +
      '(or adapters.agents.models.custom set as an explicit override). See docs/real-agent-smoke.md.'
    );
  }

  const slug = runner === 'pi' ? 'task-9002' : 'task-9001';
  const defaultStateSnapshots = snapshotDefaultParallixState();
  const repo = setupRepository({ slug, title: 'Real Agent Launcher Smoke', runner });
  const worktree = path.resolve(repo.repoRoot, '..', `${path.basename(repo.repoRoot)}-${slug}`);
  // Parallix-owned state isolation goes through configuration, not a hard
  // filesystem sandbox: PARALLIX_HOME is the highest-precedence resolver input
  // for both <PARALLIX_HOME>/stats.csv and the agent blocking file
  // <PARALLIX_HOME>/agents.local.json (lib/core/storage.ts), so temp-scoping it
  // keeps every Parallix write out of the developer's real state root.
  // opencode's own runtime state (XDG data dir) is deliberately NOT overridden:
  // the launcher child keeps its normal user configuration.
  // binDir comes FIRST so the `opencode` the launcher resolves is the real
  // binary symlinked by setupRepository (the launcher-boundary guarantee).
  // The rest of the normal PATH is kept: the agent's own tooling must work
  // like a real workstation — with a bare binDir-only PATH, opencode's glob
  // tool cannot even extract its bundled ripgrep (spawns `tar`), feeding the
  // agent artificial tool errors that destabilize the draft.
  const env = {
    ...process.env,
    FORCE_COLOR: '0',
    PRIMARY_WORKTREE: repo.repoRoot,
    PARALLIX_HOME: repo.stateHome,
    PATH: `${repo.binDir}${path.delimiter}${process.env.PATH || ''}`
  };
  if (runner === 'pi') {
    env.PI_CODING_AGENT_DIR = repo.piAgentHome;
  }
  // Drop the inherited PWD: opencode trusts PWD over the real cwd for project
  // resolution, so a stale PWD pointing at the developer's primary repo makes
  // the launcher child attach to that project instead of the throwaway repo —
  // colliding with any concurrently running opencode sessions (observed as
  // SQLite WAL contention and as the child hanging at exit until SIGTERM).
  delete env.PWD;

  try {
    // Verify CLI-under-test provenance: CLI_ENTRY resolves from this file's __dirname
    // to the repo's px.js. This ensures we test the code under test, not a stale installed px.
    // The __dirname is the test/ directory, so CLI_ENTRY = path.resolve(test/, ../, px.js) = repo/px.js
    assert.ok(
      fs.existsSync(CLI_ENTRY),
      `[parallix-workflow-failure] CLI Entry point ${CLI_ENTRY} does not exist; may be using stale installed px`
    );
    assert.ok(
      CLI_ENTRY.includes('px.js'),
      `[parallix-workflow-failure] CLI Entry point ${CLI_ENTRY} does not point to px.js; may be using stale installed px`
    );

    // Fast-fail launcher sanity check: probe the real child path with the
    // configured model before spending the full workflow timeout. This
    // catches broken local launcher/model state without misattributing it
    // to Parallix's mission lifecycle.
    const healthcheckResult = runHealthcheck(runner, repo.repoRoot, env);
    if (healthcheckResult.status !== 0) {
      const { bucket, detail } = classifyFailure(healthcheckResult);
      assert.fail(
        `[${bucket}] ${runner} healthcheck for the configured model failed (status=${healthcheckResult.status}, signal=${healthcheckResult.signal}): ${detail}\n` +
        `stdout:\n${healthcheckResult.stdout}\nstderr:\n${healthcheckResult.stderr}`
      );
    }

    // Phase 1: Draft
    const draftStartedAt = Date.now();
    const draftResult = runWorkflowAllowFail(repo.repoRoot, env, ['draft', slug, '--agent', 'custom'], RUN_TIMEOUT_MS);
    const draftDurationMs = Date.now() - draftStartedAt;

    if (draftResult.status !== 0) {
      const { bucket, detail } = classifyFailure(draftResult);
      assert.fail(
        `[${bucket}] px draft --agent custom failed (status=${draftResult.status}, signal=${draftResult.signal}): ${detail}\n` +
        `stdout:\n${draftResult.stdout}\nstderr:\n${draftResult.stderr}`
      );
    }

    assert.match(
      draftResult.stdout,
      /Draft agent family: custom/,
      '[parallix-workflow-failure] expected the real run to select the custom agent family'
    );

    const missionFile = path.join(worktree, 'missions', slug, 'MISSION.md');
    assert.ok(fs.existsSync(missionFile), `[parallix-workflow-failure] expected a real MISSION.md at ${missionFile}`);
    const missionBody = fs.readFileSync(missionFile, 'utf8');

    const requiredHeadings = ['## Goal', '## Scope', '## Success Criteria'];
    const missingHeadings = requiredHeadings.filter((heading) => !new RegExp(`^${heading}\\s*$`, 'm').test(missionBody));
    assert.deepEqual(
      missingHeadings,
      [],
      `[parallix-workflow-failure] real custom-agent draft output is not parseable: missing headings ${missingHeadings.join(', ')}`
    );

    // Verify no placeholder markers remain (TASK-1273: catch phantom drafts
    // that leave unfilled scaffold). The scaffold contains markers like <Title>,
    // <Goal>, <Scope>, etc. that must be replaced with real content.
    // Check this BEFORE the hello-world assertion so we detect phantom drafts
    // regardless of whether the task description matches.
    const placeholderMarkers = ['<Title>', '<Goal>', '<Scope>', '<Success Criteria>', '<Description>', '<Acceptance Criteria>'];
    const foundPlaceholders = placeholderMarkers.filter((marker) => missionBody.includes(marker));
    assert.deepEqual(
      foundPlaceholders,
      [],
      `[parallix-workflow-failure] draft left placeholder markers (phantom draft): ${foundPlaceholders.join(', ')}`
    );

    // Verify the task description is the representative hello-world shell
    // program. Case/separator-insensitive: the drafting model may render it
    // as "Hello World", "Hello, World!", "hello-world", or "hello_world".
    assert.match(
      missionBody,
      /hello[\s,_-]*world/i,
      '[parallix-workflow-failure] expected MISSION.md to contain hello-world task description'
    );

    // SC5: telemetry/session metadata must be structurally sane (a real
    // provider/model/numeric shape). Parse the draft stats line to verify
    // the agent actually did work (non-zero tokens or tool calls).
    const statsMatch = draftResult.stdout.match(
      /Draft stats recorded: \S+ stage=draft provider=(\S+) model=(\S+) input_tokens=(\d+) tool_calls=(\d+)/
    );
    assert.ok(statsMatch, '[parallix-workflow-failure] expected a structurally sane draft-stats line for the custom launcher path');
    console.log(`[benchmark] runner=${runner} phase=draft duration_ms=${draftDurationMs} provider=${statsMatch[1]} model=${statsMatch[2]} input_tokens=${statsMatch[3]} tool_calls=${statsMatch[4]}`);

    // Verify the draft reported non-zero tool calls.
    // For the draft phase, the agent MUST use tools to edit files and create mission
    // artifacts. Text-only responses (streamed tokens but zero tool calls) indicate
    // a phantom draft where the model failed to use the required tools (TASK-1273 class).
    // We also verify non-zero input tokens as a sanity check on the launcher connection.
    const inputTokens = parseInt(statsMatch[3], 10);
    const toolCalls = parseInt(statsMatch[4], 10);
    assert.ok(
      inputTokens > 0,
      `[parallix-workflow-failure] draft reported zero input tokens (launcher may not be connected): input_tokens=${inputTokens}`
    );
    assert.ok(
      toolCalls > 0,
      `[parallix-workflow-failure] draft reported zero tool calls (phantom draft - model streamed text but did not use tools): input_tokens=${inputTokens} tool_calls=${toolCalls}`
    );
    // opencode's own telemetry export reports the bare model id without the
    // provider prefix (e.g. "cyankiwi/..." not "vllm/cyankiwi/..."), so match
    // on the suffix rather than the full pinned launcher argument. With no
    // pinned CUSTOM_MODEL override, only assert a model name was recorded at
    // all (the launcher must report whatever default model it actually used).
    if (CUSTOM_MODEL) {
      assert.ok(
        CUSTOM_MODEL.endsWith(statsMatch[2]),
        `draft stats model "${statsMatch[2]}" should correspond to the repo-configured custom model "${CUSTOM_MODEL}"`
      );
    } else {
      assert.ok(statsMatch[2] && statsMatch[2].length > 0, '[parallix-workflow-failure] draft stats reported an empty model name');
    }

    // Verify telemetry isolation: check that stats.csv file exists in isolated PARALLIX_HOME
    const statsFile = path.join(repo.stateHome, 'stats.csv');
    assert.ok(fs.existsSync(statsFile), '[parallix-workflow-failure] expected stats.csv file in isolated PARALLIX_HOME at ' + statsFile);
    const statsContent = fs.readFileSync(statsFile, 'utf8');
    
    // Verify stats CSV contains expected content (headers and data)
    assert.ok(statsContent.includes('mission'), '[parallix-workflow-failure] expected stats.csv to contain mission column');
    assert.ok(statsContent.includes('stage'), '[parallix-workflow-failure] expected stats.csv to contain stage column');
    assert.ok(statsContent.includes('model'), '[parallix-workflow-failure] expected stats.csv to contain model column');
    assert.ok(statsContent.includes('draft'), '[parallix-workflow-failure] expected stats.csv to contain draft stage');
    if (CUSTOM_MODEL) {
      const modelBaseName = CUSTOM_MODEL.split('/').pop();
      assert.ok(statsContent.includes(modelBaseName), `[parallix-workflow-failure] expected stats.csv to contain the repo-configured custom model (${modelBaseName})`);
    }

    // Verify no writes escaped to the developer's default Parallix state
    // roots. Delta-based: only lines ADDED since the pre-run snapshot count as
    // leakage, so ambient rows from earlier manual runs of the same throwaway
    // scenario (same slug) or concurrent real px sessions cannot false-flag
    // the gate. resolveParallixHome (lib/core/storage.ts) falls back to
    // ~/.local/state/parallix on Linux and ~/.parallix elsewhere.
    for (const defaultHome of DEFAULT_PARALLIX_HOMES) {
      const defaultStatsFile = path.join(defaultHome, 'stats.csv');
      const before = defaultStateSnapshots.get(defaultStatsFile) || '';
      const after = fs.existsSync(defaultStatsFile) ? fs.readFileSync(defaultStatsFile, 'utf8') : '';
      const beforeLines = new Set(before.split('\n'));
      const addedSmokeLines = after.split('\n')
        .filter((line) => !beforeLines.has(line))
        .filter((line) => line.includes(slug) || line.includes('real-agent-smoke'));
      assert.deepEqual(
        addedSmokeLines,
        [],
        `[parallix-workflow-failure] telemetry isolation violated: this run added smoke-run rows to ${defaultStatsFile}: ${addedSmokeLines.join(' | ')}`
      );

      const defaultAgentsLocal = path.join(defaultHome, 'agents.local.json');
      const agentsBefore = defaultStateSnapshots.get(defaultAgentsLocal) || '';
      const agentsAfter = fs.existsSync(defaultAgentsLocal) ? fs.readFileSync(defaultAgentsLocal, 'utf8') : '';
      assert.equal(
        agentsAfter,
        agentsBefore,
        `[parallix-workflow-failure] agent blocking file isolation violated: this run modified ${defaultAgentsLocal}`
      );
    }

    // Operator refinement step: in the real workflow a human reviews the
    // drafted mission before activation. Small local models routinely write
    // prose instead of runnable commands in the `## Gates` checklist (e.g.
    // "- [ ] `bash hello.sh` outputs exactly `Hello, World!`"), and the
    // workflow executes declared gates literally at handoff. All launcher and
    // parseability assertions above ran against the RAW draft output; here the
    // harness performs the minimal refinement an operator would: pin the Gates
    // section to the repo's runnable verification gate, then commit.
    const refinedBody = missionBody.replace(
      /## Gates\n[\s\S]*?(?=\n## |$)/,
      '## Gates\n- [ ] ./scripts/verify-local.sh all\n'
    );
    assert.ok(
      refinedBody.includes('- [ ] ./scripts/verify-local.sh all'),
      '[parallix-workflow-failure] drafted MISSION.md has no ## Gates section to refine'
    );
    // A well-behaved agent can already emit this exact gate. In that case
    // there is no operator change to commit, and Git correctly rejects an
    // empty commit. Activation only requires the mission state to be
    // committed, which the draft phase has already done.
    if (refinedBody !== missionBody) {
      fs.writeFileSync(missionFile, refinedBody, 'utf8');
      runGit(worktree, ['add', path.relative(worktree, missionFile)]);
      runGit(worktree, ['commit', '-m', `refine(${slug}): pin mission gates to the repo verification gate`]);
    }

    // Phase 2: Active - this autostarts the autonomous review loop.
    // px active's preflight requires running from the mission worktree (PWD
    // and branch checks), matching how a real implementer session operates.
    const activeStartedAt = Date.now();
    const activeResult = runWorkflowAllowFail(worktree, env, ['active', slug, '--implementer', 'custom'], ACTIVE_TIMEOUT_MS);
    const activeDurationMs = Date.now() - activeStartedAt;
    assert.equal(
      activeResult.status,
      0,
      `[parallix-workflow-failure] px active --implementer custom failed (status=${activeResult.status}): ${activeResult.stderr || activeResult.stdout}`
    );

    assert.match(
      activeResult.stdout,
      /Execute agent \(custom\)/,
      '[parallix-workflow-failure] expected active phase to select the custom agent family'
    );
    console.log(`[benchmark] runner=${runner} phase=active duration_ms=${activeDurationMs}`);

    // px active autostarts the autonomous review loop - verify it completed successfully
    const reviewStateFile = path.join(worktree, 'missions', slug, 'review-state.json');
    assert.ok(fs.existsSync(reviewStateFile), `[parallix-workflow-failure] expected review-state.json after active phase (review loop should have completed) at ${reviewStateFile}`);
    const reviewState = JSON.parse(fs.readFileSync(reviewStateFile, 'utf8'));
    
    // Reviewer forcing (SC: "force custom as reviewer on its own PR"): the
    // isolated PARALLIX_HOME's agents.local.json blocks every family except
    // `custom`, so startReviewLoop's selection cannot find a different-family
    // reviewer and must take its single-family fallback — assigning `custom`
    // as the reviewer of its own PR. This is asserted strictly: any other
    // reviewer means either the blocklist stopped being honored or reviewer
    // selection regressed (and could silently launch an expensive agent).
    assert.equal(
      reviewState.reviewer,
      'custom',
      `[parallix-workflow-failure] expected reviewer forced to "custom" via agents.local.json blocklist (got: "${reviewState.reviewer}")`
    );
    
    // Verify review loop completed with APPROVED disposition (if Parallix cannot create a hello-world program, we have a problem)
    assert.deepEqual(
      reviewState.disposition,
      'APPROVED',
      `[parallix-workflow-failure] expected review loop to complete with APPROVED disposition (got: "${reviewState.disposition}")`
    );
    
    // Verify review phase reached approved state
    assert.deepEqual(
      reviewState.phase,
      'approved',
      `[parallix-workflow-failure] expected review phase to reach "approved" (got: "${reviewState.phase}")`
    );

    // Verify review loop produced artifacts
    const reviewDir = path.join(worktree, 'missions', slug, 'review-events');
    assert.ok(fs.existsSync(reviewDir), `[parallix-workflow-failure] expected review-events directory after active phase (review loop should have completed) at ${reviewDir}`);
    const reviewFiles = fs.readdirSync(reviewDir);
    assert.ok(reviewFiles.length > 0, `[parallix-workflow-failure] expected at least one review event file in ${reviewDir}`);

    // Verify active phase artifacts
    const cp1File = path.join(worktree, 'missions', slug, 'CP-1.md');
    assert.ok(fs.existsSync(cp1File), `[parallix-workflow-failure] expected CP-1.md after active phase at ${cp1File}`);
    const cp1Content = fs.readFileSync(cp1File, 'utf8');
    assert.ok(cp1Content.includes('## Goal Check') || cp1Content.includes('## Goal Check Table'),
      '[parallix-workflow-failure] expected CP-1.md to contain Goal Check heading');

  } finally {
    if (!shouldKeepTmp()) {
      fs.rmSync(repo.tmpRoot, { recursive: true, force: true });
      fs.rmSync(worktree, { recursive: true, force: true });
    }
  }
}

// Runner selection: one full lifecycle per gate run, with whichever runner
// this repository currently configures (adapters.agents.runners.custom).
// Running both runners back-to-back doubles the gate's wall time, so the
// non-configured runner is exercised on demand instead:
//   PARALLIX_REAL_AGENT_RUNNER=pi node test/e2e-real-agent-smoke.test.js
// The whole harness above stays runner-parameterized (preflight, healthcheck,
// repo setup), so switching costs an env var, not a code change.
const SUPPORTED_RUNNERS = ['opencode', 'pi'];
const CONFIGURED_RUNNER = process.env.PARALLIX_REAL_AGENT_RUNNER
  || workflowConfig?.adapters?.agents?.runners?.custom
  || 'opencode';

test(`real custom-agent launcher smoke (${CONFIGURED_RUNNER}): full lifecycle with hello-world task (SC3/SC4/SC5/SC6/SC7)`, () => {
  assert.ok(
    SUPPORTED_RUNNERS.includes(CONFIGURED_RUNNER),
    `Unknown custom runner "${CONFIGURED_RUNNER}" (from PARALLIX_REAL_AGENT_RUNNER or adapters.agents.runners.custom); expected one of: ${SUPPORTED_RUNNERS.join(', ')}`
  );
  runRealAgentSmoke(CONFIGURED_RUNNER);
});
