// TASK-2598: every Claude-family lifecycle launch sees ~/.claude through the
// Parallix config cell. Runs the real `bwrap` binary with the stand-in Claude
// CLI from test/lib/claude-credential-fixture.ts, which follows the verified
// refresh-lock and atomic-save behaviour of the shipped CLI.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { startAgent, shouldPersistLaunchFailureBlock } from '../../../src/adapters/agents/agents.js';
import {
  claudeConfigCellDir,
  claudeConfigDir,
  claudeCredentialsPath,
  claudeProjectDir,
  claudeProjectMemoryDir,
} from '../../../src/adapters/config/state-homes.js';
import { buildBubblewrapArgs, resolveSandboxProfile } from '../../../src/adapters/process/bubblewrap.js';
import {
  FIRST_REFRESH,
  readCredentials,
  runSandboxed,
  runSandboxedAsync,
  withSandboxHome,
  type SandboxHome,
} from '../../lib/claude-credential-fixture.js';

// Each lifecycle category and the startAgent step name that launches it.
const LIFECYCLE_STEPS: ReadonlyArray<[string, string]> = [
  ['implementer/draft', 'draft'],
  ['implementer/execute', 'execute'],
  ['review', 'review'],
  ['fix/rework', 'act-on-review'],
  ['integration/preflight', 'conflict-resolution'],
  ['smoke', 'smoke'],
];

function sandboxArgs(fixture: SandboxHome, step: string): string[] {
  const profile = resolveSandboxProfile(step, fixture.worktree, step === 'review' ? fixture.artifactDir : null, 'claude');
  return buildBubblewrapArgs(profile, fixture.worktree);
}

function claudeEnv(fixture: SandboxHome, extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return { ...process.env, HOME: fixture.home, FAKE_OAUTH_SERVER_DIR: fixture.server.dir, CLAUDE_CODE_OAUTH_TOKEN: '', ...extra };
}

for (const [category, step] of LIFECYCLE_STEPS) {
  test(`task-2598: ${category} sandbox profile persists a valid rotated Claude credential`, async () => {
    await withSandboxHome(fixture => {
      const run = runSandboxed(sandboxArgs(fixture, step), fixture.claude, claudeEnv(fixture));
      assert.equal(run.status, 0, `${category} launch failed: ${run.stderr}`);
      assert.match(run.stdout, /^refreshed$/m);
      const host = readCredentials(claudeCredentialsPath());
      assert.equal(fixture.server.state().revoked, false);
      assert.equal(host.refreshToken, fixture.server.state().valid, `${category} leaves the rotated refresh token on the host`);
      assert.notEqual(host.refreshToken, FIRST_REFRESH);
      assert.ok(host.expiresAt > Date.now());
    });
  });
}

test('task-2598: concurrent sandboxed Claude refreshes rotate once and keep a usable credential', async () => {
  await withSandboxHome(async fixture => {
    const env = claudeEnv(fixture, { FAKE_OAUTH_LATENCY_MS: '300' });
    const runs = await Promise.all(['execute', 'review', 'act-on-review', 'conflict-resolution']
      .map(step => runSandboxedAsync(sandboxArgs(fixture, step), fixture.claude, env)));
    for (const run of runs) { assert.equal(run.status, 0, `a concurrent launch failed: ${run.stderr}`); }
    const server = fixture.server.state();
    assert.equal(server.revoked, false, 'no launch replayed a rotated refresh token');
    assert.equal(server.issued, 2, 'exactly one rotation for one expiry');
    assert.equal(readCredentials(claudeCredentialsPath()).refreshToken, server.valid);
    assert.equal(runs.filter(run => /^refreshed$/m.test(run.stdout)).length, 1);
  });
});

// Writes each target from inside the sandbox and reports 'written' or the error code.
function probeWrites(fixture: SandboxHome, args: string[], targets: string[]): Record<string, string> {
  const probe = path.join(fixture.artifactDir, 'probe.cjs');
  fs.writeFileSync(probe, `const fs = require('node:fs');
const path = require('node:path');
const results = {};
for (const target of process.argv.slice(2)) {
  try { fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, 'tampered'); results[target] = 'written'; }
  catch (err) { results[target] = err.code; }
}
process.stdout.write(JSON.stringify(results));
`);
  const run = runSandboxed(args, process.execPath, claudeEnv(fixture), [probe, ...targets]);
  assert.equal(run.status, 0, run.stderr);
  return JSON.parse(run.stdout);
}

