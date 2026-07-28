const fs = require('fs');
const os = require('os');
const path = require('path');

interface MockResult {
  status: number;
  signal: string | null;
  stdout: string;
  stderr: string;
  sessionId?: string;
}

function jsString(value: unknown): string {
  return JSON.stringify(String(value ?? ''));
}

function buildMockResult(
  status = 0,
  signal: string | null = null,
  stdout = '',
  stderr = '',
  sessionId: string | null = null,
): MockResult {
  const result: MockResult = { status, signal, stdout, stderr };
  if (sessionId !== null && sessionId !== undefined) {
    result.sessionId = sessionId;
  }
  return result;
}

function writeLauncher(tmpRoot: string, name: string, body: string): string {
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
}: { tmpRoot?: string; name?: string; script?: string } = {}): string {
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
}: {
  tmpRoot?: string;
  name?: string;
  stdout?: string;
  stderr?: string;
  exitCode?: number;
  healthOk?: boolean;
  delayMs?: number;
  signal?: string | null;
  sessionId?: string | null;
} = {}): string {
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

function createDummyLauncher(tmpRoot: string = fs.mkdtempSync(path.join(os.tmpdir(), 'workflow-agent-dummy-'))): string {
  return createLauncherWithOutput({ tmpRoot, name: 'dummy-launcher', exitCode: 0, healthOk: true });
}

function createFailLauncher(exitCode = 1, tmpRoot: string = fs.mkdtempSync(path.join(os.tmpdir(), 'workflow-agent-fail-'))): string {
  return createLauncherWithOutput({ tmpRoot, name: `fail-launcher-${exitCode}`, exitCode, healthOk: true });
}

function createSpawnErrorLauncher(code = 'ENOENT', tmpRoot: string = fs.mkdtempSync(path.join(os.tmpdir(), 'workflow-agent-spawn-error-'))): string {
  fs.mkdirSync(tmpRoot, { recursive: true });
  return path.join(tmpRoot, `missing-launcher-${code}`);
}

function cleanupLauncher(launcherPath: string | null | undefined): void {
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
}: {
  command?: string;
  args?: string[];
  exitCode?: number;
  stdout?: string;
  stderr?: string;
  signal?: string | null;
  sessionId?: string | null;
  spawnError?: { message?: string; code?: string } | null;
} = {}) {
  return ({ prompt, worktree, env = {} }: { prompt?: string; worktree?: string; env?: Record<string, string> } = {}) => ({
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

export {
  buildMockResult,
  cleanupLauncher,
  createDummyLauncher,
  createFailLauncher,
  createLauncherWithScript,
  createLauncherWithOutput,
  createSpawnErrorLauncher,
  fakeLauncher
};
export type { MockResult };

// CJS compat: the test files consume this helper via require().
declare const module: { exports: any } | undefined;
if (typeof module !== 'undefined') {
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
}
