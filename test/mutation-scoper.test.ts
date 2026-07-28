
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
} = require('../.test-runtime/lib/core/mutation-scoper');

const mockGit = (responses) => (args) => {
  const cmd = args.join(' ');
  for (const [pattern, response] of responses) {
    if (pattern instanceof RegExp ? pattern.test(cmd) : cmd.includes(pattern)) {
      return response;
    }
  }
  return { status: 0, stdout: '', stderr: '' };
};

// Mirrors the tree `scripts/build-test-runtime.ts` emits: transpiled CommonJS
// under .test-runtime/lib/, with index.js as the library entry point.
function makeFixtureRepo() {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mutation-scoper-'));
  const libRoot = path.join(repoRoot, '.test-runtime', 'lib');
  fs.mkdirSync(path.join(libRoot, 'commands'), { recursive: true });
  fs.mkdirSync(path.join(libRoot, 'core'), { recursive: true });
  fs.writeFileSync(path.join(libRoot, 'index.js'), "const cmd = require('./commands/foo.js');\n");
  fs.writeFileSync(
    path.join(libRoot, 'commands', 'foo.js'),
    "const helper = require('../core/helper.js');\nmodule.exports = { helper };\n"
  );
  fs.writeFileSync(
    path.join(libRoot, 'core', 'helper.js'),
    "const deep = require('./deep.js');\nmodule.exports = { deep };\n"
  );
  fs.writeFileSync(path.join(libRoot, 'core', 'deep.js'), "module.exports = { deep: true };\n");
  fs.writeFileSync(path.join(libRoot, 'core', 'unused.js'), "module.exports = {};\n");
  fs.mkdirSync(path.join(repoRoot, 'test'), { recursive: true });
  fs.writeFileSync(path.join(repoRoot, 'test', 'foo.test.js'), "require('../.test-runtime/lib/commands/foo.js');\n");
  return repoRoot;
}

test('isInScope accepts .test-runtime/lib/index.js and .test-runtime/lib/**/*.js, rejects source, test/ and non-js', () => {
  assert.equal(isInScope('.test-runtime/lib/index.js'), true);
  assert.equal(isInScope('.test-runtime/lib/commands/foo.js'), true);
  assert.equal(isInScope('src/platform/runtime/lib/core/mutation-scoper.ts'), false);
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
        'src/platform/runtime/lib/commands/foo.ts',
        'src/platform/runtime/lib/core/helper.ts',
        'src/platform/runtime/lib/index.ts',
        'test/foo.test.js',
      ].join('\n') + '\n',
    }],
  ]);

  const result = getChangedFiles('main', 'HEAD', { gitFn, repoRoot: '/repo' });
  assert.deepEqual(result, [
    '.test-runtime/lib/commands/foo.js',
    '.test-runtime/lib/core/helper.js',
    '.test-runtime/lib/index.js',
  ]);
});

test('toRuntimePath maps runtime-library .ts to .test-runtime .js and passes through everything else', () => {
  assert.equal(
    toRuntimePath('src/platform/runtime/lib/commands/foo.ts'),
    '.test-runtime/lib/commands/foo.js'
  );
  assert.equal(toRuntimePath('.test-runtime/lib/commands/foo.js'), '.test-runtime/lib/commands/foo.js');
  assert.equal(toRuntimePath('README.md'), 'README.md');
  // Outside the runtime library source root: passed through, then dropped by isInScope.
  assert.equal(toRuntimePath('src/entry/px.ts'), 'src/entry/px.ts');
  assert.equal(isInScope(toRuntimePath('src/entry/px.ts')), false);
});

test('getChangedFiles returns empty array when git diff fails', () => {
  const gitFn = mockGit([[/diff --name-only/, { status: 1, stdout: '', stderr: 'bad ref' }]]);
  const result = getChangedFiles('main', 'HEAD', { gitFn, repoRoot: '/repo' });
  assert.deepEqual(result, []);
});

test('extractLocalDependencies resolves relative require() specifiers', () => {
  const repoRoot = makeFixtureRepo();
  try {
    const deps = extractLocalDependencies('.test-runtime/lib/commands/foo.js', { repoRoot });
    assert.deepEqual(deps, ['.test-runtime/lib/core/helper.js']);
  } finally {
    fs.rmSync(repoRoot, { recursive: true, force: true });
  }
});

test('resolveCallees returns only direct callees (depth-1), not transitive', () => {
  const repoRoot = makeFixtureRepo();
  try {
    const callees = resolveCallees(['.test-runtime/lib/index.js'], { repoRoot });
    assert.deepEqual(callees, ['.test-runtime/lib/commands/foo.js']);
    assert.ok(!callees.includes('.test-runtime/lib/core/helper.js'));
    assert.ok(!callees.includes('.test-runtime/lib/core/deep.js'));
    assert.ok(!callees.includes('.test-runtime/lib/core/unused.js'));
  } finally {
    fs.rmSync(repoRoot, { recursive: true, force: true });
  }
});

test('scopeMutationTargets unions changed files and their direct callees only', () => {
  const repoRoot = makeFixtureRepo();
  try {
    const gitFn = mockGit([
      [/diff --name-only/, { status: 0, stdout: 'src/platform/runtime/lib/index.ts\n' }],
    ]);
    const result = scopeMutationTargets('main', 'HEAD', { gitFn, repoRoot });
    assert.deepEqual(result.changedFiles, ['.test-runtime/lib/index.js']);
    assert.deepEqual(result.calleeFiles, ['.test-runtime/lib/commands/foo.js']);
    assert.deepEqual(result.targetFiles, [
      '.test-runtime/lib/commands/foo.js',
      '.test-runtime/lib/index.js',
    ]);
  } finally {
    fs.rmSync(repoRoot, { recursive: true, force: true });
  }
});
