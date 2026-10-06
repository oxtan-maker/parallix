// Historical regression provenance: TASK-2513, TASK-2383.
// Confinement contract: selectConfinement decisions, launch gating on missing Bubblewrap and
// operator consent, and the Bubblewrap argv/guard profile.
//
// Behavior-owned suite (TASK-2622.11). Legacy case names are unchanged; each section keeps its
// historical task provenance.
//   Confinement selection: no task ID in the legacy file
//   Confinement launch gating: task-2513 (SC 1-5)
//   Bubblewrap guard: task-2383 (review-profile launcher state homes)

import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { selectConfinement, supportsNativeSandbox, ConfinementBlockedError } from '../../../../src/adapters/process/confinement.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as fmt from '../../../../src/application/presentation/cli-format.js';
import { setBubblewrapProbeForTest, BUBBLEWRAP_COMMAND, BubblewrapGuardError, buildBubblewrapArgs, isBubblewrapAvailable, isBubblewrapDisabled, resolveSandboxProfile, withSandboxProfile, wrapWithBubblewrap } from '../../../../src/adapters/process/bubblewrap.js';
import { __setSpawnAndTeeForTest } from '../../../../src/adapters/agents/qwen.js';
import { mkdtemp as registeredMkdtemp, mkdtempAt } from '../../../helpers/temp-dir.js';
import childProcess from 'node:child_process';
import { childProcessDouble, type ChildProcessDouble } from '../../../fixtures/child-process-double.js';
import { Writable } from 'node:stream';
import { setImmediate } from 'node:timers';
import { spawnAndTee } from '../../../../src/adapters/process/spawn-tee.js';

describe('Confinement selection', () => {
  // selectConfinement: Bubblewrap is selected for a mutating launch when bwrap is
  // available (SC 1), with coverage for every other decision outcome.
  test('selectConfinement selects bubblewrap when available for a mutating launch', () => {
    assert.equal(
      selectConfinement({ mutating: true, bubblewrapAvailable: true, nativeSandboxSupported: false, operatorConsent: false }),
      'bubblewrap'
    );
  });

  test('selectConfinement selects native sandbox when bwrap missing but family supports it', () => {
    assert.equal(
      selectConfinement({ mutating: true, bubblewrapAvailable: false, nativeSandboxSupported: true, operatorConsent: false }),
      'native-sandbox'
    );
  });

  test('selectConfinement blocks when bwrap missing, no native sandbox, and no consent', () => {
    assert.equal(
      selectConfinement({ mutating: true, bubblewrapAvailable: false, nativeSandboxSupported: false, operatorConsent: false }),
      'blocked'
    );
  });

  test('selectConfinement allows unsandboxed execution only on explicit consent', () => {
    assert.equal(
      selectConfinement({ mutating: true, bubblewrapAvailable: false, nativeSandboxSupported: false, operatorConsent: true }),
      'unsandboxed-consented'
    );
    // Consent is not implicit: without it the same inputs block.
    assert.equal(
      selectConfinement({ mutating: true, bubblewrapAvailable: false, nativeSandboxSupported: false, operatorConsent: false }),
      'blocked'
    );
  });

  test('selectConfinement never gates a read-only (non-mutating) launch', () => {
    assert.equal(
      selectConfinement({ mutating: false, bubblewrapAvailable: false, nativeSandboxSupported: false, operatorConsent: false }),
      'bubblewrap'
    );
  });

  // supportsNativeSandbox: only families with a documented launch-layer sandbox
  // reports support (SC 2). Codex exposes --sandbox and qwen exposes -s/--sandbox;
  // the rest do not.
  test('supportsNativeSandbox reports true for codex and qwen', () => {
    assert.equal(supportsNativeSandbox('codex'), true);
    assert.equal(supportsNativeSandbox('qwen'), true);
    for (const family of ['claude', 'vibe', 'opencode', 'pi', 'custom', 'gemini']) {
      assert.equal(supportsNativeSandbox(family), false, `${family} must not claim native sandboxing`);
    }
    assert.equal(supportsNativeSandbox(null), false);
    assert.equal(supportsNativeSandbox(undefined), false);
  });

  // ConfinementBlockedError carries a machine-readable code so callers can
  // distinguish a deliberate block from a runtime launch failure.
  test('ConfinementBlockedError exposes the CONFINEMENT_BLOCKED code', () => {
    const error = new ConfinementBlockedError('claude', 'no confinement available');
    assert.equal(error.code, 'CONFINEMENT_BLOCKED');
    assert.equal(error.name, 'ConfinementBlockedError');
    assert.match(error.message, /cannot run unsandboxed/);
    assert.match(error.message, /Consent to unsandboxed execution explicitly/);
  });
});

