


import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { mockModule, installModuleMocks } from './lib/module-mock.js';
const config = mockModule<typeof import('../src/adapters/cli/commands/config.js')>('../src/adapters/cli/commands/config.js', import.meta.url);
await installModuleMocks();
test.afterEach(() => mock.restoreAll());
async function withTempDir(fn) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'workflow-config-command-'));
  try {
    await fn(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function runConfig(root, args: string[] = []) {
  const logs = [];
  const errors = [];
  let exitCode = null;
  return config.default(args, {
    rootDir: root,
    logFn: message => logs.push(message),
    errorFn: message => errors.push(message),
    exitFn: code => { exitCode = code; },
  }).then(() => ({ logs, errors, exitCode }));
}

test('config reports malformed JSON as fallback defaults and exits non-zero', async () => {
  await withTempDir(async root => {
    fs.writeFileSync(path.join(root, 'workflow.config.json'), '{ invalid');
    const result = await runConfig(root);
    assert.equal(result.exitCode, 1);
    assert.match(result.errors.join('\n'), /invalid JSON/);
    assert.match(result.errors.join('\n'), /fallback built-in defaults/);
  });
});

test('config reports structurally invalid overrides as fallback defaults and exits non-zero', async () => {
  await withTempDir(async root => {
    fs.writeFileSync(path.join(root, 'workflow.config.json'), JSON.stringify({ adapters: [] }));
    const result = await runConfig(root);
    assert.equal(result.exitCode, 1);
    assert.match(result.errors.join('\n'), /structurally invalid/);
    assert.match(result.errors.join('\n'), /adapters must be an object/);
    assert.doesNotMatch(result.logs.join('\n'), /built-in defaults \+/);
  });
});

test('config rejects an unsupported review provider enum value as fallback defaults and exits non-zero', async () => {
  await withTempDir(async root => {
    fs.writeFileSync(path.join(root, 'workflow.config.json'), JSON.stringify({ adapters: { review: { provider: 'unsupported' } } }));
    const result = await runConfig(root);
    assert.equal(result.exitCode, 1);
    assert.match(result.errors.join('\n'), /structurally invalid/);
    assert.match(result.errors.join('\n'), /provider/);
    assert.doesNotMatch(result.logs.join('\n'), /built-in defaults \+/);
  });
});

test('config --write exits non-zero when the working directory is not a repository root', async () => {
  await withTempDir(async root => {
    const result = await runConfig(root, ['--write']);
    assert.equal(result.exitCode, 1);
    assert.match(result.errors.join('\n'), /repository root/);
    // read-only mode still prints the effective config as before
    const readOnly = await runConfig(root, []);
    assert.equal(readOnly.exitCode, null);
    assert.match(readOnly.logs.join('\n'), /adapters/);
  });
});

test('config leaves a non-git standalone directory unchanged', () => {
  return withTempDir(async root => {
    fs.mkdirSync(path.join(root, 'workflow'));
    fs.writeFileSync(path.join(root, 'workflow', 'index.js'), '// standalone marker\n');
    fs.writeFileSync(path.join(root, 'workflow.config.json'), '{}\n');
    fs.writeFileSync(path.join(root, 'existing.txt'), 'unrelated adopter content\n');

    const result = await config.default([], {
      rootDir: root,
      logFn: () => {},
      errorFn: () => {},
      exitFn: () => {},
    });

    assert.equal(fs.existsSync(path.join(root, '.git')), false);
    assert.equal(fs.readFileSync(path.join(root, 'existing.txt'), 'utf8'), 'unrelated adopter content\n');
    assert.equal(result, undefined);
  });
});
