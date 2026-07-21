
'use strict';

// Reproduction for task-1416: Codex and Mistral launches that exit with
// status 1 but carry a family-specific success signal (real telemetry
// showing tokens were actually consumed) are misclassified as launch
// failures by startAgent()'s generic non-zero-exit check. That drives the
// run into the reroute/blocklist path instead of being accepted as a
// completed run, mirroring the false-autoblock bug already fixed for
// opencode via isSpuriousOpencodeExit() (lib/agents/opencode.ts).
//
// Both cases below construct a real telemetry side effect exactly the way
// the production launcher reads it:
//   - codex: a rollout-*.jsonl under <worktree>/.workflow/codex-home/.codex/sessions
//     with a real token_count event (read by extractCodexTelemetry).
//   - mistral: a session meta.json under $HOME/.vibe/logs/session with a real
//     stats block (read by extractMistralTelemetry / parseMistralMeta).
// HOME is redirected to a per-test tmp dir before requiring the mistral
// modules so the mistral case never touches the real user home directory.

const os = require('os');
const fs = require('fs');
const path = require('path');

const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'task-1416-home-'));
const previousHome = process.env.HOME;
process.env.HOME = tmpHome;

const test = require('node:test');
const assert = require('node:assert/strict');
process.env.NO_COLOR = '1';

const { startAgent, setCommandPathProbe } = require('../dist/lib/agents/agents');
if (previousHome === undefined) delete process.env.HOME;
else process.env.HOME = previousHome;

const sharedLauncherBin = fs.mkdtempSync(path.join(os.tmpdir(), 'task-1416-launchers-'));
for (const name of ['codex', 'claude', 'opencode', 'vibe']) {
  const launcherPath = path.join(sharedLauncherBin, name);
  fs.writeFileSync(launcherPath, `#!${process.execPath}\nprocess.exit(0);\n`);
  fs.chmodSync(launcherPath, 0o755);
}

function withSharedLaunchers(run) {
  const previousPath = process.env.PATH;
  process.env.PATH = `${sharedLauncherBin}${path.delimiter}${previousPath}`;
  setCommandPathProbe(name => fs.existsSync(path.join(sharedLauncherBin, name)));
  const cleanup = () => {
    process.env.PATH = previousPath;
    setCommandPathProbe(null);
  };
  try {
    const result = run();
    if (result && typeof result.then === 'function') {
      return result.finally(cleanup);
    }
    cleanup();
    return result;
  } catch (error) {
    cleanup();
    throw error;
  }
}

test.after(() => {
  setCommandPathProbe(null);
  fs.rmSync(sharedLauncherBin, { recursive: true, force: true });
  fs.rmSync(tmpHome, { recursive: true, force: true });
});

function withPathLaunchers(entries, run) {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'task-1416-path-'));
  const binDir = path.join(tmpRoot, 'bin');
  fs.mkdirSync(binDir, { recursive: true });
  for (const [name, body] of Object.entries(entries)) {
    const file = path.join(binDir, name);
    fs.writeFileSync(file, `#!${process.execPath}\n${body}\n`);
    fs.chmodSync(file, 0o755);
  }

  const previousPath = process.env.PATH;
  process.env.PATH = `${binDir}${path.delimiter}${previousPath}`;
  const cleanup = () => {
    process.env.PATH = previousPath;
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  };
  return run().finally(cleanup);
}

const fakeSessions = {
  shouldResume: () => false,
  getSessionId: () => null,
  writeSession: () => true
};

