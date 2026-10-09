// @ts-nocheck -- TASK-2328: partial test doubles from ESM seam migration; resolve in follow-up
import { resolveConfiguration } from '../../../../src/composition/config.js';
const environment: NodeJS.ProcessEnv = { ...process.env };
// Historical regression provenance: TASK-1322, TASK-2328, TASK-2209, TASK-2211, TASK-2266.
// Codex launcher contract: command/session parsing, draft invocation, CODEX_HOME isolation
// and operator config/auth/MCP linking.
//
// Behavior-owned suite (TASK-2622.11). Legacy case names are unchanged; each section keeps its
// historical task provenance.
//   Codex launcher basics: task-1322, TASK-2328
//   MCP config linked not copied: task-2209
//   Operator state isolation: task-2211, TASK-2328
//   Operator HOME retention: task-2266

import test, { describe, mock } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp as registeredMkdtemp } from '../../../helpers/temp-dir.js';
import { mockModule, installModuleMocks } from '../../../lib/module-mock.js';
const codexModule = mockModule<typeof import('../../../../src/adapters/agents/codex.js')>('../../../../src/adapters/agents/codex.js', import.meta.url);
await installModuleMocks();

describe("Codex launcher basics ,", () => {
  test.afterEach(() => mock.restoreAll());

  const codex = codexModule;

  // ---------- resolveCodexCommand ----------

  const { resolveCodexCommand } = codexModule;
  const { extractCodexSessionId } = codexModule;
  const { buildCodexDraftInvocation, codexStateRoot } = codexModule;
  const { codexHomeRoot } = codexModule;
  const { codexConfigPath } = codexModule;
  const { codexAuthPath } = codexModule;
  const { ensureCodexHome } = codexModule;

  test('resolveCodexCommand returns bare "codex"', () => {
    assert.equal(resolveCodexCommand(), 'codex');
  });

  // ---------- extractCodexSessionId ----------

  test('extractCodexSessionId matches codex resume pattern', () => {
    const id = extractCodexSessionId('Some text\ncodex resume abc123-def456\nend');
    assert.equal(id, 'abc123-def456');
  });

  test('extractCodexSessionId matches Session ID alt pattern', () => {
    const id = extractCodexSessionId('Session ID: abc123de-f456');
    assert.equal(id, 'abc123de-f456');
  });

  test('extractCodexSessionId alt pattern is case-insensitive', () => {
    const id = extractCodexSessionId('session id: abc123');
    assert.equal(id, 'abc123');
  });

  test('extractCodexSessionId returns null for no match', () => {
    assert.equal(extractCodexSessionId(null), null);
    assert.equal(extractCodexSessionId(''), null);
  });

  // ---------- buildCodexDraftInvocation ----------

  test('Codex template keeps approval policy at top level and project trust intact', () => {
    const template = fs.readFileSync(new URL('../../../../templates/codex/config.toml', import.meta.url), 'utf8');
    const firstTable = template.indexOf('[');
    assert.ok(firstTable >= 0);
    assert.match(template.slice(0, firstTable), /^approval_policy = "never"$/m);
    assert.match(template.slice(firstTable), /^\[projects\."\.\."\]\s*\ntrust_level = "trusted"$/m);
    assert.doesNotMatch(template.slice(firstTable), /approval_policy/);
  });

  test('headless Codex launches and resumes use top-level approval and project trust overrides', () => {
    const worktree = '/tmp/codex-config-regression/mission';
    for (const options of [{}, { resume: true }, { resume: true, sessionId: 'session-1' }]) {
      const invocation = buildCodexDraftInvocation({ configuration: resolveConfiguration(environment), prompt: 'config check', worktree, interactive: false, ...options });
      const overrides = invocation.args.filter((_, index) => invocation.args[index - 1] === '--config');
      assert.equal(overrides.filter(arg => arg === 'approval_policy="never"').length, 1);
      assert.ok(overrides.includes('projects."/tmp/codex-config-regression".trust_level="trusted"'));
      assert.ok(overrides.includes('projects."/tmp/codex-config-regression/mission".trust_level="trusted"'));
      assert.equal(overrides.some(arg => arg.includes('.approval_policy=')), false);
    }
  });

  test('buildCodexDraftInvocation leaves native sandboxing to Bubblewrap by default', () => {
    const inv = buildCodexDraftInvocation({ configuration: resolveConfiguration(environment), prompt: 'test', worktree: '/tmp', interactive: false });
    assert.equal(inv.command, 'codex');
    assert.ok(inv.args.includes('exec'));
    assert.equal(inv.args.includes('--sandbox'), false);
  });

  test('buildCodexDraftInvocation enables the native sandbox only as a fallback', () => {
    const inv = buildCodexDraftInvocation({ configuration: resolveConfiguration(environment), prompt: 'test', worktree: '/tmp', interactive: false, sandbox: true });
    assert.ok(inv.args.includes('--sandbox'));
    assert.ok(inv.args.includes('workspace-write'));
  });

  test('buildCodexDraftInvocation uses full-auto path when interactive is true', () => {
    const inv = buildCodexDraftInvocation({ configuration: resolveConfiguration(environment), prompt: 'test', worktree: '/tmp', interactive: true });
    assert.equal(inv.command, 'codex');
    assert.ok(inv.args.includes('--full-auto'));
    assert.ok(inv.args.includes('--cd'));
  });

  test('buildCodexDraftInvocation uses resume with sessionId', () => {
    const inv = buildCodexDraftInvocation({ configuration: resolveConfiguration(environment), prompt: 'test', worktree: '/tmp', resume: true, sessionId: 'abc123' });
    assert.ok(inv.args.includes('resume'));
    assert.ok(inv.args.includes('abc123'));
  });

  test('buildCodexDraftInvocation uses --last when resume is true but no sessionId', () => {
    const inv = buildCodexDraftInvocation({ configuration: resolveConfiguration(environment), prompt: 'test', worktree: '/tmp', resume: true, sessionId: null });
    assert.ok(inv.args.includes('--last'));
  });

  test('buildCodexDraftInvocation isolates CODEX_HOME for non-interactive launches', () => {
    const originalCodexHome = environment.CODEX_HOME;
    try {
      environment.CODEX_HOME = '/tmp/originating-codex-home';
      const inv = buildCodexDraftInvocation({ configuration: resolveConfiguration(environment), prompt: 'test', worktree: '/tmp', interactive: false });
      assert.equal(inv.options.env.CODEX_HOME, codexStateRoot('/tmp'));
    } finally {
      if (originalCodexHome === undefined) delete environment.CODEX_HOME;
      else environment.CODEX_HOME = originalCodexHome;
    }
  });

  // ---------- codex home helpers ----------

  test('codexHomeRoot returns the expected path', () => {
    assert.equal(codexHomeRoot('/tmp/worktree'), '/tmp/worktree/.workflow/codex-home');
  });

  test('codexConfigPath returns the expected path', () => {
    assert.ok(codexConfigPath('/tmp/worktree').includes('.codex/config.toml'));
  });

  test('codexAuthPath returns the expected path', () => {
    assert.ok(codexAuthPath('/tmp/worktree').includes('.codex/auth.json'));
  });

  test('buildCodexDraftInvocation applies headless multi-agent and trust overrides', () => {
    const inv = buildCodexDraftInvocation({ configuration: resolveConfiguration(environment), prompt: 'test', worktree: '/tmp/work"tree', interactive: false });
    assert.ok(inv.args.includes('features.multi_agent=true'));
    assert.ok(inv.args.includes('approval_policy="never"'));
    assert.ok(inv.args.some(arg => arg.includes('trust_level="trusted"')));
    assert.ok(inv.args.some(arg => arg.includes('\\"')));
  });

  test('ensureCodexHome completes without optional source config', () => {
    const fakeHome = registeredMkdtemp('codex-nohome-');
    const worktree = registeredMkdtemp('codex-wt2-');
    const origHome = environment.HOME;
    try {
      environment.HOME = fakeHome;
      ensureCodexHome(worktree, resolveConfiguration({ HOME: fakeHome }));
      assert.ok(!fs.existsSync(codexConfigPath(worktree)), 'mission setup must not write a Codex config');
    } finally {
      environment.HOME = origHome;
      fs.rmSync(fakeHome, { recursive: true, force: true });
      fs.rmSync(worktree, { recursive: true, force: true });
    }
  });

  // ---------- model override ----------

  test('buildCodexDraftInvocation adds -m flag when model is provided', () => {
    const inv = buildCodexDraftInvocation({ configuration: resolveConfiguration(environment), prompt: 'test', worktree: '/tmp', interactive: false, model: 'gpt-5.4-mini' });
    const i = inv.args.indexOf('-m');
    assert.ok(i !== -1);
    assert.equal(inv.args[i + 1], 'gpt-5.4-mini');
  });

  test('buildCodexDraftInvocation omits -m flag when model is null/undefined', () => {
    assert.ok(!buildCodexDraftInvocation({ configuration: resolveConfiguration(environment), prompt: 't', worktree: '/tmp', interactive: false }).args.includes('-m'));
    assert.ok(!buildCodexDraftInvocation({ configuration: resolveConfiguration(environment), prompt: 't', worktree: '/tmp', interactive: false, model: null }).args.includes('-m'));
  });

  test('buildCodexDraftInvocation adds -m flag on the resume path too', () => {
    const inv = buildCodexDraftInvocation({ configuration: resolveConfiguration(environment), prompt: 't', worktree: '/tmp', resume: true, sessionId: 'abc', model: 'gpt-5.4-mini' });
    assert.ok(inv.args.includes('-m'));
    assert.ok(inv.args.includes('gpt-5.4-mini'));
  });

  // ---------- startCodexDraftAgent stale session detection (task-1322) ----------

  test('startCodexDraftAgent retries without exec resume when spawn returns "Session not found"', async () => {
    const mockSessionPort = { deleted: null, async delete(missionId, role) { this.deleted = { missionId, role }; } };
    let spawnCount = 0;
    const mockSpawn = (cmd, args, opts) => {
      spawnCount++;
      if (spawnCount === 1) {
        return Promise.resolve({ status: 1, signal: null, stdout: '', stderr: 'Error: Session not found', error: null });
      }
      return Promise.resolve({ status: 0, signal: null, stdout: 'codex resume sess_fresh\n', stderr: '', error: null });
    };

    codex.__setSpawnAndTeeForTest(mockSpawn);
    codex.__setSessionPortForTest(mockSessionPort);

    const { invocation, resultPromise } = codex.startCodexDraftAgent({ configuration: resolveConfiguration(environment),
      prompt: 'review task', worktree: '/tmp/wt', env: {}, resume: true, sessionId: 'ses_stale', slug: 'task-1322', role: 'reviewer'
    });
    const result = await resultPromise;

    assert.equal(spawnCount, 2, 'must spawn twice: stale session then fresh');
    assert.ok(invocation.args.includes('resume'), 'original invocation must include resume');
    assert.deepEqual(mockSessionPort.deleted, { missionId: 'task-1322', role: 'reviewer' }, 'marker must be cleared through the port');
    assert.equal(result.status, 0, 'final result must show success');

    codex.__setSpawnAndTeeForTest(null);
    codex.__setSessionPortForTest(null);
  });

  test('startCodexDraftAgent does NOT retry when resume is false', async () => {
    let spawnCount = 0;
    const mockSpawn = (cmd, args, opts) => {
      spawnCount++;
      return Promise.resolve({ status: 1, signal: null, stdout: '', stderr: 'Session not found', error: null });
    };

    codex.__setSpawnAndTeeForTest(mockSpawn);

    const { resultPromise } = codex.startCodexDraftAgent({ configuration: resolveConfiguration(environment),
      prompt: 'test', worktree: '/tmp/wt', env: {}, resume: false, sessionId: null
    });
    const result = await resultPromise;

    assert.equal(spawnCount, 1, 'must NOT retry when resume=false');
    assert.equal(result.status, 1, 'must return the original failure');

    codex.__setSpawnAndTeeForTest(null);
  });

  test('startCodexDraftAgent places the fallback sandbox on exec before resume', async () => {
    let spawnCount = 0;
    const mockSpawn = (cmd, args, opts) => {
      spawnCount++;
      assert.deepEqual(args.slice(args.indexOf('exec'), args.indexOf('ses_valid') + 1), ['exec', '--sandbox', 'workspace-write', 'resume', 'ses_valid']);
      assert.ok(args.includes('ses_valid'), 'must include the session ID');
      return Promise.resolve({ status: 0, signal: null, stdout: 'codex resume ses_valid\n', stderr: '', error: null });
    };

    codex.__setSpawnAndTeeForTest(mockSpawn);

    const { invocation, resultPromise } = codex.startCodexDraftAgent({ configuration: resolveConfiguration(environment),
      prompt: 'test', worktree: '/tmp/wt', env: {}, resume: true, sessionId: 'ses_valid', sandbox: true
    });
    const result = await resultPromise;

    assert.equal(spawnCount, 1, 'must only spawn once for healthy resume');
    assert.equal(result.status, 0, 'must succeed');

    codex.__setSpawnAndTeeForTest(null);
  });
});

