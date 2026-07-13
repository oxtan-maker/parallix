const test = require('node:test');
const assert = require('node:assert/strict');
const childProcess = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  captureVerifiedTreeProof,
  NO_GATE_NOTICE,
  formatVerificationCommand,
  resolveVerificationAdapter,
  readPublishedTreeState,
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

function initCommittedGitRepo(root) {
  const runGit = (args) => {
    const result = childProcess.spawnSync('git', ['-C', root, ...args], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr || result.stdout || `git ${args.join(' ')} failed`);
  };
  runGit(['init', '-b', 'main']);
  runGit(['config', 'user.name', 'Test User']);
  runGit(['config', 'user.email', 'test@example.com']);
  fs.writeFileSync(path.join(root, 'README.md'), '# temp repo\n', 'utf8');
  runGit(['add', 'README.md']);
  runGit(['commit', '-m', 'init']);
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

test('readPublishedTreeState uses the git-style runner by default', () => {
  withTempDir(root => {
    const realpathRoot = fs.realpathSync(root);
    const state = readPublishedTreeState(root, {
      // @ts-expect-error TS2322 Type '(args: string[]) => { status: number; stdout: string; stderr: string; }' i
      gitRunner(args) {
        assert.ok(Array.isArray(args), 'expected git-style argv array');
        if (args.includes('HEAD^{tree}')) {
          return { status: 0, stdout: 'tree123\n', stderr: '' };
        }
        if (args.includes('HEAD')) {
          return { status: 0, stdout: 'abc123\n', stderr: '' };
        }
        throw new Error(`Unexpected git args: ${args.join(' ')}`);
      }
    });

    assert.deepEqual(state, {
      ok: true,
      rootDir: realpathRoot,
      commit: 'abc123',
      tree: 'tree123',
    });
  });
});

test('captureVerifiedTreeProof uses the git-style runner by default', () => {
  withTempDir(root => {
    initCommittedGitRepo(root);
    const proofResult = captureVerifiedTreeProof('docs', root, {
      runFn() {
        return { status: 0 };
      },
      stdio: 'pipe',
    });

    assert.equal(proofResult.ok, true);
    assert.equal(proofResult.proof.rootDir, fs.realpathSync(root));
    assert.equal(proofResult.proof.area, 'docs');
    assert.equal(typeof proofResult.proof.commit, 'string');
    assert.equal(typeof proofResult.proof.tree, 'string');
    assert.ok(proofResult.proof.commit.length > 0);
    assert.ok(proofResult.proof.tree.length > 0);
  });
});

test('captureVerifiedTreeProof warns but succeeds when guarded compiled output is stale', () => {
  withTempDir(root => {
    initCommittedGitRepo(root);

    const commandsDir = path.join(root, 'lib', 'commands');
    fs.mkdirSync(commandsDir, { recursive: true });
    const tsPath = path.join(commandsDir, 'stats.ts');
    const jsPath = path.join(commandsDir, 'stats.js');
    fs.writeFileSync(tsPath, 'export default function stats() { return 1; }\n', 'utf8');
    fs.writeFileSync(jsPath, '"use strict";\nmodule.exports = function stats() { return 1; };\n', 'utf8');

    const oldJsTime = new Date('2000-01-01T00:00:00.000Z');
    const newTsTime = new Date('2030-01-01T00:00:00.000Z');
    fs.utimesSync(jsPath, oldJsTime, oldJsTime);
    fs.utimesSync(tsPath, newTsTime, newTsTime);

    const runGit = (args) => {
      const result = childProcess.spawnSync('git', ['-C', root, ...args], { encoding: 'utf8' });
      assert.equal(result.status, 0, result.stderr || result.stdout || `git ${args.join(' ')} failed`);
      return result;
    };
    runGit(['add', 'lib/commands/stats.ts', 'lib/commands/stats.js']);
    runGit(['commit', '-m', 'add stale fixture']);

    const proofResult = captureVerifiedTreeProof('docs', root, {
      runFn() {
        return { status: 0 };
      },
      stdio: 'pipe',
    });

    assert.equal(proofResult.ok, true);
    assert.equal(proofResult.proof.rootDir, fs.realpathSync(root));
    assert.equal(proofResult.proof.area, 'docs');
  });
});
