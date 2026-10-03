// @ts-nocheck -- TASK-2328: partial test doubles from ESM seam migration; resolve in follow-up
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { spawn } from 'child_process';
'use strict';

// Regression test for task-2231: unit tests sometimes hang around the draft
// custom-agent launch coverage.
//
// Root cause: test/bootstrap-parallix-home.ts shadows PATH with harmless fake
// launchers, but resolveOpencodeCommand() (src/adapters/agents/opencode.ts)
// prefers the OPENCODE_BIN env var over PATH. When the operator's shell exports
// OPENCODE_BIN, the draft launch/retry unit tests bypass every PATH fake and
// start the operator's real opencode CLI — an expensive LLM run that can sit
// silent far longer than any unit test, so the suite appears to hang.
//
// This test reproduces that environment with controlled doubles only. A short
// child process loads the unit-test bootstrap and reports the resolved command;
// no launcher process, signal timing, or completion timeout is involved.

const OPENCODE_MODULE_PATH = path.join(import.meta.dirname, '..', 'src', 'adapters', 'agents', 'opencode.ts');

function writeLauncher(filePath, body) {
  fs.writeFileSync(filePath, `#!${process.execPath}\n${body}\n`);
  fs.chmodSync(filePath, 0o755);
}

test('unit bootstrap ignores the operator OPENCODE_BIN override when resolving the custom launcher', async () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'task-2231-repro-'));
  try {
    // Stand-in for the operator's real, expensive opencode CLI. If bootstrap
    // isolation regresses, command resolution will return this exact path.
    const expensiveDir = path.join(tmpRoot, 'expensive');
    fs.mkdirSync(expensiveDir);
    const invokedMarkerPath = path.join(expensiveDir, 'invoked.log');
    const expensiveBinPath = path.join(expensiveDir, 'opencode');
    writeLauncher(expensiveBinPath, `
require('fs').appendFileSync(${JSON.stringify(invokedMarkerPath)}, process.argv.slice(2).join(' ') + '\\n');
process.exit(0);
`);

    const scenario = `
const { resolveOpencodeCommand } = await import(${JSON.stringify(OPENCODE_MODULE_PATH)});
process.stdout.write(JSON.stringify({
  override: process.env.OPENCODE_BIN || null,
  resolved: resolveOpencodeCommand(),
}));
`;
    const child = spawn(process.execPath, [
      '--import', 'tsx',
      '--import', './bootstrap-parallix-home.ts',
      '--input-type=module',
      '-e', scenario,
    ], {
      cwd: path.join(import.meta.dirname),
      env: { ...process.env, OPENCODE_BIN: expensiveBinPath },
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });

    const { code, signal } = await new Promise((resolve) => {
      child.on('close', (c, s) => resolve({ code: c, signal: s }));
    });

    assert.equal(code, 0, `bootstrap scenario exited non-zero (code=${code}, signal=${signal}): ${stderr}`);
    const parsed = JSON.parse(stdout);
    assert.equal(parsed.override, null, 'bootstrap must clear the operator OPENCODE_BIN override');
    assert.notEqual(parsed.resolved, expensiveBinPath, 'custom launcher resolution must use the unit-test PATH double');

    assert.equal(fs.existsSync(invokedMarkerPath), false,
      `the OPENCODE_BIN override must never reach unit-test launches; recorded invocations: ` +
      `${fs.existsSync(invokedMarkerPath) ? fs.readFileSync(invokedMarkerPath, 'utf8').trim() : '(none)'}`);
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});
