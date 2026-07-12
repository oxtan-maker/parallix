'use strict';

// Regression test for task-2231: unit tests sometimes hang around the draft
// custom-agent launch coverage.
//
// Root cause: test/bootstrap-parallix-home.js shadows PATH with harmless fake
// launchers, but resolveOpencodeCommand() (lib/agents/opencode.ts) prefers the
// OPENCODE_BIN env var over PATH. When the operator's shell exports
// OPENCODE_BIN, the draft launch/retry unit tests bypass every PATH fake and
// start the operator's real opencode CLI — an expensive LLM run that can sit
// silent far longer than any unit test, so the suite appears to hang.
//
// This test reproduces that environment with controlled doubles only: the
// "expensive" CLI is a stand-in script that records every invocation and then
// sleeps, and the scenario is raced against an explicit completion bound. It
// is red on the mission parent commit (the scenario does not settle within
// the bound because the expensive stand-in gets launched) and green once the
// bootstrap harness neutralizes the *_BIN overrides.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');

// Explicit completion bound for the whole child scenario. The healthy path
// (fake opencode dies with SIGKILL after ~20ms, fake vibe exits 0) settles in
// well under a second; 10s keeps the bound slack for slow CI while still
// catching the multi-minute hang deterministically.
const REPRO_COMPLETION_BOUND_MS = 10_000;

// How long the expensive stand-in sleeps when launched. Long enough that the
// scenario can never settle within the bound if it is started, short enough
// that an orphaned stand-in from a red run self-terminates.
const EXPENSIVE_FAKE_RUNTIME_MS = 120_000;

const BOOTSTRAP_PATH = path.join(__dirname, 'bootstrap-parallix-home.js');
const AGENTS_MODULE_PATH = path.join(__dirname, '..', 'lib', 'agents', 'agents.js');

function writeLauncher(filePath, body) {
  fs.writeFileSync(filePath, `#!${process.execPath}\n${body}\n`);
  fs.chmodSync(filePath, 0o755);
}

test('draft custom-agent signal retry settles within its bound and never launches the OPENCODE_BIN override', async () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'task-2231-repro-'));
  let child = null;
  try {
    const worktree = path.join(tmpRoot, 'worktree');
    fs.mkdirSync(worktree);

    // Stand-in for the operator's real, expensive opencode CLI. Every
    // invocation is recorded; anything other than a --help probe sleeps far
    // past the completion bound (a real `opencode run` LLM session).
    const expensiveDir = path.join(tmpRoot, 'expensive');
    fs.mkdirSync(expensiveDir);
    const invokedMarkerPath = path.join(expensiveDir, 'invoked.log');
    const expensiveBinPath = path.join(expensiveDir, 'opencode');
    writeLauncher(expensiveBinPath, `
require('fs').appendFileSync(${JSON.stringify(invokedMarkerPath)}, process.argv.slice(2).join(' ') + '\\n');
if (process.argv.includes('--help')) process.exit(0);
setTimeout(() => process.exit(0), ${EXPENSIVE_FAKE_RUNTIME_MS});
`);

    // PATH doubles for the launch itself, mirroring the existing
    // "startAgent launch failure with signal retries next agent" scenario:
    // the first attempt (custom -> opencode) dies with SIGKILL and the retry
    // lands on vibe, which succeeds.
    const fakeBinDir = path.join(tmpRoot, 'bin');
    fs.mkdirSync(fakeBinDir);
    writeLauncher(path.join(fakeBinDir, 'opencode'),
      'if (process.argv.includes("--help")) process.exit(0); setTimeout(() => process.kill(process.pid, "SIGKILL"), 20);');
    writeLauncher(path.join(fakeBinDir, 'vibe'),
      'if (process.argv.includes("--help")) process.exit(0); process.exit(0);');

    // Child scenario: run the draft launch/retry under the repository test
    // bootstrap, exactly as `npm test` does, and report what happened.
    const scenarioPath = path.join(tmpRoot, 'scenario.js');
    fs.writeFileSync(scenarioPath, `'use strict';
const path = require('path');
process.env.PATH = ${JSON.stringify(fakeBinDir)} + path.delimiter + (process.env.PATH || '');
delete process.env.WORKFLOW_AGENT;

const { startAgent } = require(${JSON.stringify(AGENTS_MODULE_PATH)});

const log = [];
startAgent('draft', {
  prompt: 'Execute.',
  worktree: ${JSON.stringify(worktree)},
  selectAgentFn: (step, opts) => {
    if (!opts.exclude.has('custom')) return 'custom';
    return 'vibe';
  },
  detectLimitHitFn: () => null,
  updateAgentBlockFn: () => ({ path: 'noop' }),
  log: msg => log.push(msg),
}).then(result => {
  process.stdout.write('\\n' + JSON.stringify({
    agent: result.agent,
    sawSignalRetry: log.some(m => m.includes('custom') && m.includes('signal')),
  }) + '\\n');
  process.exit(0);
}).catch(err => {
  process.stderr.write(String((err && err.stack) || err) + '\\n');
  process.exit(1);
});
`);

    child = spawn(process.execPath, ['--require', BOOTSTRAP_PATH, scenarioPath], {
      cwd: path.join(__dirname, '..'),
      env: { ...process.env, OPENCODE_BIN: expensiveBinPath },
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: true,
    });

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });

    const childExit = new Promise(resolve => {
      child.on('close', (code, signal) => resolve({ timedOut: false, code, signal }));
    });
    let boundTimer = null;
    const boundExpired = new Promise(resolve => {
      boundTimer = setTimeout(() => resolve({ timedOut: true }), REPRO_COMPLETION_BOUND_MS);
    });

    const outcome = await Promise.race([childExit, boundExpired]);
    clearTimeout(boundTimer);

    assert.equal(outcome.timedOut, false,
      `draft signal-retry scenario did not settle within ${REPRO_COMPLETION_BOUND_MS}ms — ` +
      `an unmocked expensive launch is hanging the unit test. ` +
      `Recorded expensive-CLI invocations: ${fs.existsSync(invokedMarkerPath) ? fs.readFileSync(invokedMarkerPath, 'utf8').trim() : '(none)'}`);
    assert.equal(outcome.code, 0, `scenario child exited non-zero. stderr: ${stderr}`);

    const jsonLine = stdout.trim().split('\n').filter(Boolean).pop();
    const parsed = JSON.parse(jsonLine);
    assert.equal(parsed.agent, 'vibe', 'retry after the SIGKILL launch failure must land on the next eligible agent');
    assert.equal(parsed.sawSignalRetry, true, 'startAgent must log the signal-triggered retry for the custom agent');

    assert.equal(fs.existsSync(invokedMarkerPath), false,
      `the OPENCODE_BIN override must never reach unit-test launches; recorded invocations: ` +
      `${fs.existsSync(invokedMarkerPath) ? fs.readFileSync(invokedMarkerPath, 'utf8').trim() : '(none)'}`);
  } finally {
    // Kill the whole scenario process group so a red run cannot strand the
    // expensive stand-in (the grandchild) past the test.
    if (child && child.pid && child.exitCode === null && child.signalCode === null) {
      try { process.kill(-child.pid, 'SIGKILL'); } catch (_) { /* already gone */ }
    }
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});
