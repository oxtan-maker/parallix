


import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { mockModule, installModuleMocks } from './lib/module-mock.js';
const runDeclaredGatesModule = mockModule<typeof import('../src/adapters/cli/commands/handoff.js')>('../src/adapters/cli/commands/handoff.js', import.meta.url);
await installModuleMocks();
test.afterEach(() => mock.restoreAll());
const { runDeclaredGates } = runDeclaredGatesModule;
test('runDeclaredGates rejects prose-appended commands before execution', () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'task-2214-gates-'));
  const missionDir = path.join(rootDir, 'missions', 'task-2214');
  const scriptDir = path.join(rootDir, 'scripts');
  const runnerMarker = path.join(rootDir, 'declared-gate-runner-called');
  const offendingGate = '`./scripts/verify-local.sh all` passes on the final tree.';

  fs.mkdirSync(missionDir, { recursive: true });
  fs.mkdirSync(scriptDir, { recursive: true });
  fs.writeFileSync(
    path.join(scriptDir, 'verify-local.sh'),
    `#!/usr/bin/env bash\ntouch ${JSON.stringify(runnerMarker)}\n`
  );
  fs.chmodSync(path.join(scriptDir, 'verify-local.sh'), 0o755);
  fs.writeFileSync(
    path.join(missionDir, 'MISSION.md'),
    `# Mission\n\n## Gates\n\n- [ ] ${offendingGate}\n`
  );

  try {
    const result = runDeclaredGates(missionDir, rootDir, {
      log: () => {},
      error: () => {}
    });

    assert.equal(result.ok, false);
    assert.equal(result.reason, 'validation-failed');
    assert.equal(result.gate, offendingGate);
    assert.match(result.error, /exact (?:runnable )?command/i);
    assert.match(result.error, /remove|replace|trailing|prose/i);
    assert.equal(
      fs.existsSync(runnerMarker),
      false,
      'the declared-gate shell runner must not execute a rejected gate'
    );
  } finally {
    fs.rmSync(rootDir, { recursive: true, force: true });
  }
});
