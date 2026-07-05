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
// This gate requires a workstation with `opencode` on PATH and the pinned
// local model below configured and reachable. See docs/real-agent-smoke.md
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

// Pinned local-model configuration for the `custom` agent family (SC5/mission
// "Pin the real-agent path to one explicit local-model configuration").
// Keep in sync with this repo's own workflow.config.json
// adapters.agents.models.custom — the throwaway repo below sets this value
// explicitly rather than copying the real config, so the smoke test stays
// reproducible even if this repo's own model pin changes independently.
const PINNED_CUSTOM_MODEL = 'vllm/cyankiwi/Qwen3.6-35B-A3B-AWQ-4bit';
const RUN_TIMEOUT_MS = Number(process.env.PARALLIX_REAL_AGENT_TIMEOUT_MS || 600000);

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
function preflightCheck() {
  const opencodePath = maybeOpencodePath();
  if (!opencodePath) {
    return 'opencode binary not found on PATH. Install opencode and configure the pinned local model before running this gate.';
  }
  return null;
}

function setupRepository({ slug, title }) {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'parallix-real-agent-'));
  const repoRoot = path.join(tmpRoot, 'repo');
  const binDir = path.join(repoRoot, 'bin');
  const stateHome = path.join(tmpRoot, 'parallix-home');
  const reviewTmpDir = path.join(tmpRoot, 'review-artifacts');
  const xdgDataHome = path.join(tmpRoot, 'xdg-data');

  fs.mkdirSync(path.join(repoRoot, 'backlog', 'tasks'), { recursive: true });
  fs.mkdirSync(path.join(repoRoot, 'config'), { recursive: true });
  fs.mkdirSync(binDir, { recursive: true });
  fs.mkdirSync(reviewTmpDir, { recursive: true });
  fs.mkdirSync(xdgDataHome, { recursive: true });

  // Real launcher on PATH — unlike test/e2e-mission-lifecycle.test.js, no
  // scripted stub is installed here (SC3: the production launch path must
  // actually be reached).
  fs.symlinkSync(requireCommandPath('opencode', maybeOpencodePath), path.join(binDir, 'opencode'));
  fs.symlinkSync(process.execPath, path.join(binDir, 'node'));
  fs.symlinkSync(requireCommandPath('git'), path.join(binDir, 'git'));
  fs.symlinkSync(requireCommandPath('bash'), path.join(binDir, 'bash'));
  fs.symlinkSync(requireCommandPath('id'), path.join(binDir, 'id'));

  fs.writeFileSync(path.join(repoRoot, 'workflow.config.json'), JSON.stringify({
    product: { name: 'real-agent-smoke', targetUser: 'tests' },
    adapters: {
      tasks: { provider: 'backlog-md', storage: 'backlog', stateMap: 'config/state-map.json' },
      agents: { models: { custom: PINNED_CUSTOM_MODEL } },
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
    'Launcher smoke probe (not a real feature request): draft a small, plausible mission contract for adding a tiny greeting helper function.',
    ''
  ].join('\n'), 'utf8');

  runGit(repoRoot, ['init', '-b', 'main']);
  runGit(repoRoot, ['config', 'user.email', 'test@example.com']);
  runGit(repoRoot, ['config', 'user.name', 'Parallix Real-Agent Smoke']);
  runGit(repoRoot, ['add', '.']);
  runGit(repoRoot, ['commit', '-m', 'initial smoke repo']);

  return { tmpRoot, repoRoot, binDir, stateHome, xdgDataHome };
}

function runWorkflowAllowFail(repoRoot, env, args, timeout) {
  const stdoutPath = path.join(os.tmpdir(), `parallix-real-agent-stdout-${process.pid}-${Date.now()}.log`);
  const stderrPath = path.join(os.tmpdir(), `parallix-real-agent-stderr-${process.pid}-${Date.now()}.log`);
  const stdoutFd = fs.openSync(stdoutPath, 'w');
  const stderrFd = fs.openSync(stderrPath, 'w');
  let result;
  try {
    result = childProcess.spawnSync(process.execPath, [CLI_ENTRY, ...args], {
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

test('real custom-agent launcher smoke: opencode draft produces a parseable MISSION.md (SC3/SC4/SC5/SC6/SC7)', () => {
  const preflightError = preflightCheck();
  if (preflightError) {
    assert.fail(
      `[local-model-environment] Cannot run the real custom-agent smoke test: ${preflightError}\n` +
      'This blocking gate requires a workstation with opencode installed and the pinned local model ' +
      `(${PINNED_CUSTOM_MODEL}) configured and reachable. See docs/real-agent-smoke.md.`
    );
  }

  const slug = 'task-9001';
  const repo = setupRepository({ slug, title: 'Real Agent Launcher Smoke' });
  const worktree = path.resolve(repo.repoRoot, '..', `${path.basename(repo.repoRoot)}-${slug}`);
  const env = {
    ...process.env,
    FORCE_COLOR: '0',
    FORGEJO_USER: 'custom',
    PRIMARY_WORKTREE: repo.repoRoot,
    PARALLIX_HOME: repo.stateHome,
    XDG_DATA_HOME: repo.xdgDataHome,
    PATH: repo.binDir
  };

  try {
    const result = runWorkflowAllowFail(repo.repoRoot, env, ['draft', slug, '--agent', 'custom'], RUN_TIMEOUT_MS);

    if (result.status !== 0) {
      const { bucket, detail } = classifyFailure(result);
      assert.fail(
        `[${bucket}] px draft --agent custom failed (status=${result.status}, signal=${result.signal}): ${detail}\n` +
        `stdout:\n${result.stdout}\nstderr:\n${result.stderr}`
      );
    }

    assert.match(
      result.stdout,
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

    // SC5: telemetry/session metadata must be structurally sane (a real
    // provider/model/numeric shape), without requiring non-zero token counts
    // (the custom/vLLM telemetry surface may honestly report zeros).
    const statsMatch = result.stdout.match(
      /Draft stats recorded: \S+ stage=draft provider=(\S+) model=(\S+) input_tokens=(\d+) tool_calls=(\d+)/
    );
    assert.ok(statsMatch, '[parallix-workflow-failure] expected a structurally sane draft-stats line for the custom launcher path');
    // opencode's own telemetry export reports the bare model id without the
    // provider prefix (e.g. "cyankiwi/..." not "vllm/cyankiwi/..."), so match
    // on the suffix rather than the full pinned launcher argument.
    assert.ok(
      PINNED_CUSTOM_MODEL.endsWith(statsMatch[2]),
      `draft stats model "${statsMatch[2]}" should correspond to the pinned local-model configuration "${PINNED_CUSTOM_MODEL}"`
    );
  } finally {
    if (!shouldKeepTmp()) {
      fs.rmSync(repo.tmpRoot, { recursive: true, force: true });
      fs.rmSync(worktree, { recursive: true, force: true });
    }
  }
});