test('codex exit 1 with real rollout telemetry is misclassified as a launch failure', async () => {
  const worktree = fs.mkdtempSync(path.join(os.tmpdir(), 'task-1416-codex-wt-'));
  let blockCalls = [];
  const fakeBlockFn = (agent, until) => {
    blockCalls.push({ agent, until });
    return { path: '/fake/agents.local.json', blocklist: {} };
  };

  // A real Codex rollout JSONL: session_meta + a token_count event carrying
  // non-zero usage, exactly what extractCodexTelemetry (lib/agents/codex-telemetry.ts)
  // parses off disk. The fake binary writes this then exits 1, simulating a
  // completed turn followed by a non-zero exit on cleanup.
  const codexScript = `
    if (process.argv.includes('--help')) { process.exit(0); }
    const fs = require('fs');
    const path = require('path');
    const dir = path.join(process.cwd(), '.workflow', 'codex-home', '.codex', 'sessions', '2026', '07', '04');
    fs.mkdirSync(dir, { recursive: true });
    const lines = [
      JSON.stringify({ type: 'session_meta', payload: { id: 'sess-1416', model_provider: 'openai', model: 'gpt-5.4' } }),
      JSON.stringify({ type: 'event_msg', payload: { type: 'token_count', info: { total_token_usage: { input_tokens: 100, output_tokens: 50, cached_input_tokens: 0, reasoning_output_tokens: 0, total_tokens: 150 } } } })
    ];
    fs.writeFileSync(path.join(dir, 'rollout-1416.jsonl'), lines.join('\\n') + '\\n');
    process.stdout.write('To continue this session, run codex resume sess-1416\\n');
    process.exit(1);
  `;

  let attempts = 0;
  const result = await withSharedLaunchers(() => withPathLaunchers({ codex: codexScript }, () => startAgent('draft', {
    prompt: 'Execute.',
    worktree,
    assertAgentSupportedFn: () => {},
    isAgentBlockedFn: () => false,
    sessionsModule: fakeSessions,
    selectAgentFn: (step, opts) => {
      attempts += 1;
      if (!opts.exclude.has('codex')) {return 'codex';}
      throw new Error('All eligible agents exhausted for step "draft"');
    },
    detectLimitHitFn: () => null,
    updateAgentBlockFn: fakeBlockFn,
    log: () => {}
  })));

  fs.rmSync(worktree, { recursive: true, force: true });

  // GREEN after the fix: the rollout proves the codex turn actually
  // consumed tokens, so startAgent must accept the run instead of
  // rerouting away from codex or writing a blocklist entry (SC 2).
  assert.equal(result.agent, 'codex', 'codex should be accepted as successful despite exit 1 given valid telemetry');
  assert.equal(attempts, 1, 'codex must not be rerouted away from');
  assert.deepEqual(blockCalls, [], 'codex must not be blocklisted for a spurious exit-1 with valid telemetry');
});

test('mistral exit 1 with real session telemetry is misclassified as a launch failure', async () => {
  const worktree = fs.mkdtempSync(path.join(os.tmpdir(), 'task-1416-mistral-wt-'));
  let blockCalls = [];
  const fakeBlockFn = (agent, until) => {
    blockCalls.push({ agent, until });
    return { path: '/fake/agents.local.json', blocklist: {} };
  };

  // A real Vibe session meta.json under the worktree-scoped VIBE_HOME that the
  // launcher now provisions, exactly what processResult/parseMistralMeta reads
  // off disk. Non-zero stats prove the session actually ran a turn.
  const sessionDir = path.join(worktree, '.workflow', 'vibe-home', 'logs', 'session', 'session_20260704_000000_task1416');
  fs.mkdirSync(sessionDir, { recursive: true });
  fs.writeFileSync(path.join(sessionDir, 'meta.json'), JSON.stringify({
    start_time: new Date().toISOString(),
    stats: {
      session_prompt_tokens: 200,
      session_completion_tokens: 80,
      session_total_llm_tokens: 280,
      session_cost: 0.01
    }
  }));

  // Fake vibe binary: exits 1 with a generic error after the (pre-seeded)
  // session telemetry has already been written, simulating a completed
  // Vibe run followed by a non-zero exit.
  const vibeScript = `
    if (process.argv.includes('--help')) { process.exit(0); }
    const fs = require('fs');
    const path = require('path');
    const sessionDir = path.join(process.cwd(), '.workflow', 'vibe-home', 'logs', 'session', 'session_20260704_000000_task1416');
    fs.mkdirSync(sessionDir, { recursive: true });
    fs.writeFileSync(path.join(sessionDir, 'meta.json'), JSON.stringify({
      start_time: new Date().toISOString(),
      stats: {
        session_prompt_tokens: 200,
        session_completion_tokens: 80,
        session_total_llm_tokens: 280,
        session_cost: 0.01
      }
    }));
    process.stderr.write('vibe: non-zero exit after completion\\n');
    process.exit(1);
  `;

  let attempts = 0;
  const result = await withSharedLaunchers(() => withPathLaunchers({ vibe: vibeScript }, () => startAgent('draft', {
    prompt: 'Execute.',
    worktree,
    assertAgentSupportedFn: () => {},
    isAgentBlockedFn: () => false,
    sessionsModule: fakeSessions,
    selectAgentFn: (step, opts) => {
      attempts += 1;
      if (!opts.exclude.has('vibe')) {return 'vibe';}
      throw new Error('All eligible agents exhausted for step "draft"');
    },
    detectLimitHitFn: () => null,
    updateAgentBlockFn: fakeBlockFn,
    log: () => {}
  })));

  fs.rmSync(worktree, { recursive: true, force: true });

  // GREEN after the fix: the session meta.json proves the mistral/vibe turn
  // actually consumed tokens, so startAgent must accept the run instead of
  // rerouting away from vibe or writing a blocklist entry (SC 3).
  assert.equal(result.agent, 'vibe', 'vibe should be accepted as successful despite exit 1 given valid telemetry');
  assert.equal(attempts, 1, 'vibe must not be rerouted away from');
  assert.deepEqual(blockCalls, [], 'vibe must not be blocklisted for a spurious exit-1 with valid telemetry');
});

