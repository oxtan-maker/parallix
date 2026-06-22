const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const config = require('../lib/commands/config');

function withTempDir(fn) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'workflow-config-command-'));
  try {
    fn(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function runConfig(root) {
  const logs = [];
  const errors = [];
  let exitCode = null;
  return config([], {
    rootDir: root,
    logFn: message => logs.push(message),
    errorFn: message => errors.push(message),
    exitFn: code => { exitCode = code; },
  }).then(() => ({ logs, errors, exitCode }));
}

test('config reports malformed JSON as fallback defaults and exits non-zero', async () => {
  await new Promise((resolve, reject) => withTempDir(root => {
    fs.writeFileSync(path.join(root, 'workflow.config.json'), '{ invalid');
    runConfig(root).then(result => {
      assert.equal(result.exitCode, 1);
      assert.match(result.errors.join('\n'), /invalid JSON/);
      assert.match(result.errors.join('\n'), /fallback built-in defaults/);
      resolve();
    }, reject);
  }));
});

test('config reports structurally invalid overrides as fallback defaults and exits non-zero', async () => {
  await new Promise((resolve, reject) => withTempDir(root => {
    fs.writeFileSync(path.join(root, 'workflow.config.json'), JSON.stringify({ adapters: [] }));
    runConfig(root).then(result => {
      assert.equal(result.exitCode, 1);
      assert.match(result.errors.join('\n'), /structurally invalid/);
      assert.match(result.errors.join('\n'), /adapters must be an object/);
      assert.doesNotMatch(result.logs.join('\n'), /built-in defaults \+/);
      resolve();
    }, reject);
  }));
});

test('config leaves a non-git standalone directory unchanged', () => {
  withTempDir(root => {
    fs.mkdirSync(path.join(root, 'workflow'));
    fs.writeFileSync(path.join(root, 'workflow', 'index.js'), '// standalone marker\n');
    fs.writeFileSync(path.join(root, 'workflow.config.json'), '{}\n');
    fs.writeFileSync(path.join(root, 'existing.txt'), 'unrelated adopter content\n');

    execFileSync(process.execPath, [path.join(__dirname, '..', 'index.js'), 'config'], {
      cwd: root,
      stdio: 'pipe',
    });

    assert.equal(fs.existsSync(path.join(root, '.git')), false);
    assert.equal(fs.readFileSync(path.join(root, 'existing.txt'), 'utf8'), 'unrelated adopter content\n');
  });
});