test('task-2598: the sandbox writes no ~/.claude entry except the credential file', async () => {
  await withSandboxHome(fixture => {
    const claudeDir = claudeConfigDir();
    const memoryDir = claudeProjectMemoryDir(fixture.worktree);
    const guarded: Record<string, string> = {
      'settings.json': '{"hooks":{}}',
      'CLAUDE.md': '# operator instructions\n',
      'hooks/pre.sh': 'true\n',
      'skills/demo/SKILL.md': 'skill\n',
    };
    for (const [name, content] of Object.entries(guarded)) {
      fs.mkdirSync(path.dirname(path.join(claudeDir, name)), { recursive: true });
      fs.writeFileSync(path.join(claudeDir, name), content);
    }
    fs.mkdirSync(memoryDir, { recursive: true });
    fs.writeFileSync(path.join(memoryDir, 'MEMORY.md'), 'memory\n');
    // Profile resolution creates the granted session-env and transcript dirs.
    const args = sandboxArgs(fixture, 'execute');
    const before = fs.readdirSync(claudeDir).sort();
    const readOnlyTargets = [
      ...Object.keys(guarded).map(name => path.join(claudeDir, name)),
      path.join(claudeDir, 'skills', 'planted.md'),
      path.join(memoryDir, 'MEMORY.md'),
      path.join(memoryDir, 'planted.md'),
    ];
    const inert = path.join(claudeDir, 'scratch.txt');
    const outcome = probeWrites(fixture, args, [...readOnlyTargets, inert]);
    for (const target of readOnlyTargets) { assert.equal(outcome[target], 'EROFS', `${target} must stay read-only`); }
    for (const [name, content] of Object.entries(guarded)) {
      assert.equal(fs.readFileSync(path.join(claudeDir, name), 'utf8'), content, `${name} unchanged on the host`);
    }
    assert.equal(fs.readFileSync(path.join(memoryDir, 'MEMORY.md'), 'utf8'), 'memory\n');
    assert.deepEqual(fs.readdirSync(claudeDir).sort(), before, 'new entries land in the cell, not the host ~/.claude');
    // A name Claude does not read lands in the shared cell and does not outlive the next launch.
    assert.equal(outcome[inert], 'written');
    assert.ok(fs.existsSync(path.join(claudeConfigCellDir(), 'scratch.txt')));
    sandboxArgs(fixture, 'execute');
    assert.equal(fs.existsSync(path.join(claudeConfigCellDir(), 'scratch.txt')), false);
    assert.ok(fs.existsSync(claudeProjectDir(fixture.worktree)));
  });
});

test('task-2598: Claude configuration absent on the host stays read-only in the sandbox', async () => {
  await withSandboxHome(fixture => {
    const claudeDir = claudeConfigDir();
    const memoryDir = claudeProjectMemoryDir(fixture.worktree);
    const args = sandboxArgs(fixture, 'execute');
    const targets = [
      ...['settings.json', 'settings.local.json', 'CLAUDE.md', 'CLAUDE.local.md', 'keybindings.json']
        .map(name => path.join(claudeDir, name)),
      ...['agents', 'commands', 'hooks', 'output-styles', 'plugins', 'rules', 'skills']
        .map(name => path.join(claudeDir, name, 'planted.md')),
      path.join(memoryDir, 'MEMORY.md'),
    ];
    const outcome = probeWrites(fixture, args, targets);
    for (const target of targets) { assert.notEqual(outcome[target], 'written', `${target} must not be writable`); }
    for (const name of ['settings.json', 'CLAUDE.md', 'skills', 'hooks', 'agents']) {
      assert.equal(fs.existsSync(path.join(claudeDir, name)), false, `${name} is not created on the host`);
    }
    assert.deepEqual(fs.readdirSync(memoryDir), [], 'the absent memory dir is kept empty');
    // A second launch keeps the placeholders in place for a concurrent sandbox.
    const again = probeWrites(fixture, sandboxArgs(fixture, 'execute'), targets);
    for (const target of targets) { assert.notEqual(again[target], 'written', `${target} must stay read-only on relaunch`); }
  });
});

test('task-2598: CLAUDE_CODE_OAUTH_TOKEN launches bypass the refresh and leave stored credentials untouched', async () => {
  await withSandboxHome(fixture => {
    const before = fs.readFileSync(claudeCredentialsPath(), 'utf8');
    const run = runSandboxed(sandboxArgs(fixture, 'execute'), fixture.claude, claudeEnv(fixture, { CLAUDE_CODE_OAUTH_TOKEN: 'setup-token-value' }));
    assert.equal(run.status, 0, run.stderr);
    assert.match(run.stdout, /^setup-token$/m);
    assert.equal(fs.readFileSync(claudeCredentialsPath(), 'utf8'), before);
    assert.equal(fixture.server.state().issued, 1, 'the token endpoint is never called');
  });
});

test('task-2598: an unrefreshable Claude credential reports the refresh diagnostic without a family block', async () => {
  await withSandboxHome(async fixture => {
    fs.writeFileSync(path.join(fixture.server.dir, 'state.json'), JSON.stringify({ valid: null, issued: 1, revoked: true }));
    const before = fs.readFileSync(claudeCredentialsPath(), 'utf8');
    const logs: string[] = [];
    const blocks: unknown[] = [];
    let claudeResult: { status: number | null; stderr: string } | null = null;
    let calls = 0;
    const result = await startAgent('execute', {
      prompt: 'Execute.', worktree: fixture.worktree,
      selectAgentFn: () => calls++ === 0 ? 'claude' : 'vibe',
      detectLimitHitFn: () => null,
      updateAgentBlockFn: (...args: unknown[]) => { blocks.push(args); },
      launchAgentFn: () => ({
        invocation: { command: fixture.claude, args: [], options: {} },
        resultPromise: calls === 1
          ? runSandboxedAsync(sandboxArgs(fixture, 'execute'), fixture.claude, claudeEnv(fixture)).then(run => { claudeResult = run; return run; })
          : Promise.resolve({ status: 0, stdout: '' }),
      }),
      log: (line: string) => logs.push(line),
    } as never);
    assert.equal(result.agent, 'vibe');
    assert.ok(claudeResult, 'claude launched');
    assert.match(claudeResult!.stderr, /OAuth access token has expired/);
    assert.ok(logs.some(line => line.includes('claude') && line.includes('credentials need refreshing')));
    assert.equal(shouldPersistLaunchFailureBlock('claude', claudeResult!), false);
    assert.equal(blocks.length, 0, 'no family block is persisted');
    assert.equal(fs.readFileSync(claudeCredentialsPath(), 'utf8'), before, 'nothing half-written to the host credential');
  });
});
