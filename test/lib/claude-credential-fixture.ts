// Shared fixture for TASK-2598: a stand-in Claude CLI that refreshes an
// expired OAuth access token the way the real CLI (2.1.x) does, plus a fake
// token endpoint that rotates refresh tokens and revokes the token family on
// reuse, as the Anthropic OAuth server does.
//
// Modelled CLI behaviour (verified in the shipped binary, recorded in the
// TASK-2598 notes):
//   - refresh is serialised by a proper-lockfile directory lock at
//     `<config dir>/.oauth_refresh.lock`; failing to create it with anything
//     other than "already locked" aborts the refresh (`lock_error`);
//   - under the lock it re-reads `.credentials.json` and skips the refresh when
//     another process already rotated the access token;
//   - the save writes `<config dir>/.credentials.json.tmp.<8 hex>` and renames
//     it over `.credentials.json`; a rename failing with EXDEV/EPERM/EEXIST/EBUSY
//     falls back to an in-place write of the target, while a failure to create
//     the temp file fails the save and leaves the rotation in memory only.

import childProcess from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const EXPIRED_ACCESS = 'at-expired';
export const FIRST_REFRESH = 'rt-1';

export interface FakeOAuthServer { dir: string; state(): { valid: string | null; issued: number; revoked: boolean } }

/** Token endpoint state on disk so concurrent sandboxed children share it. */
export function createFakeOAuthServer(dir: string): FakeOAuthServer {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'state.json'), JSON.stringify({ valid: FIRST_REFRESH, issued: 1, revoked: false }));
  return { dir, state: () => JSON.parse(fs.readFileSync(path.join(dir, 'state.json'), 'utf8')) };
}

export function writeExpiredCredentials(credentialsPath: string): void {
  fs.mkdirSync(path.dirname(credentialsPath), { recursive: true });
  fs.writeFileSync(credentialsPath, JSON.stringify({
    claudeAiOauth: { accessToken: EXPIRED_ACCESS, refreshToken: FIRST_REFRESH, expiresAt: Date.now() - 60_000, scopes: ['user:inference'] }
  }), { mode: 0o600 });
}

export function readCredentials(credentialsPath: string): { accessToken: string; refreshToken: string; expiresAt: number } {
  return JSON.parse(fs.readFileSync(credentialsPath, 'utf8')).claudeAiOauth;
}

/** Write the stand-in `claude` executable into `binDir` and return its path. */
export function writeFakeClaude(binDir: string): string {
  const file = path.join(binDir, 'claude');
  fs.mkdirSync(binDir, { recursive: true });
  fs.writeFileSync(file, `#!${process.execPath}
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
const dir = path.join(process.env.HOME, '.claude');
const file = path.join(dir, '.credentials.json');
const lock = path.join(dir, '.oauth_refresh.lock');
const server = process.env.FAKE_OAUTH_SERVER_DIR;
const fail = (message) => { process.stderr.write(message + '\\n'); process.exit(1); };
const read = () => JSON.parse(fs.readFileSync(file, 'utf8'));
if (process.env.CLAUDE_CODE_OAUTH_TOKEN) { process.stdout.write('setup-token\\n'); process.exit(0); }
const initial = read().claudeAiOauth;
if (initial.expiresAt > Date.now() + 300000) { process.stdout.write('fresh\\n'); process.exit(0); }
let locked = false;
for (let attempt = 0; attempt < 200 && !locked; attempt++) {
  try { fs.mkdirSync(lock); locked = true; }
  catch (err) { if (err.code !== 'EEXIST') { fail('lock_error ' + err.code + '; API Error: 401 OAuth access token has expired'); } sleep(25); }
}
if (!locked) { fail('lock_timeout'); }
const release = () => { try { fs.rmdirSync(lock); } catch {} };
const current = read();
if (current.claudeAiOauth.accessToken !== initial.accessToken) { release(); process.stdout.write('race_resolved\\n'); process.exit(0); }
// Token endpoint: rotate on a matching refresh token, revoke the family on reuse.
const serverLock = path.join(server, 'lock');
while (true) { try { fs.mkdirSync(serverLock); break; } catch { sleep(5); } }
const statePath = path.join(server, 'state.json');
const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
let rotated = null;
if (!state.revoked && state.valid === current.claudeAiOauth.refreshToken) {
  state.issued += 1; state.valid = 'rt-' + state.issued; rotated = state.valid;
} else { state.revoked = true; state.valid = null; }
fs.writeFileSync(statePath, JSON.stringify(state));
fs.rmdirSync(serverLock);
sleep(Number(process.env.FAKE_OAUTH_LATENCY_MS || 0));
if (!rotated) { release(); fail('API Error: 401 OAuth access token has expired. Re-authenticate to continue.'); }
const next = JSON.stringify({ ...current, claudeAiOauth: { ...current.claudeAiOauth, accessToken: 'at-' + rotated, refreshToken: rotated, expiresAt: Date.now() + 8 * 3600000 } });
const tmp = file + '.tmp.' + crypto.randomBytes(4).toString('hex');
let saved = false;
try {
  fs.writeFileSync(tmp, next, { mode: 0o600 });
  try { fs.renameSync(tmp, file); }
  catch (err) {
    if (!['EXDEV', 'EPERM', 'EEXIST', 'EBUSY'].includes(err.code)) { throw err; }
    fs.writeFileSync(file, next);
    fs.unlinkSync(tmp);
  }
  saved = true;
} catch (err) { process.stderr.write('credential save failed: ' + err.code + '\\n'); }
release();
process.stdout.write(saved ? 'refreshed\\n' : 'refreshed-in-memory\\n');
`, { mode: 0o755 });
  return file;
}

