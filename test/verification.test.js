const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  NO_GATE_NOTICE,
  formatVerificationCommand,
  resolveVerificationAdapter,
  runVerificationGate,
} = require('../lib/core/verification');

function withTempDir(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'workflow-verification-'));
  try {
    fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('resolveVerificationAdapter defaults to no validation (no command)', () => {
  withTempDir(root => {
    const adapter = resolveVerificationAdapter(root);
    assert.equal(adapter.command, null);
    assert.equal(adapter.defaultArea, 'docs');
  });
});

test('formatVerificationCommand returns the no-gate notice when unconfigured', () => {
  withTempDir(root => {
    assert.equal(formatVerificationCommand('docs', root), NO_GATE_NOTICE);
  });
});

test('formatVerificationCommand substitutes the configured area placeholder', () => {
  withTempDir(root => {
    fs.writeFileSync(path.join(root, 'workflow.config.json'), JSON.stringify({
      product: { name: 'Test Project' },
      adapters: {
        tasks: { provider: 'backlog-md', storage: 'backlog' },
        missions: { baseDir: 'docs/missions', branchPrefix: 'mission/', worktreePattern: '../<repo>-<slug>' },
        verification: { command: 'npm run verify:{{area}}', defaultArea: 'docs' },
        review: { provider: 'forgejo', baseUrl: 'http://localhost:3300', remote: 'review', repo: 'test-org/test-repo' },
        agents: { commandEnvPrefix: 'AUTONOMOUS_REVIEW_' },
      },
    }, null, 2));

    assert.equal(formatVerificationCommand('workflow', root), 'npm run verify:workflow');
    assert.equal(formatVerificationCommand(null, root), 'npm run verify:docs');
  });
});

test('formatVerificationCommand leaves non-templated commands unchanged', () => {
  withTempDir(root => {
    fs.writeFileSync(path.join(root, 'workflow.config.json'), JSON.stringify({
      product: { name: 'Test Project' },
      adapters: {
        tasks: { provider: 'backlog-md', storage: 'backlog' },
        missions: { baseDir: 'docs/missions', branchPrefix: 'mission/', worktreePattern: '../<repo>-<slug>' },
        verification: { command: 'npm test', defaultArea: 'docs' },
        review: { provider: 'forgejo', baseUrl: 'http://localhost:3300', remote: 'review', repo: 'test-org/test-repo' },
        agents: { commandEnvPrefix: 'AUTONOMOUS_REVIEW_' },
      },
    }, null, 2));

    assert.equal(formatVerificationCommand('workflow', root), 'npm test');
  });
});

test('runVerificationGate is a no-op pass when no command is configured', () => {
  withTempDir(root => {
    const calls = [];
    const logs = [];
    const result = runVerificationGate('docs', {
      rootDir: root,
      runFn(command, args, options) {
        calls.push({ command, args, options });
        return { status: 0 };
      },
      log(msg) { logs.push(msg); },
    });

    assert.equal(result.status, 0);
    assert.deepEqual(calls, []); // nothing executed: no validation
    assert.equal(logs.length, 1);
    assert.match(logs[0], /no validation/);
  });
});

test('runVerificationGate executes the configured command via bash', () => {
  withTempDir(root => {
    fs.writeFileSync(path.join(root, 'workflow.config.json'), JSON.stringify({
      product: { name: 'Test Project' },
      adapters: {
        tasks: { provider: 'backlog-md', storage: 'backlog' },
        missions: { baseDir: 'docs/missions', branchPrefix: 'mission/', worktreePattern: '../<repo>-<slug>' },
        verification: { command: 'npm test', defaultArea: 'docs' },
        review: { provider: 'forgejo', baseUrl: 'http://localhost:3300', remote: 'review', repo: 'test-org/test-repo' },
        agents: { commandEnvPrefix: 'AUTONOMOUS_REVIEW_' },
      },
    }, null, 2));

    const calls = [];
    const result = runVerificationGate('docs', {
      rootDir: root,
      runFn(command, args, options) {
        calls.push({ command, args, options });
        return { status: 0 };
      }
    });

    assert.equal(result.status, 0);
    assert.deepEqual(calls, [{
      command: 'bash',
      args: ['-lc', 'npm test'],
      options: { cwd: root, stdio: 'inherit' },
    }]);
  });
});
