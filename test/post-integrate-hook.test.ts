
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  resolvePostIntegrateCommand,
  buildPostIntegrateHookEnv,
  runPostIntegrateHook,
} = require('../.test-runtime/lib/core/post-integrate-hook');

function withTempDir(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'workflow-post-integrate-hook-'));
  try {
    fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('resolvePostIntegrateCommand returns null when no workflow.config.json is present', () => {
  withTempDir(root => {
    assert.equal(resolvePostIntegrateCommand(root), null);
  });
});

test('resolvePostIntegrateCommand returns null when postIntegrateCommand is absent', () => {
  withTempDir(root => {
    fs.writeFileSync(path.join(root, 'workflow.config.json'), JSON.stringify({
      adapters: { integrate: {} },
    }));
    assert.equal(resolvePostIntegrateCommand(root), null);
  });
});

test('resolvePostIntegrateCommand returns the trimmed configured command', () => {
  withTempDir(root => {
    fs.writeFileSync(path.join(root, 'workflow.config.json'), JSON.stringify({
      adapters: { integrate: { postIntegrateCommand: '  ./scripts/refresh-px.sh  ' } },
    }));
    assert.equal(resolvePostIntegrateCommand(root), './scripts/refresh-px.sh');
  });
});

test('buildPostIntegrateHookEnv exposes slug, base worktree, base branch, and variant', () => {
  const env = buildPostIntegrateHookEnv({
    slug: 'task-1402',
    baseWorktree: '/repo',
    baseBranch: 'main',
    variant: 'variant-b',
    processEnv: {},
  });

  assert.equal(env.INTEGRATE_HOOK_SLUG, 'task-1402');
  assert.equal(env.INTEGRATE_HOOK_BASE_WORKTREE, '/repo');
  assert.equal(env.INTEGRATE_HOOK_BASE_BRANCH, 'main');
  assert.equal(env.INTEGRATE_HOOK_VARIANT, 'variant-b');
});

test('runPostIntegrateHook is a no-op when no command is configured', () => {
  const runFn = () => { throw new Error('should not run a command'); };
  const result = runPostIntegrateHook({
    slug: 'task-1402',
    baseWorktree: '/repo',
    baseBranch: 'main',
    variant: 'variant-b',
    runFn,
    resolveCommandFn: () => null,
  });

  assert.deepEqual(result, { ran: false, ok: true });
});

test('runPostIntegrateHook runs the configured command from the base worktree with hook env', () => {
  let capturedCmd;
  let capturedArgs;
  let capturedOptions;
  const runFn = (cmd, args, options) => {
    capturedCmd = cmd;
    capturedArgs = args;
    capturedOptions = options;
    return { status: 0, stdout: 'bumped to 1.3.5\n', stderr: '' };
  };

  const result = runPostIntegrateHook({
    slug: 'task-1402',
    baseWorktree: '/repo',
    baseBranch: 'main',
    variant: 'variant-b',
    runFn,
    resolveCommandFn: () => './scripts/refresh-px.sh',
  });

  assert.equal(capturedCmd, 'bash');
  assert.deepEqual(capturedArgs, ['-lc', './scripts/refresh-px.sh']);
  assert.equal(capturedOptions.cwd, '/repo');
  assert.equal(capturedOptions.env.INTEGRATE_HOOK_SLUG, 'task-1402');
  assert.equal(capturedOptions.env.INTEGRATE_HOOK_VARIANT, 'variant-b');
  assert.deepEqual(result, {
    ran: true,
    ok: true,
    command: './scripts/refresh-px.sh',
    output: 'bumped to 1.3.5',
    exitCode: 0,
  });
});

test('runPostIntegrateHook reports a non-zero exit as a failed hook, not thrown', () => {
  const runFn = () => ({ status: 3, stdout: '', stderr: 'permission denied' });

  const result = runPostIntegrateHook({
    slug: 'task-1402',
    baseWorktree: '/repo',
    baseBranch: 'main',
    variant: 'variant-b-resumed',
    runFn,
    resolveCommandFn: () => './scripts/refresh-px.sh',
  });

  assert.equal(result.ran, true);
  assert.equal(result.ok, false);
  assert.equal(result.exitCode, 3);
  assert.equal(result.output, 'permission denied');
});
