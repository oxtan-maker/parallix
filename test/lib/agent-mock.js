const fs = require('fs');
const os = require('os');
const path = require('path');

function jsString(value) {
  return JSON.stringify(String(value ?? ''));
}

function buildMockResult(status = 0, signal = null, stdout = '', stderr = '', sessionId = null) {
  const result = { status, signal, stdout, stderr };
  if (sessionId !== null && sessionId !== undefined) {
    result.sessionId = sessionId;
  }
  return result;
}

function writeLauncher(tmpRoot, name, body) {
  fs.mkdirSync(tmpRoot, { recursive: true });
  const launcherPath = path.join(tmpRoot, name);
  fs.writeFileSync(launcherPath, `#!${process.execPath}\n${body}`);
  fs.chmodSync(launcherPath, 0o755);
  return launcherPath;
}

function createLauncherWithScript({
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'workflow-agent-script-')),
  name = 'script-launcher',
  script
} = {}) {
  return writeLauncher(tmpRoot, name, script || 'process.exit(0);\n');
}

function createLauncherWithOutput({
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'workflow-agent-mock-')),
  name = 'mock-agent-launcher',
  stdout = '',
  stderr = '',
  exitCode = 0,
  healthOk = true,
  delayMs = 0,
  signal = null,
  sessionId = null
} = {}) {
  const body = [
    "const args = process.argv.slice(2);",
    "if (args.includes('--help')) {",
    `  process.exit(${healthOk ? 0 : 1});`,
    "}",
    Number(delayMs) > 0 ? `setTimeout(() => {` : '',
    `process.stdout.write(${jsString(stdout)});`,
    `process.stderr.write(${jsString(stderr)});`,
    sessionId ? `process.stdout.write(${jsString(`\nsession_id:${sessionId}\n`)});` : '',
    signal ? `process.kill(process.pid, ${jsString(signal)});` : '',
    `process.exit(${Number(exitCode)});`,
    Number(delayMs) > 0 ? `}, ${Number(delayMs)});` : '',
    ''
  ].filter(Boolean).join('\n');
  return writeLauncher(tmpRoot, name, body);
}

function createDummyLauncher(tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'workflow-agent-dummy-'))) {
  return createLauncherWithOutput({ tmpRoot, name: 'dummy-launcher', exitCode: 0, healthOk: true });
}

function createFailLauncher(exitCode = 1, tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'workflow-agent-fail-'))) {
  return createLauncherWithOutput({ tmpRoot, name: `fail-launcher-${exitCode}`, exitCode, healthOk: true });
}

function createSpawnErrorLauncher(code = 'ENOENT', tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'workflow-agent-spawn-error-'))) {
  fs.mkdirSync(tmpRoot, { recursive: true });
  return path.join(tmpRoot, `missing-launcher-${code}`);
}

function cleanupLauncher(launcherPath) {
  if (!launcherPath) return;
  fs.rmSync(launcherPath, { force: true });
}

function fakeLauncher({
  command = 'mock-agent',
  args = [],
  exitCode = 0,
  stdout = '',
  stderr = '',
  signal = null,
  sessionId = null,
  spawnError = null
} = {}) {
  return ({ prompt, worktree, env = {} } = {}) => ({
    invocation: {
      command,
      args,
      options: { cwd: worktree, env: { ...env } },
      prompt
    },
    resultPromise: spawnError
      ? Promise.resolve({ error: Object.assign(new Error(spawnError.message || String(spawnError)), { code: spawnError.code }) })
      : Promise.resolve(buildMockResult(exitCode, signal, stdout, stderr, sessionId))
  });
}

module.exports = {
  buildMockResult,
  cleanupLauncher,
  createDummyLauncher,
  createFailLauncher,
  createLauncherWithScript,
  createLauncherWithOutput,
  createSpawnErrorLauncher,
  fakeLauncher
};
