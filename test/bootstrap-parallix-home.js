'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

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

fs.mkdirSync(process.env.PARALLIX_HOME, { recursive: true });
fs.mkdirSync(process.env.HOME, { recursive: true });

const agentsLocalPath = path.join(process.env.PARALLIX_HOME, 'agents.local.json');
if (!fs.existsSync(agentsLocalPath)) {
  fs.writeFileSync(agentsLocalPath, '{"blocklist":{}}\n');
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
for (const name of ['codex', 'claude', 'opencode', 'pi', 'vibe']) {
  const launcherPath = path.join(launcherBin, name);
  fs.writeFileSync(launcherPath, `#!${process.execPath}
if (process.argv.includes('--help')) process.exit(0);
process.exit(0);
`);
  fs.chmodSync(launcherPath, 0o755);
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
