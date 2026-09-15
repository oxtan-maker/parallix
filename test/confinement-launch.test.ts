import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as fmt from '../src/application/presentation/cli-format.js';
import { setBubblewrapProbeForTest } from '../src/adapters/process/bubblewrap.js';
import { ConfinementBlockedError } from '../src/adapters/process/confinement.js';
import { __setSpawnAndTeeForTest } from '../src/adapters/agents/qwen.js';

/**
 * Launch-level coverage for the task-2513 confinement gate. These exercise the
 * real `startAgent` policy branch (not the pure decision function): a mutating
 * launch with Bubblewrap missing must block, must proceed on explicit consent,
 * and must proceed natively for a family that supports native sandboxing.
 */

function makeWorktree(): string {
  // A non-git temp dir: resolveGitMetadataMounts returns [] for a non-repo, so
  // the profile resolves without spawning git and the confinement gate is the
  // only policy under test.
  return fs.mkdtempSync(path.join(os.tmpdir(), 'confinement-launch-'));
}

function fakeLauncher(command = 'claude') {
  return () => ({
    invocation: { command, args: [], options: {} },
    resultPromise: Promise.resolve({ status: 0, stdout: '', stderr: '' })
  });
}

function startAgentForTest() {
  return import('../src/adapters/agents/agents.js').then(({ startAgent }) => startAgent);
}

// The CI job sets PARALLIX_NO_BUBBLEWRAP=1; these tests exercise the gate itself.
test.beforeEach(() => {
  delete process.env.PARALLIX_NO_BUBBLEWRAP;
});

test.afterEach(() => {
  setBubblewrapProbeForTest(null);
  delete process.env.PARALLIX_NO_BUBBLEWRAP;
});

// SC 3 (blocked): a mutating launch with no Bubblewrap and no native sandbox is
// blocked until an operator explicitly consents.
test('startAgent blocks a mutating launch when Bubblewrap is missing and no native sandbox exists', async () => {
  const worktree = makeWorktree();
  setBubblewrapProbeForTest(() => false);
  try {
    const startAgent = await startAgentForTest();
    await assert.rejects(
      () =>
        startAgent('active', {
          prompt: 'Execute',
          worktree,
          agent: 'claude',
          selectAgentFn: () => 'claude',
          isAgentBlockedFn: () => false,
          detectLimitHitFn: () => null,
          log: () => {}
        }),
      (err: unknown) => {
        assert.ok(err instanceof ConfinementBlockedError, `expected ConfinementBlockedError, got ${err}`);
        assert.equal((err as { code: string }).code, 'CONFINEMENT_BLOCKED');
        return true;
      }
    );
  } finally {
    fs.rmSync(worktree, { recursive: true, force: true });
  }
});

// SC 3 (consented): the same launch proceeds once the operator explicitly
// consents to unsandboxed execution through the command/workflow interface.
test('startAgent proceeds on explicit allowUnsandboxedMutation consent when Bubblewrap is missing', async () => {
  const worktree = makeWorktree();
  setBubblewrapProbeForTest(() => false);
  try {
    const startAgent = await startAgentForTest();
    const result = await startAgent('active', {
      prompt: 'Execute',
      worktree,
      agent: 'claude',
      selectAgentFn: () => 'claude',
      isAgentBlockedFn: () => false,
      detectLimitHitFn: () => null,
      allowUnsandboxedMutation: true,
      launchAgentFn: fakeLauncher(),
      log: () => {}
    });
    assert.equal(result.agent, 'claude');
    assert.equal(result.invocation.command, 'claude');
  } finally {
    fs.rmSync(worktree, { recursive: true, force: true });
  }
});

// SC 2: with Bubblewrap missing, a family that supports native sandboxing takes
// the native path (proceeds without consent) rather than blocking. The contrast
// with the claude block test above is what proves the native path is
// family-gated: claude blocks, codex proceeds natively, no consent needed.
test('startAgent takes the native-sandbox path for codex when Bubblewrap is missing without consent', async () => {
  const worktree = makeWorktree();
  setBubblewrapProbeForTest(() => false);
  try {
    const startAgent = await startAgentForTest();
    const result = await startAgent('active', {
      prompt: 'Execute',
      worktree,
      agent: 'codex',
      selectAgentFn: () => 'codex',
      isAgentBlockedFn: () => false,
      detectLimitHitFn: () => null,
      launchAgentFn: fakeLauncher('codex'),
      log: () => {}
    });
    assert.equal(result.agent, 'codex');
    assert.equal(result.invocation.command, 'codex');
  } finally {
    fs.rmSync(worktree, { recursive: true, force: true });
  }
});

