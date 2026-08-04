
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  scopeMutationTargets,
  getChangedFiles,
  resolveCallees,
  extractLocalDependencies,
  isInScope,
  toRuntimePath,
} = require('../.test-runtime/adapters/git/mutation-scoper.js');

const mockGit = (responses) => (args) => {
  const cmd = args.join(' ');
  for (const [pattern, response] of responses) {
    if (pattern instanceof RegExp ? pattern.test(cmd) : cmd.includes(pattern)) {
      return response;
    }
  }
  return { status: 0, stdout: '', stderr: '' };
};

// Mirrors the canonical layer tree emitted by scripts/build-test-runtime.ts.
function makeFixtureRepo() {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mutation-scoper-'));
  const runtimeRoot = path.join(repoRoot, '.test-runtime');
  fs.mkdirSync(path.join(runtimeRoot, 'adapters', 'cli', 'commands'), { recursive: true });
  fs.mkdirSync(path.join(runtimeRoot, 'adapters', 'filesystem'), { recursive: true });
  fs.writeFileSync(path.join(runtimeRoot, 'composition.js'), "const cmd = require('./adapters/cli/commands/foo.js');\n");
  fs.writeFileSync(
    path.join(runtimeRoot, 'adapters', 'cli', 'commands', 'foo.js'),
    "const helper = require('../../filesystem/helper.js');\nmodule.exports = { helper };\n"
  );
  fs.writeFileSync(
    path.join(runtimeRoot, 'adapters', 'filesystem', 'helper.js'),
    "const deep = require('./deep.js');\nmodule.exports = { deep };\n"
  );
  fs.writeFileSync(path.join(runtimeRoot, 'adapters', 'filesystem', 'deep.js'), "module.exports = { deep: true };\n");
  fs.writeFileSync(path.join(runtimeRoot, 'adapters', 'filesystem', 'unused.js'), "module.exports = {};\n");
  fs.mkdirSync(path.join(repoRoot, 'test'), { recursive: true });
  fs.writeFileSync(path.join(repoRoot, 'test', 'foo.test.js'), "require('../.test-runtime/lib/commands/foo.js');\n");
  return repoRoot;
}

test('isInScope accepts canonical .test-runtime layer modules and rejects source, test/ and non-js', () => {
  assert.equal(isInScope('.test-runtime/adapters/cli/commands/index.js'), true);
  assert.equal(isInScope('.test-runtime/lib/commands/foo.js'), true);
  assert.equal(isInScope('src/adapters/git/mutation-scoper.ts'), false);
  assert.equal(isInScope('test/foo.test.js'), false);
  assert.equal(isInScope('config/mutation-baseline.json'), false);
  assert.equal(isInScope('dist/index.js'), false);
  assert.equal(isInScope('dist/lib/commands/foo.js'), false);
});

test('getChangedFiles filters diff output to in-scope files only', () => {
  const gitFn = mockGit([
    [/diff --name-only/, {
      status: 0,
      stdout: [
        '.test-runtime/lib/commands/foo.js',
        '.test-runtime/lib/core/helper.js',
        'test/foo.test.js',
        'README.md',
        'config/mutation-baseline.json',
      ].join('\n') + '\n',
    }],
  ]);

  const result = getChangedFiles('main', 'HEAD', { gitFn, repoRoot: '/repo' });
  assert.deepEqual(result, ['.test-runtime/lib/commands/foo.js', '.test-runtime/lib/core/helper.js']);
});

test('getChangedFiles maps tracked .ts sources to their test-runtime .js path', () => {
  const gitFn = mockGit([
    [/diff --name-only/, {
      status: 0,
      stdout: [
        'src/adapters/cli/commands/foo.ts',
        'src/adapters/filesystem/helper.ts',
        'src/application/services/example.ts',
        'test/foo.test.js',
      ].join('\n') + '\n',
    }],
  ]);

  const result = getChangedFiles('main', 'HEAD', { gitFn, repoRoot: '/repo' });
  assert.deepEqual(result, [
    '.test-runtime/adapters/cli/commands/foo.js',
    '.test-runtime/adapters/filesystem/helper.js',
    '.test-runtime/application/services/example.js',
  ]);
});

test('toRuntimePath maps runtime-library .ts to .test-runtime .js and passes through everything else', () => {
  assert.equal(
    toRuntimePath('src/adapters/cli/commands/foo.ts'),
    '.test-runtime/adapters/cli/commands/foo.js'
  );
  assert.equal(toRuntimePath('.test-runtime/lib/commands/foo.js'), '.test-runtime/lib/commands/foo.js');
  assert.equal(toRuntimePath('README.md'), 'README.md');
  assert.equal(toRuntimePath('src/entry/px.ts'), '.test-runtime/entry/px.js');
  assert.equal(isInScope(toRuntimePath('src/entry/px.ts')), true);
});

test('getChangedFiles returns empty array when git diff fails', () => {
  const gitFn = mockGit([[/diff --name-only/, { status: 1, stdout: '', stderr: 'bad ref' }]]);
  const result = getChangedFiles('main', 'HEAD', { gitFn, repoRoot: '/repo' });
  assert.deepEqual(result, []);
});

test('extractLocalDependencies resolves relative require() specifiers', () => {
  const repoRoot = makeFixtureRepo();
  try {
    const deps = extractLocalDependencies('.test-runtime/adapters/cli/commands/foo.js', { repoRoot });
    assert.deepEqual(deps, ['.test-runtime/adapters/filesystem/helper.js']);
  } finally {
    fs.rmSync(repoRoot, { recursive: true, force: true });
  }
});

test('resolveCallees returns only direct callees (depth-1), not transitive', () => {
  const repoRoot = makeFixtureRepo();
  try {
    const callees = resolveCallees(['.test-runtime/composition.js'], { repoRoot });
    assert.deepEqual(callees, ['.test-runtime/adapters/cli/commands/foo.js']);
    assert.ok(!callees.includes('.test-runtime/adapters/filesystem/helper.js'));
    assert.ok(!callees.includes('.test-runtime/adapters/filesystem/deep.js'));
    assert.ok(!callees.includes('.test-runtime/adapters/filesystem/unused.js'));
  } finally {
    fs.rmSync(repoRoot, { recursive: true, force: true });
  }
});

test('scopeMutationTargets unions changed files and their direct callees only', () => {
  const repoRoot = makeFixtureRepo();
  try {
    const gitFn = mockGit([
      [/diff --name-only/, { status: 0, stdout: 'src/composition.ts\n' }],
    ]);
    const result = scopeMutationTargets('main', 'HEAD', { gitFn, repoRoot });
    assert.deepEqual(result.changedFiles, ['.test-runtime/composition.js']);
    assert.deepEqual(result.calleeFiles, ['.test-runtime/adapters/cli/commands/foo.js']);
    assert.deepEqual(result.targetFiles, [
      '.test-runtime/adapters/cli/commands/foo.js',
      '.test-runtime/composition.js',
    ]);
  } finally {
    fs.rmSync(repoRoot, { recursive: true, force: true });
  }
});