describe("Codex MCP config linked into worktree CODEX_HOME", () => {
  test.afterEach(() => mock.restoreAll());

  // Reproduction test for task-2209: codex fails on mcp
  //
  // The launcher must retain MCP configuration through a link rather than copy
  // its contents into the worktree-local Codex state directory.

  const { ensureCodexHome, codexConfigPath } = codexModule;

  test('MCP config is linked, not copied, into worktree codex-home (reproduction)', () => {

    const fakeHome = registeredMkdtemp('codex-mcp-repro-');
    const worktree = registeredMkdtemp('codex-mcp-wt-');
    const origHome = environment.HOME;

    try {
      // Simulate an operator's config without placing it in the worktree.
      const codexDir = path.join(fakeHome, '.codex');
      fs.mkdirSync(codexDir, { recursive: true });
      fs.writeFileSync(
        path.join(codexDir, 'config.toml'),
        [
          '[mcp]',
          'enabled = true',
          '',
          '[mcp.servers.slack]',
          'command = "npx"',
          'args = ["-y", "@slack/mcp-server"]',
          '',
          '[mcp.servers.datadog]',
          'command = "npx"',
          'args = ["-y", "@datadog/mcp"]',
          '',
        ].join('\n'),
        'utf8'
      );

      environment.HOME = fakeHome;
      ensureCodexHome(worktree, resolveConfiguration({ HOME: fakeHome }));

      assert.ok(fs.lstatSync(codexConfigPath(worktree)).isSymbolicLink(), 'mission setup must link, not copy, Codex config');
      assert.equal(fs.readlinkSync(codexConfigPath(worktree)), path.join(codexDir, 'config.toml'));
    } finally {
      environment.HOME = origHome;
      fs.rmSync(fakeHome, { recursive: true, force: true });
      fs.rmSync(worktree, { recursive: true, force: true });
    }
  });
});

