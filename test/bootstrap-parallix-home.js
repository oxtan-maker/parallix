'use strict';

const fs = require('fs');
const http = require('node:http');
const https = require('node:https');
const os = require('os');
const path = require('path');
const childProcess = require('child_process');

const tempRoots = [];

function makeTempDir(prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempRoots.push(dir);
  return dir;
}

// Tests must never touch the operator's real persistent state, even when the
// caller already exported PARALLIX_HOME/HOME in their shell.
process.env.PARALLIX_HOME = makeTempDir('parallix-test-home-');
process.env.HOME = makeTempDir('parallix-test-user-home-');
// Unit tests must never discover an operator's live Forgejo installation or
// endpoint. Tests that exercise Forgejo behavior must inject their API and
// availability doubles explicitly; an omitted double must fail safely rather
// than contacting localhost:3300.
process.env.FORGEJO_HOME = makeTempDir('parallix-test-forgejo-home-');
process.env.FORGEJO_URL = 'http://127.0.0.1:9';
process.env.PARALLIX_TEST_NO_FORGEJO = '1';
// Legacy unit fixtures exercise later integrate branches directly. This test-only
// marker keeps those hermetic fixtures from bypassing the production gate rule.
process.env.PARALLIX_TEST_ALLOW_INTEGRATION_GATE_BYPASS = '1';

function forgejoNetworkError(target) {
  return new Error(`Unit test attempted an unmocked Forgejo request to ${String(target)}`);
}

function guardRequest(module) {
  const request = module.request;
  module.request = function guardedRequest(...args) {
    const target = args[0];
    let url;
    try {
      url = target instanceof URL ? target : new URL(String(target));
    } catch (_) {
      const options = target && typeof target === 'object' ? target : args[1];
      const protocol = options?.protocol || 'http:';
      const host = options?.hostname || options?.host || 'localhost';
      url = new URL(`${protocol}//${host}${options?.path || '/'}`);
    }
    if ((url.hostname === 'localhost' && url.port === '3300')
      || (url.hostname === '127.0.0.1' && url.port === '9')) {
      throw forgejoNetworkError(url);
    }
    return request.apply(this, args);
  };
}

guardRequest(http);
guardRequest(https);

fs.mkdirSync(process.env.PARALLIX_HOME, { recursive: true });
fs.mkdirSync(process.env.HOME, { recursive: true });

const agentsLocalPath = path.join(process.env.PARALLIX_HOME, 'agents.local.json');
if (!fs.existsSync(agentsLocalPath)) {
  fs.writeFileSync(agentsLocalPath, '{"blocklist":{}}\n');
}

function commandPath(command) {
  for (const dir of (process.env.PATH || '').split(path.delimiter)) {
    const candidate = path.join(dir, command);
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      return candidate;
    } catch (_) { /* keep looking */ }
  }
  return null;
}

// macOS still ships Git 2.24 on some supported workstations. Its `git init`
// lacks `-b`, while fixture setup across the suite uses that modern spelling.
// Keep production commands untouched and translate only the test child PATH.
// Node's test runner starts a child process for every test file. Preserve the
// original executable from its parent bootstrap rather than resolving the
// already-installed shim again, which would make the shim recursively invoke
// itself in the child worker.
const realGit = process.env.PARALLIX_TEST_REAL_GIT || commandPath('git');
if (realGit) {
  const gitBin = makeTempDir('parallix-test-git-');
  const gitShim = path.join(gitBin, 'git');
  fs.writeFileSync(gitShim, `#!${process.execPath}
const cp = require('child_process');
const args = process.argv.slice(2);
const realGit = process.env.PARALLIX_TEST_REAL_GIT;
const initIndex = args.indexOf('init');
if (initIndex !== -1 && args[initIndex + 1] === '-b' && args[initIndex + 2]) {
  const branch = args[initIndex + 2];
  const initArgs = [...args.slice(0, initIndex), 'init', ...args.slice(initIndex + 3)];
  const init = cp.spawnSync(realGit, initArgs, { stdio: 'inherit' });
  if (init.status !== 0) process.exit(init.status || 1);
  const cwdIndex = initArgs.indexOf('-C');
  const target = cwdIndex !== -1 ? initArgs[cwdIndex + 1] : (initArgs.length > 1 ? initArgs[initArgs.length - 1] : process.cwd());
  const checkout = cp.spawnSync(realGit, ['-C', target, 'checkout', '-b', branch], { stdio: 'inherit' });
  process.exit(checkout.status || 0);
}

const result = cp.spawnSync(realGit, args, { stdio: 'inherit' });
process.exit(result.status || 0);
`, 'utf8');
  fs.chmodSync(gitShim, 0o755);
  process.env.PARALLIX_TEST_REAL_GIT = realGit;
  process.env.PATH = `${gitBin}${path.delimiter}${process.env.PATH || ''}`;
}

