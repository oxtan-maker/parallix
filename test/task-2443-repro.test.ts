import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  claudeCredentialsPath,
  claudeProjectDir,
  claudeSessionEnvDir,
  codexAuthPath,
  opencodeStateHomes,
  piStateHomes,
} from '../src/adapters/config/state-homes.js';
import { buildBubblewrapArgs, resolveSandboxProfile } from '../src/adapters/process/bubblewrap.js';

function writableBinds(args: string[]): string[] {
  return args.flatMap((arg, index) => arg === '--bind' ? [args[index + 1]] : []);
}

function makeGitWorktree(): string {
  const worktree = fs.mkdtempSync(path.join(os.tmpdir(), 'task-2443-worktree-'));
  childProcess.execFileSync('git', ['init', '--quiet', worktree]);
  return worktree;
}

function withPinnedHomes<T>(fn: (worktree: string, home: string) => T): T {
  const previous = { HOME: process.env.HOME, CODEX_HOME: process.env.CODEX_HOME };
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'task-2443-home-'));
  const worktree = makeGitWorktree();
  process.env.HOME = home;
  process.env.CODEX_HOME = path.join(home, 'codex-state');
  fs.mkdirSync(path.dirname(claudeCredentialsPath()), { recursive: true });
  fs.writeFileSync(claudeCredentialsPath(), '{}');
  fs.mkdirSync(path.dirname(codexAuthPath()), { recursive: true });
  fs.writeFileSync(codexAuthPath(), '{}');
  try { return fn(worktree, home); }
  finally {
    if (previous.HOME === undefined) { delete process.env.HOME; } else { process.env.HOME = previous.HOME; }
    if (previous.CODEX_HOME === undefined) { delete process.env.CODEX_HOME; } else { process.env.CODEX_HOME = previous.CODEX_HOME; }
    fs.rmSync(home, { recursive: true, force: true });
    fs.rmSync(worktree, { recursive: true, force: true });
  }
}

function assertFamilyBinds(family: string, worktree: string, expected: string[]): void {
  const profile = resolveSandboxProfile('active', worktree, null, family);
  const args = buildBubblewrapArgs(profile, worktree);
  const binds = writableBinds(args);
  assert.deepEqual(args.slice(0, 3), ['--ro-bind', '/', '/']);
  for (const stateHome of expected) {
    assert.ok(profile.optionalWritableDirectories?.includes(stateHome) || profile.optionalWritableFiles?.includes(stateHome), `${family} must declare ${stateHome}`);
    assert.ok(binds.some(bind => stateHome === bind || stateHome.startsWith(bind + path.sep)), `${family} must write ${stateHome}; got ${binds.join(', ')}`);
  }
}

test('task-2443: active claude argv binds credentials, session env, and project state', () => {
  withPinnedHomes((worktree) => assertFamilyBinds('claude', worktree, [
    claudeCredentialsPath(), claudeSessionEnvDir(), claudeProjectDir(worktree),
  ]));
});

test('task-2443: active codex argv binds the configured host auth file', () => {
  withPinnedHomes((worktree) => assertFamilyBinds('codex', worktree, [codexAuthPath()]));
});

test('task-2443: active opencode argv binds only opencode state homes', () => {
  withPinnedHomes((worktree) => assertFamilyBinds('opencode', worktree, opencodeStateHomes()));
});

test('task-2443: active pi argv binds only pi state homes', () => {
  withPinnedHomes((worktree) => assertFamilyBinds('pi', worktree, piStateHomes()));
});

test('task-2443: active profiles do not cross-bind families or grant qwen/vibe host homes', () => {
  withPinnedHomes((worktree) => {
    const homes = (family: string) => {
      const profile = resolveSandboxProfile('active', worktree, null, family);
      return [...(profile.optionalWritableDirectories || []), ...(profile.optionalWritableFiles || [])];
    };
    const claude = homes('claude');
    const codex = homes('codex');
    assert.ok(!claude.includes(codexAuthPath()));
    assert.ok(!codex.includes(claudeSessionEnvDir()));
    for (const family of [homes('qwen'), homes('vibe')]) {
      assert.ok(!family.some(home => home.startsWith(os.homedir() + path.sep)));
    }
  });
});

test('task-2443: absent credential leaves are not created or bound', () => {
  withPinnedHomes((worktree) => {
    fs.rmSync(claudeCredentialsPath());
    fs.rmSync(codexAuthPath());
    const claudeProfile = resolveSandboxProfile('active', worktree, null, 'claude');
    const codexProfile = resolveSandboxProfile('active', worktree, null, 'codex');
    claudeProfile.optionalWritable = [];
    codexProfile.optionalWritable = [];
    const claude = writableBinds(buildBubblewrapArgs(claudeProfile, worktree));
    const codex = writableBinds(buildBubblewrapArgs(codexProfile, worktree));
    assert.ok(!claude.includes(claudeCredentialsPath()));
    assert.ok(!codex.includes(codexAuthPath()));
    assert.equal(fs.existsSync(claudeCredentialsPath()), false);
    assert.equal(fs.existsSync(codexAuthPath()), false);
  });
});