// SC 2 (real argv): with Bubblewrap missing, the real qwen launcher must emit
// its native `-s` flag. This pins NATIVE_SANDBOX_AGENTS membership to an
// observable argv rather than merely a proceed-without-block, so a regression
// that drops qwen from the policy is caught here, not by the codex-only test.
test('startAgent passes qwen native -s flag when Bubblewrap is missing', async () => {
  const worktree = makeWorktree();
  setBubblewrapProbeForTest(() => false);
  const captured: { args?: string[] } = {};
  __setSpawnAndTeeForTest((cmd: string, args: string[]) => {
    captured.args = args;
    return Promise.resolve({ status: 0, stdout: '', stderr: '' });
  });
  try {
    const startAgent = await startAgentForTest();
    const result = await startAgent('active', {
      prompt: 'Execute',
      worktree,
      agent: 'qwen',
      selectAgentFn: () => 'qwen',
      isAgentBlockedFn: () => false,
      detectLimitHitFn: () => null,
      log: () => {}
    });
    assert.equal(result.agent, 'qwen');
    assert.ok(captured.args, 'the real qwen launcher must have been invoked');
    assert.ok(captured.args!.includes('-s'), 'qwen launch must carry its native -s sandbox flag');
  } finally {
    __setSpawnAndTeeForTest(null);
    delete process.env.PARALLIX_NO_BUBBLEWRAP;
    fs.rmSync(worktree, { recursive: true, force: true });
  }
});

// SC 5 (non-mutating unchanged): a review launch never hits the gate, so it
// proceeds even with Bubblewrap missing and no consent.
test('startAgent review launch is unaffected by the confinement gate when Bubblewrap is missing', async () => {
  const worktree = makeWorktree();
  setBubblewrapProbeForTest(() => false);
  try {
    const startAgent = await startAgentForTest();
    const result = await startAgent('review', {
      prompt: 'Review',
      worktree,
      agent: 'claude',
      selectAgentFn: () => 'claude',
      isAgentBlockedFn: () => false,
      detectLimitHitFn: () => null,
      launchAgentFn: fakeLauncher(),
      log: () => {}
    });
    assert.equal(result.agent, 'claude');
  } finally {
    fs.rmSync(worktree, { recursive: true, force: true });
  }
});

// SC 3 (consented warning): a mutating launch that runs unsandboxed on explicit
// operator consent must surface an explicit UNSANDBOXED warning — the only place
// that warning is emitted. Native-sandbox launches must not.
test('startAgent emits an UNSANDBOXED warning only on the unsandboxed-consent path', async () => {
  const worktree = makeWorktree();
  setBubblewrapProbeForTest(() => false);
  const captured: string[] = [];
  const previous = fmt.setLogger({
    log: (t: string) => { captured.push(t); return t; },
    error: (t: string) => { captured.push(t); return t; }
  });
  try {
    const startAgent = await startAgentForTest();
    const result = await startAgent('active', {
      prompt: 'Execute',
      worktree,
      agent: 'claude',
      selectAgentFn: () => 'claude',
      isAgentBlockedFn: () => false,
      detectLimitHitFn: () => null,
      allowUnsandboxedMutation: true,
      launchAgentFn: fakeLauncher(),
      log: () => {}
    });
    assert.equal(result.agent, 'claude');
    assert.ok(
      captured.some(l => /UNSANDBOXED/.test(l)),
      'an unsandboxed-consent launch must emit an UNSANDBOXED warning'
    );
  } finally {
    fmt.setLogger(previous);
    delete process.env.PARALLIX_NO_BUBBLEWRAP;
    fs.rmSync(worktree, { recursive: true, force: true });
  }
});

// SC 2 (no false alarm): a native-sandbox launch must NOT emit an UNSANDBOXED
// warning, proving the warning moved off the availability probe.
test('startAgent does not emit an UNSANDBOXED warning on the native-sandbox path', async () => {
  const worktree = makeWorktree();
  setBubblewrapProbeForTest(() => false);
  const captured: string[] = [];
  const previous = fmt.setLogger({
    log: (t: string) => { captured.push(t); return t; },
    error: (t: string) => { captured.push(t); return t; }
  });
  try {
    const startAgent = await startAgentForTest();
    const result = await startAgent('active', {
      prompt: 'Execute',
      worktree,
      agent: 'qwen',
      selectAgentFn: () => 'qwen',
      isAgentBlockedFn: () => false,
      detectLimitHitFn: () => null,
      launchAgentFn: fakeLauncher(),
      log: () => {}
    });
    assert.equal(result.agent, 'qwen');
    assert.ok(
      !captured.some(l => /UNSANDBOXED/.test(l)),
      'a native-sandbox launch must not emit an UNSANDBOXED warning'
    );
  } finally {
    fmt.setLogger(previous);
    delete process.env.PARALLIX_NO_BUBBLEWRAP;
    fs.rmSync(worktree, { recursive: true, force: true });
  }
});

// The PARALLIX_NO_BUBBLEWRAP opt-out is read from process.env by both the gate
// and the spawn seam; the gate must not only consult the caller-supplied child env.
test('startAgent honors PARALLIX_NO_BUBBLEWRAP from process.env when Bubblewrap is missing', async () => {
  const worktree = makeWorktree();
  setBubblewrapProbeForTest(() => false);
  process.env.PARALLIX_NO_BUBBLEWRAP = '1';
  try {
    const startAgent = await startAgentForTest();
    const result = await startAgent('active', {
      prompt: 'Execute',
      worktree,
      agent: 'claude',
      selectAgentFn: () => 'claude',
      isAgentBlockedFn: () => false,
      detectLimitHitFn: () => null,
      launchAgentFn: fakeLauncher(),
      log: () => {}
    });
    assert.equal(result.agent, 'claude');
  } finally {
    fs.rmSync(worktree, { recursive: true, force: true });
  }
});