describe("Codex operator-state isolation", () => {
  test.afterEach(() => mock.restoreAll());

  const { buildCodexDraftInvocation, codexStateRoot } = codexModule;
  const codex = codexModule;

  test('codex launcher keeps operator-home nested tool resolution while isolating Codex state', () => {
    const operatorHome = registeredMkdtemp('task-2211-operator-home-');
    const worktree = registeredMkdtemp('task-2211-worktree-');
    const originalHome = environment.HOME;

    try {
      const nestedTool = path.join(operatorHome, '.local', 'bin', 'opencode');
      fs.mkdirSync(path.dirname(nestedTool), { recursive: true });
      fs.writeFileSync(nestedTool, '#!/bin/sh\n', { mode: 0o755 });
      environment.HOME = operatorHome;

      const invocation = buildCodexDraftInvocation({ configuration: resolveConfiguration(environment), prompt: 'Execute.', worktree, interactive: false });
  // @ts-expect-error -- TASK-2328: partial test double after ESM seam migration
      const resolvedNestedTool = path.join(invocation.options.env.HOME, '.local', 'bin', 'opencode');

      assert.ok(fs.existsSync(resolvedNestedTool), 'a nested command must retain the operator HOME used to resolve its installation');
      assert.equal(invocation.options.env.CODEX_HOME, codexStateRoot(worktree), 'Codex-owned state must use the worktree-local Codex state directory');
    } finally {
      if (originalHome === undefined) delete environment.HOME;
      else environment.HOME = originalHome;
      fs.rmSync(operatorHome, { recursive: true, force: true });
      fs.rmSync(worktree, { recursive: true, force: true });
    }
  });

  test('Codex setup links operator config and auth without copying their contents', () => {
    const operatorHome = registeredMkdtemp('task-2211-state-operator-home-');
    const worktree = registeredMkdtemp('task-2211-state-worktree-');
    const originalHome = environment.HOME;
    const originalCodexHome = environment.CODEX_HOME;

    try {
      environment.HOME = operatorHome;
      const operatorCodexHome = path.join(operatorHome, '.codex');
      fs.mkdirSync(operatorCodexHome, { recursive: true });
      fs.writeFileSync(path.join(operatorCodexHome, 'config.toml'), '[mcp_servers.slack]\n');
      fs.writeFileSync(path.join(operatorCodexHome, 'auth.json'), '{"token":"test"}\n');
      environment.CODEX_HOME = operatorCodexHome;

      codex.ensureCodexHome(worktree, resolveConfiguration(environment));

      assert.ok(fs.lstatSync(codex.codexConfigPath(worktree)).isSymbolicLink(), 'config must be linked, not copied into the worktree');
      assert.ok(fs.lstatSync(codex.codexAuthPath(worktree)).isSymbolicLink(), 'auth must be linked, not copied into the worktree');
      assert.equal(fs.readlinkSync(codex.codexConfigPath(worktree)), path.join(operatorCodexHome, 'config.toml'));
      assert.equal(fs.readlinkSync(codex.codexAuthPath(worktree)), path.join(operatorCodexHome, 'auth.json'));
    } finally {
      if (originalHome === undefined) delete environment.HOME;
      else environment.HOME = originalHome;
      if (originalCodexHome === undefined) delete environment.CODEX_HOME;
      else environment.CODEX_HOME = originalCodexHome;
      fs.rmSync(operatorHome, { recursive: true, force: true });
      fs.rmSync(worktree, { recursive: true, force: true });
    }
  });
});