// Forgejo's API client uses curl. Keep `curl --version` available for command
// diagnostics, but make every unit-test network invocation a visible failure.
// Tests that cover API behavior provide request doubles (or a fixture curl on
// PATH), while explicit integration/E2E runs do not preload this bootstrap.
const realCurl = process.env.PARALLIX_TEST_REAL_CURL || commandPath('curl');
if (realCurl) {
  const curlBin = makeTempDir('parallix-test-curl-');
  const curlShim = path.join(curlBin, 'curl');
  const curlMarker = path.join(curlBin, 'unmocked-request');
  fs.writeFileSync(curlShim, `#!${process.execPath}
const fs = require('node:fs');
const cp = require('node:child_process');
const args = process.argv.slice(2);
if (args.length === 1 && args[0] === '--version') {
  const result = cp.spawnSync(process.env.PARALLIX_TEST_REAL_CURL, args, { stdio: 'inherit' });
  process.exit(result.status || 0);
}
fs.writeFileSync(${JSON.stringify(curlMarker)}, args.join(' ') + '\\n', { flag: 'a' });
process.stderr.write('Unit test attempted an unmocked Forgejo curl request\\n');
process.exit(97);
`, 'utf8');
  fs.chmodSync(curlShim, 0o755);
  process.env.PARALLIX_TEST_REAL_CURL = realCurl;
  process.env.PATH = `${curlBin}${path.delimiter}${process.env.PATH || ''}`;
  process.on('exit', () => {
    if (fs.existsSync(curlMarker)) {
      process.stderr.write(`Unmocked unit-test curl invocation(s):\n${fs.readFileSync(curlMarker, 'utf8')}`);
      process.exitCode = 1;
    }
  });
}

// Launcher resolution prefers explicit *_BIN env overrides over PATH
// (resolveOpencodeCommand / resolvePiCommand), so an operator shell that
// exports them would bypass the PATH safety net below and hand unit tests the
// real CLI — an expensive launch that hangs the suite (task-2231). Tests that
// exercise the override behaviour set these vars themselves.
delete process.env.OPENCODE_BIN;
delete process.env.PI_BIN;

// Safety net: if a test forgets to stub launcher discovery, these harmless
// binaries prevent real Codex/Claude/Vibe/OpenCode/Pi CLIs from consuming tokens
// or mutating operator-local state on the workstation.
const launcherBin = makeTempDir('parallix-test-launchers-');
const launcherRunner = path.join(__dirname, 'lib', 'agent-script-runner.js');
for (const name of ['codex', 'claude', 'opencode', 'pi', 'vibe']) {
  const launcherPath = path.join(launcherBin, name);
  fs.symlinkSync(launcherRunner, launcherPath);
}

process.env.PATH = `${launcherBin}${path.delimiter}${process.env.PATH || ''}`;
// Pi also resolves NVM_BIN and the Node-adjacent global install before PATH;
// pin its explicit override so those fallback candidates cannot escape this
// test harness and execute the operator's real Pi CLI during a health probe.
process.env.PI_BIN = path.join(launcherBin, 'pi');

process.on('exit', () => {
  for (const dir of tempRoots.reverse()) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch (_) {
      // best-effort cleanup only
    }
  }
});
