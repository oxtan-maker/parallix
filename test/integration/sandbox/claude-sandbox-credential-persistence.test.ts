// TASK-2598 regression: a sandboxed Claude launch whose access token has
// expired must refresh it and leave the rotated, still-valid refresh token in
// the host ~/.claude/.credentials.json. Before the fix, ~/.claude stayed
// read-only apart from a single-file bind of `.credentials.json`, so the
// Claude CLI could neither take its refresh lock nor stage the temp file of its
// atomic save; the host kept an expired token and every launch hit the 401.
//
// Runs the real `bwrap` binary against the claude-family sandbox profile with a
// stand-in CLI that follows the verified credential-save mechanism.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { claudeCredentialsPath } from '../../../src/adapters/config/state-homes.js';
import { buildBubblewrapArgs, resolveSandboxProfile } from '../../../src/adapters/process/bubblewrap.js';
import {
  createFakeOAuthServer,
  readCredentials,
  runSandboxed,
  writeExpiredCredentials,
  writeFakeClaude,
} from '../../lib/claude-credential-fixture.js';

test('task-2598: sandboxed claude refresh leaves the rotated refresh token in the host credentials', () => {
  const previous = { HOME: process.env.HOME, PARALLIX_HOME: process.env.PARALLIX_HOME };
  // The home sits outside /tmp: the profile's /tmp bind would otherwise make
  // ~/.claude writable and hide the defect.
  const root = path.join(process.cwd(), '.workflow');
  fs.mkdirSync(root, { recursive: true });
  const home = fs.mkdtempSync(path.join(root, 'task-2598-home-'));
  const worktree = fs.mkdtempSync(path.join(os.tmpdir(), 'task-2598-worktree-'));
  process.env.HOME = home;
  process.env.PARALLIX_HOME = path.join(home, 'parallix-state');
  try {
    writeExpiredCredentials(claudeCredentialsPath());
    const server = createFakeOAuthServer(path.join(worktree, 'oauth'));
    const claude = writeFakeClaude(path.join(worktree, 'bin'));
    const profile = resolveSandboxProfile('execute', worktree, null, 'claude');
    const run = runSandboxed(buildBubblewrapArgs(profile, worktree), claude, {
      ...process.env, HOME: home, FAKE_OAUTH_SERVER_DIR: server.dir, CLAUDE_CODE_OAUTH_TOKEN: '',
    });
    assert.equal(run.status, 0, `sandboxed claude failed: ${run.stderr}`);
    const host = readCredentials(claudeCredentialsPath());
    assert.equal(server.state().revoked, false, 'the refresh must not revoke the token family');
    assert.equal(host.refreshToken, server.state().valid, 'host credentials hold the rotated, valid refresh token');
    assert.ok(host.expiresAt > Date.now(), 'host access token is no longer expired');
  } finally {
    if (previous.HOME === undefined) { delete process.env.HOME; } else { process.env.HOME = previous.HOME; }
    if (previous.PARALLIX_HOME === undefined) { delete process.env.PARALLIX_HOME; } else { process.env.PARALLIX_HOME = previous.PARALLIX_HOME; }
    fs.rmSync(home, { recursive: true, force: true });
    fs.rmSync(worktree, { recursive: true, force: true });
  }
});