/** Run `command` under the given bwrap argv prefix, synchronously. */
export function runSandboxed(bwrapArgs: string[], command: string, env: NodeJS.ProcessEnv, args: string[] = []): childProcess.SpawnSyncReturns<string> {
  return childProcess.spawnSync('bwrap', [...bwrapArgs, command, ...args], { encoding: 'utf8', env, timeout: 20_000 });
}

/** Run `command` under the given bwrap argv prefix without blocking the event loop. */
export function runSandboxedAsync(bwrapArgs: string[], command: string, env: NodeJS.ProcessEnv): Promise<{ status: number | null; stdout: string; stderr: string }> {
  return new Promise(resolve => {
    const child = childProcess.spawn('bwrap', [...bwrapArgs, command], { env });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('close', status => resolve({ status, stdout, stderr }));
  });
}

export interface SandboxHome { home: string; worktree: string; artifactDir: string; server: FakeOAuthServer; claude: string }

/**
 * Run `fn` against a throwaway HOME (outside /tmp, so the profile's /tmp bind
 * cannot make ~/.claude writable) holding an expired Claude credential, with a
 * fresh token endpoint and stand-in CLI.
 */
export async function withSandboxHome<T>(fn: (fixture: SandboxHome) => T | Promise<T>): Promise<T> {
  const previous = { HOME: process.env.HOME, PARALLIX_HOME: process.env.PARALLIX_HOME };
  const root = path.join(process.cwd(), '.workflow');
  fs.mkdirSync(root, { recursive: true });
  const home = fs.mkdtempSync(path.join(root, 'task-2598-home-'));
  const worktree = fs.mkdtempSync(path.join(os.tmpdir(), 'task-2598-worktree-'));
  const artifactDir = fs.mkdtempSync(path.join(os.tmpdir(), 'task-2598-artifacts-'));
  process.env.HOME = home;
  process.env.PARALLIX_HOME = path.join(home, 'parallix-state');
  try {
    writeExpiredCredentials(path.join(home, '.claude', '.credentials.json'));
    const server = createFakeOAuthServer(path.join(artifactDir, 'oauth'));
    const claude = writeFakeClaude(path.join(artifactDir, 'bin'));
    return await fn({ home, worktree, artifactDir, server, claude });
  } finally {
    if (previous.HOME === undefined) { delete process.env.HOME; } else { process.env.HOME = previous.HOME; }
    if (previous.PARALLIX_HOME === undefined) { delete process.env.PARALLIX_HOME; } else { process.env.PARALLIX_HOME = previous.PARALLIX_HOME; }
    for (const dir of [home, worktree, artifactDir]) { fs.rmSync(dir, { recursive: true, force: true }); }
  }
}