describe("Codex operator HOME retention", () => {
  test.afterEach(() => mock.restoreAll());

  test('codex launch keeps the operator HOME when caller env supplies a worktree HOME', () => {
    const operatorHome = registeredMkdtemp('task-2266-operator-home-');
    const callerHome = registeredMkdtemp('task-2266-caller-home-');
    const worktree = registeredMkdtemp('task-2266-worktree-');
    const originalHome = environment.HOME;

    try {
      const nestedTool = path.join(operatorHome, '.local', 'bin', 'opencode');
      fs.mkdirSync(path.dirname(nestedTool), { recursive: true });
      fs.writeFileSync(nestedTool, '#!/bin/sh\n', { mode: 0o755 });
      environment.HOME = operatorHome;

      for (const resume of [false, true]) {
        const invocation = codexModule.buildCodexDraftInvocation({ configuration: resolveConfiguration(environment),
          prompt: 'Execute.',
          worktree,
          interactive: false,
          env: { HOME: callerHome },
          resume
        });

        const launchEnv = invocation.options.env as NodeJS.ProcessEnv;
        assert.equal(launchEnv.HOME, operatorHome, 'caller env.HOME must not replace the operator HOME');
        assert.ok(
          fs.existsSync(path.join(launchEnv.HOME!, '.local', 'bin', 'opencode')),
          'the launched process must resolve an operator-installed nested tool'
        );
        assert.equal(invocation.options.env.CODEX_HOME, codexModule.codexStateRoot(worktree));
      }
    } finally {
      if (originalHome === undefined) delete environment.HOME;
      else environment.HOME = originalHome;
      fs.rmSync(operatorHome, { recursive: true, force: true });
      fs.rmSync(callerHome, { recursive: true, force: true });
      fs.rmSync(worktree, { recursive: true, force: true });
    }
  });

  test('Codex bootstrap reads operator state from process HOME when caller env supplies HOME', () => {
    const operatorHome = registeredMkdtemp('task-2266-bootstrap-operator-home-');
    const callerHome = registeredMkdtemp('task-2266-bootstrap-caller-home-');
    const worktree = registeredMkdtemp('task-2266-bootstrap-worktree-');
    const originalHome = environment.HOME;
    const originalCodexHome = environment.CODEX_HOME;

    try {
      const operatorConfig = path.join(operatorHome, '.codex', 'config.toml');
      fs.mkdirSync(path.dirname(operatorConfig), { recursive: true });
      fs.writeFileSync(operatorConfig, '[features]\nmulti_agent = true\n', 'utf8');
      environment.HOME = operatorHome;
      delete environment.CODEX_HOME;

      codexModule.ensureCodexHome(worktree, resolveConfiguration(environment));

      assert.equal(fs.readlinkSync(codexModule.codexConfigPath(worktree)), operatorConfig);
    } finally {
      if (originalHome === undefined) delete environment.HOME;
      else environment.HOME = originalHome;
      if (originalCodexHome === undefined) delete environment.CODEX_HOME;
      else environment.CODEX_HOME = originalCodexHome;
      fs.rmSync(operatorHome, { recursive: true, force: true });
      fs.rmSync(callerHome, { recursive: true, force: true });
      fs.rmSync(worktree, { recursive: true, force: true });
    }
  });
});