// SC 4 (codex): a genuine codex failure — exit 1 with no rollout telemetry at
// all — must still reroute to the next eligible agent and persist a
// blocklist entry exactly as before. Proves the new isSpuriousCodexExit gate
// does not swallow real failures.
test('codex exit 1 with no telemetry still reroutes and blocklists (real-failure path unchanged)', async () => {
  const worktree = fs.mkdtempSync(path.join(os.tmpdir(), 'task-1416-codex-real-fail-'));
  let blockCalls = [];
  const fakeBlockFn = (agent, until) => {
    blockCalls.push({ agent, until });
    return { path: '/fake/agents.local.json', blocklist: {} };
  };

  const codexScript = `
    if (process.argv.includes('--help')) { process.exit(0); }
    process.exit(1);
  `;

  const result = await withSharedLaunchers(() => withPathLaunchers({ codex: codexScript }, () => startAgent('draft', {
    prompt: 'Execute.',
    worktree,
    assertAgentSupportedFn: () => {},
    isAgentBlockedFn: () => false,
    sessionsModule: fakeSessions,
    selectAgentFn: (step, opts) => {
      if (!opts.exclude.has('codex')) {return 'codex';}
      return 'vibe';
    },
    detectLimitHitFn: () => null,
    updateAgentBlockFn: fakeBlockFn,
    log: () => {}
  })));

  fs.rmSync(worktree, { recursive: true, force: true });

  assert.equal(result.agent, 'vibe', 'a real codex failure (no telemetry) must still reroute to the next agent');
  assert.ok(blockCalls.some(c => c.agent === 'codex'), `expected a codex blocklist entry for a genuine failure; got ${JSON.stringify(blockCalls)}`);
});

// SC 4 (mistral): a genuine mistral failure — exit 1 with only a *stale*
// session meta.json on disk (written well before this invocation started,
// simulating leftover telemetry from an earlier, unrelated run against the
// same shared log directory) — must still reroute and blocklist. Proves the
// telemetryFresh guard (lib/agents/mistral.ts) rejects old telemetry instead
// of treating any nearby session as proof this run succeeded.
test('mistral exit 1 with only stale telemetry still reroutes and blocklists (real-failure path unchanged)', async () => {
  const worktree = fs.mkdtempSync(path.join(os.tmpdir(), 'task-1416-mistral-real-fail-'));
  let blockCalls = [];
  const fakeBlockFn = (agent, until) => {
    blockCalls.push({ agent, until });
    return { path: '/fake/agents.local.json', blocklist: {} };
  };

  const staleSessionDir = path.join(worktree, '.workflow', 'vibe-home', 'logs', 'session', 'session_20260704_010000_stale0000');
  fs.mkdirSync(staleSessionDir, { recursive: true });
  const staleMetaPath = path.join(staleSessionDir, 'meta.json');
  fs.writeFileSync(staleMetaPath, JSON.stringify({
    start_time: new Date().toISOString(),
    stats: {
      session_prompt_tokens: 500,
      session_completion_tokens: 300,
      session_total_llm_tokens: 800,
      session_cost: 0.02
    }
  }));
  // Back-date the file's mtime well before this test's invocation so the
  // telemetryFresh check (mtime >= invocationStart - 1s) rejects it.
  const staleTime = new Date(Date.now() - 10 * 60 * 1000);
  fs.utimesSync(staleMetaPath, staleTime, staleTime);

  const vibeScript = `
    if (process.argv.includes('--help')) { process.exit(0); }
    process.stderr.write('vibe: real failure\\n');
    process.exit(1);
  `;

  const result = await withSharedLaunchers(() => withPathLaunchers({ vibe: vibeScript }, () => startAgent('draft', {
    prompt: 'Execute.',
    worktree,
    assertAgentSupportedFn: () => {},
    isAgentBlockedFn: () => false,
    sessionsModule: fakeSessions,
    selectAgentFn: (step, opts) => {
      if (!opts.exclude.has('vibe')) {return 'vibe';}
      return 'codex';
    },
    detectLimitHitFn: () => null,
    updateAgentBlockFn: fakeBlockFn,
    log: () => {}
  })));

  fs.rmSync(worktree, { recursive: true, force: true });

  assert.equal(result.agent, 'codex', 'a real vibe failure with only stale telemetry must still reroute');
  assert.ok(blockCalls.some(c => c.agent === 'vibe'), `expected a vibe blocklist entry for a genuine failure; got ${JSON.stringify(blockCalls)}`);
});