describe("Confinement launch gating", () => {
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
    return registeredMkdtemp('confinement-launch-');
  }

  function fakeLauncher(command = 'claude') {
    return () => ({
      invocation: { command, args: [], options: {} },
      resultPromise: Promise.resolve({ status: 0, stdout: '', stderr: '' })
    });
  }

  function startAgentForTest() {
    return import('../../../../src/adapters/agents/agents.js').then(({ startAgent }) => startAgent);
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
});

describe("Bubblewrap guard", () => {
  test.afterEach(() => {
    setBubblewrapProbeForTest(null);
    delete process.env.PARALLIX_NO_BUBBLEWRAP;
  });

  function captureLogs<T>(fn: () => T): { result: T; lines: string[] } {
    const lines: string[] = [];
    const previous = fmt.setLogger({
      log: (...args: unknown[]) => lines.push(args.join(' ')),
      error: (...args: unknown[]) => lines.push(args.join(' '))
    });
    try {
      return { result: fn(), lines };
    } finally {
      fmt.setLogger(previous);
    }
  }

  function makeWorktree(): string { return registeredMkdtemp('bwrap-guard-'); }

  test('isBubblewrapAvailable returns true when bwrap is executable', () => {
    setBubblewrapProbeForTest(() => true);
    assert.equal(isBubblewrapAvailable(), true);
  });

  test('isBubblewrapAvailable caches the probe result after the first check', () => {
    let calls = 0;
    setBubblewrapProbeForTest(() => { calls += 1; return false; });
    isBubblewrapAvailable();
    isBubblewrapAvailable();
    isBubblewrapAvailable();
    assert.equal(calls, 1);
  });

  test('isBubblewrapAvailable is silent about unsandboxed state', () => {
    // The unsandboxed warning lives at the confinement gate's actual
    // unsandboxed-consent path (agents.ts), not in the availability probe, so a
    // native-sandbox or blocked launch does not emit a false alarm.
    setBubblewrapProbeForTest(() => false);
    const { lines } = captureLogs(() => {
      isBubblewrapAvailable();
      isBubblewrapAvailable();
    });
    const warnings = lines.filter(line => line.includes('UNSANDBOXED'));
    assert.equal(warnings.length, 0, 'the probe must not emit an UNSANDBOXED warning');
  });

  test('isBubblewrapDisabled honors PARALLIX_NO_BUBBLEWRAP', () => {
    assert.equal(isBubblewrapDisabled({}), false);
    assert.equal(isBubblewrapDisabled({ PARALLIX_NO_BUBBLEWRAP: '' }), false);
    assert.equal(isBubblewrapDisabled({ PARALLIX_NO_BUBBLEWRAP: '0' }), false);
    assert.equal(isBubblewrapDisabled({ PARALLIX_NO_BUBBLEWRAP: '1' }), true);
  });

  test('resolveSandboxProfile gives review a read-only worktree plus artifact dir and /tmp', () => {
    const profile = resolveSandboxProfile('review', '/work/tree', '/var/artifacts');
    assert.equal(profile.worktreeWritable, false);
    assert.deepEqual(profile.writable, ['/var/artifacts']);
    assert.deepEqual(profile.optionalWritable, ['/tmp']);
  });

  test('resolveSandboxProfile gives non-review steps a writable /tmp', () => {
    assert.deepEqual(resolveSandboxProfile('active', '/work/tree').optionalWritable, ['/tmp']);
  });

  test('resolveSandboxProfile fails closed when Git metadata resolution times out', () => {
    const worktree = makeWorktree();
    const mocked = test.mock.method(childProcess, 'spawnSync', (command: string) => {
      if (command === 'git') {
        return { status: null, stdout: '', stderr: '', error: new Error('ETIMEDOUT') } as any;
      }
      throw new Error(`unexpected command: ${command}`);
    });
    try {
      assert.throws(() => resolveSandboxProfile('active', worktree), BubblewrapGuardError);
    } finally { mocked.mock.restore(); fs.rmSync(worktree, { recursive: true, force: true }); }
  });

  // Review-profile launcher state homes (task-2383). The review profile must
  // grant each supported reviewer launcher its own state home while keeping the
  // mission worktree read-only. These fail at the mission parent commit because
  // the review writable set is only [artifactDir, /tmp].

  /**
   * Run `fn` with HOME pointing at a throwaway dir, so no test touches the
   * operator's home. The dir lives under the repo's git-ignored `.workflow/`
   * rather than `os.tmpdir()`: a home under `/tmp` would be swallowed by the
   * profile's optional `/tmp` bind and the writable-bind assertions would pass
   * without exercising the bind at all.
   */
  function withTempHome<T>(fn: (_home: string) => T): T {
    const previous = process.env.HOME;
    const root = path.join(process.cwd(), '.workflow');
    fs.mkdirSync(root, { recursive: true });
    const home = mkdtempAt(root, 'bwrap-home-');
    process.env.HOME = home;
    try { return fn(home); }
    finally {
      if (previous === undefined) { delete process.env.HOME; } else { process.env.HOME = previous; }
      fs.rmSync(home, { recursive: true, force: true });
    }
  }

  test('review profile grants each worktree-local launcher state home as a writable bind', () => {
    const worktree = makeWorktree();
    const artifactDir = makeWorktree();
    try {
      for (const family of ['codex', 'qwen', 'vibe'] as const) {
        const profile = resolveSandboxProfile('review', worktree, artifactDir, family);
        assert.equal(profile.worktreeWritable, false);
        const home = path.join(worktree, '.workflow', `${family}-home`);
        assert.ok(profile.optionalWritableDirectories?.includes(home), `${family} state home ${home} must be writable`);
        fs.mkdirSync(home, { recursive: true });
        assert.doesNotThrow(() => fs.accessSync(home, fs.constants.W_OK), `${family} state home must be writable on disk`);
      }
    } finally { fs.rmSync(worktree, { recursive: true, force: true }); fs.rmSync(artifactDir, { recursive: true, force: true }); }
  });

  test('review profile grants claude the transcript directory named after the mangled worktree path', () => {
    const worktree = makeWorktree();
    const artifactDir = makeWorktree();
    try {
      withTempHome(home => {
        const profile = resolveSandboxProfile('review', worktree, artifactDir, 'claude');
        // Claude names the directory after the working directory, not the slug:
        // /home/u/code/p -> -home-u-code-p.
        const mangled = path.resolve(worktree).replace(/[^A-Za-z0-9]/g, '-');
        const transcript = path.join(home, '.claude', 'projects', mangled);
        assert.ok(profile.optionalWritableDirectories?.includes(transcript), 'claude per-worktree transcript dir must be writable');
        assert.ok(!profile.optionalWritableDirectories?.some(dir => /projects\/task-/.test(dir)), 'transcript dir must not be derived from the mission slug');
      });
    } finally { fs.rmSync(worktree, { recursive: true, force: true }); fs.rmSync(artifactDir, { recursive: true, force: true }); }
  });

  test('review profile grants the custom family its configured runner state homes', () => {
    const worktree = makeWorktree();
    const artifactDir = makeWorktree();
    try {
      withTempHome(home => {
        const profile = resolveSandboxProfile('review', worktree, artifactDir, 'custom');
        // The default custom runner is opencode, which is host-home based.
        assert.ok(
          profile.optionalWritableDirectories?.includes(path.join(home, '.local', 'share', 'opencode')),
          `custom runner state home must be writable, got ${profile.optionalWritableDirectories?.join(', ')}`
        );
        assert.ok(
          !profile.optionalWritableDirectories?.some(dir => dir.includes('custom-home')),
          'custom must not bind a placeholder worktree directory no runner writes to'
        );
      });
    } finally { fs.rmSync(worktree, { recursive: true, force: true }); fs.rmSync(artifactDir, { recursive: true, force: true }); }
  });

  test('review profile keeps the reviewed worktree read-only and binds no reviewed source', () => {
    const worktree = makeWorktree();
    const artifactDir = makeWorktree();
    const reviewedSource = path.join(worktree, 'reviewed-source.md');
    fs.writeFileSync(reviewedSource, '# under review');
    try {
      const profile = resolveSandboxProfile('review', worktree, artifactDir, 'codex');
      const args = buildBubblewrapArgs(profile, worktree).join(' ');
      // Worktree stays read-only so no reviewed source/config/test/doc/mission
      // file inside it can be written.
      assert.ok(args.includes(`--ro-bind ${worktree} ${worktree}`), 'worktree must be read-only');
      // The reviewed source is inside the read-only worktree; it must never be
      // rebound writable as a standalone bind.
      assert.ok(!args.includes(`--bind ${reviewedSource} ${reviewedSource}`), 'reviewed source must not be bound writable');
      assert.ok(!profile.writable.includes(reviewedSource), 'reviewed source must not be a writable bind');
    } finally { fs.rmSync(worktree, { recursive: true, force: true }); fs.rmSync(artifactDir, { recursive: true, force: true }); }
  });

  test('buildBubblewrapArgs masks the tmux terminal state so an agent cannot reach any run session (TASK-2643)', () => {
    const worktree = makeWorktree();
    const stateRoot = path.join(makeWorktree(), 'terminal-state');
    const previous = process.env.PARALLIX_TERMINAL_STATE_DIR;
    process.env.PARALLIX_TERMINAL_STATE_DIR = stateRoot;
    try {
      const before = buildBubblewrapArgs(resolveSandboxProfile('active', worktree), worktree);
      assert.equal(before.includes('--tmpfs'), false, 'nothing to mask before any tmux launch');
      fs.mkdirSync(stateRoot, { recursive: true });
      const args = buildBubblewrapArgs(resolveSandboxProfile('active', worktree), worktree);
      const at = args.indexOf('--tmpfs');
      assert.equal(args[at + 1], stateRoot);
      assert.ok(at > args.lastIndexOf('--bind'), 'the mask is mounted after every writable bind');
    } finally {
      if (previous === undefined) { delete process.env.PARALLIX_TERMINAL_STATE_DIR; } else { process.env.PARALLIX_TERMINAL_STATE_DIR = previous; }
      fs.rmSync(worktree, { recursive: true, force: true });
      fs.rmSync(path.dirname(stateRoot), { recursive: true, force: true });
    }
  });

  test('buildBubblewrapArgs binds the worktree read-write for implementer steps', () => {
    const worktree = makeWorktree();
    try {
      const args = buildBubblewrapArgs(resolveSandboxProfile('active', worktree), worktree);
      assert.deepEqual(args.slice(0, 3), ['--ro-bind', '/', '/']);
      assert.ok(args.includes('--die-with-parent'));
      assert.ok(args.join(' ').includes(`--bind ${worktree} ${worktree}`));
      assert.deepEqual(args.slice(-3), ['--chdir', worktree, '--']);
    } finally { fs.rmSync(worktree, { recursive: true, force: true }); }
  });

  test('review profile buildBubblewrapArgs binds the claude transcript directory writable without widening the worktree', () => {
    const worktree = makeWorktree();
    const artifactDir = makeWorktree();
    try {
      withTempHome(home => {
        const profile = resolveSandboxProfile('review', worktree, artifactDir, 'claude');
        const args = buildBubblewrapArgs(profile, worktree).join(' ');
        const transcript = path.join(home, '.claude', 'projects', path.resolve(worktree).replace(/[^A-Za-z0-9]/g, '-'));
        assert.ok(args.includes(`--ro-bind ${worktree} ${worktree}`), 'worktree stays read-only');
        assert.ok(args.includes(`--bind ${transcript} ${transcript}`), 'claude transcript dir gets an explicit writable bind');
      });
    } finally { fs.rmSync(worktree, { recursive: true, force: true }); fs.rmSync(artifactDir, { recursive: true, force: true }); }
  });

  test('buildBubblewrapArgs keeps review worktree read-only and binds an outside artifact directory', () => {
    const worktree = makeWorktree();
    // This assertion specifically exercises the fixed /tmp bind, regardless
    // of the operator's TMPDIR setting.
    const artifactRoot = mkdtempAt('/tmp', 'bwrap-guard-');
    const artifactDir = path.join(artifactRoot, 'review-artifacts');
    try {
      const args = buildBubblewrapArgs(resolveSandboxProfile('review', worktree, artifactDir), worktree);
      assert.ok(args.join(' ').includes(`--ro-bind ${worktree} ${worktree}`));
      // This fixture lives under /tmp; the explicit /tmp permission already
      // authorizes it, so the builder correctly avoids a redundant nested bind.
      assert.ok(!args.join(' ').includes(`--bind ${artifactDir} ${artifactDir}`));
      assert.ok(args.join(' ').includes('--bind /tmp /tmp'));
      assert.equal(fs.statSync(artifactDir).isDirectory(), true);
    } finally { fs.rmSync(worktree, { recursive: true, force: true }); fs.rmSync(artifactRoot, { recursive: true, force: true }); }
  });

  test('buildBubblewrapArgs rejects an unusable permitted path without widening a bind', () => {
    const worktree = makeWorktree();
    const file = path.join(worktree, 'not-a-directory');
    fs.writeFileSync(file, 'x');
    try {
      assert.throws(() => buildBubblewrapArgs({ worktree, worktreeWritable: false, writable: [file] }, worktree), BubblewrapGuardError);
    } finally { fs.rmSync(worktree, { recursive: true, force: true }); }
  });

  test('buildBubblewrapArgs skips an unavailable launcher state directory', () => {
    const worktree = makeWorktree();
    const stateHome = path.join(worktree, 'unavailable-state');
    const mocked = test.mock.method(fs, 'mkdirSync', (dir: fs.PathLike) => {
      if (dir === stateHome) { throw new Error('EROFS'); }
      return undefined as any;
    });
    try {
      const { result, lines } = captureLogs(() => buildBubblewrapArgs({
        worktree, worktreeWritable: false, writable: [], optionalWritableDirectories: [stateHome]
      }, worktree));
      assert.ok(!result.includes(stateHome));
      assert.ok(lines.some(line => line.includes('launcher state is unavailable')));
    } finally { mocked.mock.restore(); fs.rmSync(worktree, { recursive: true, force: true }); }
  });

  test('wrapWithBubblewrap prefixes bwrap and preserves the original argv', () => {
    setBubblewrapProbeForTest(() => true);
    const worktree = makeWorktree();
    try {
      const wrapped = withSandboxProfile(
        resolveSandboxProfile('active', worktree),
        () => wrapWithBubblewrap('codex', ['exec', '--sandbox', 'danger-full-access'], worktree)
      );
      assert.equal(wrapped.command, BUBBLEWRAP_COMMAND);
      assert.deepEqual(wrapped.args.slice(-4), ['codex', 'exec', '--sandbox', 'danger-full-access']);
      assert.equal(wrapped.args[wrapped.args.indexOf('codex') - 1], '--');
    } finally { fs.rmSync(worktree, { recursive: true, force: true }); }
  });

  test('spawnAndTee preserves stdout and exit status through bwrap', async () => {
    setBubblewrapProbeForTest(() => true);
    const worktree = makeWorktree();
    const observed: { command: string; args: string[] }[] = [];
    const mocked = test.mock.method(childProcess, 'spawn', (command: string, args: string[]) => {
      observed.push({ command, args });
      return fakeChild();
    });
    try {
      const result = await withSandboxProfile(
        resolveSandboxProfile('active', worktree),
        () => spawnAndTee('codex', ['exec'], { cwd: worktree, stdoutSink: nullSink(), stderrSink: nullSink() })
      );
      assert.equal(observed[0].command, BUBBLEWRAP_COMMAND);
      assert.deepEqual(observed[0].args.slice(-2), ['codex', 'exec']);
      assert.equal(result.status, 0);
      assert.equal(result.signal, null);
      assert.equal(result.stdout, 'hello');
    } finally { mocked.mock.restore(); fs.rmSync(worktree, { recursive: true, force: true }); }
  });

  test('spawnAndTee fails before spawning when an available guard cannot be built', async () => {
    setBubblewrapProbeForTest(() => true);
    const observed: string[] = [];
    const mocked = test.mock.method(childProcess, 'spawn', (command: string) => {
      observed.push(command);
      return fakeChild();
    });
    try {
      await assert.rejects(
        () => withSandboxProfile(
          resolveSandboxProfile('active', '/nonexistent/worktree'),
          () => spawnAndTee('codex', ['exec'], { cwd: '/nonexistent/worktree' })
        ),
        BubblewrapGuardError
      );
      assert.deepEqual(observed, []);
    } finally { mocked.mock.restore(); }
  });

  function fakeChild(): ChildProcessDouble {
    const child = childProcessDouble();
    setImmediate(() => { child.stdout.emit('data', Buffer.from('hello')); child.emit('close', 0, null); });
    return child;
  }

  function nullSink(): NodeJS.WriteStream {
    return new Writable({ write(_chunk, _encoding, callback) { callback(); } }) as unknown as NodeJS.WriteStream;
  }
});
