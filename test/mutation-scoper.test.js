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
} = require('../dist/lib/core/mutation-scoper');

const mockGit = (responses) => (args) => {
  const cmd = args.join(' ');
  for (const [pattern, response] of responses) {
    if (pattern instanceof RegExp ? pattern.test(cmd) : cmd.includes(pattern)) {
      return response;
    }
  }
  return { status: 0, stdout: '', stderr: '' };
};

function makeFixtureRepo() {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mutation-scoper-'));
  fs.mkdirSync(path.join(repoRoot, 'dist', 'lib', 'commands'), { recursive: true });
  fs.mkdirSync(path.join(repoRoot, 'dist', 'lib', 'core'), { recursive: true });
  fs.writeFileSync(path.join(repoRoot, 'dist', 'index.js'), "const cmd = require('./lib/commands/foo.js');\n");
  fs.writeFileSync(
    path.join(repoRoot, 'dist', 'lib', 'commands', 'foo.js'),
    "const helper = require('../core/helper.js');\nmodule.exports = { helper };\n"
  );
  fs.writeFileSync(
    path.join(repoRoot, 'dist', 'lib', 'core', 'helper.js'),
    "const deep = require('./deep.js');\nmodule.exports = { deep };\n"
  );
  fs.writeFileSync(path.join(repoRoot, 'dist', 'lib', 'core', 'deep.js'), "module.exports = { deep: true };\n");
  fs.writeFileSync(path.join(repoRoot, 'dist', 'lib', 'core', 'unused.js'), "module.exports = {};\n");
  fs.mkdirSync(path.join(repoRoot, 'test'), { recursive: true });
  fs.writeFileSync(path.join(repoRoot, 'test', 'foo.test.js'), "require('../dist/lib/commands/foo.js');\n");
  return repoRoot;
}

test('isInScope accepts dist/index.js and dist/lib/**/*.js, rejects source, test/ and non-js', () => {
  assert.equal(isInScope('dist/index.js'), true);
  assert.equal(isInScope('dist/lib/commands/foo.js'), true);
  assert.equal(isInScope('lib/core/mutation-scoper.ts'), false);
  assert.equal(isInScope('test/foo.test.js'), false);
  assert.equal(isInScope('config/mutation-baseline.json'), false);
});

test('getChangedFiles filters diff output to in-scope files only', () => {
  const gitFn = mockGit([
    [/diff --name-only/, {
      status: 0,
      stdout: [
        'dist/lib/commands/foo.js',
        'dist/lib/core/helper.js',
        'test/foo.test.js',
        'README.md',
        'config/mutation-baseline.json',
      ].join('\n') + '\n',
    }],
  ]);

  const result = getChangedFiles('main', 'HEAD', { gitFn, repoRoot: '/repo' });
  assert.deepEqual(result, ['dist/lib/commands/foo.js', 'dist/lib/core/helper.js']);
});

test('getChangedFiles maps tracked .ts sources to their dist runtime .js path', () => {
  const gitFn = mockGit([
    [/diff --name-only/, {
      status: 0,
      stdout: [
        'lib/commands/foo.ts',
        'lib/core/helper.ts',
        'index.ts',
        'test/foo.test.js',
      ].join('\n') + '\n',
    }],
  ]);

  const result = getChangedFiles('main', 'HEAD', { gitFn, repoRoot: '/repo' });
  assert.deepEqual(result, ['dist/index.js', 'dist/lib/commands/foo.js', 'dist/lib/core/helper.js']);
});

test('toRuntimePath maps .ts to dist .js and passes through runtime paths', () => {
  assert.equal(toRuntimePath('lib/commands/foo.ts'), 'dist/lib/commands/foo.js');
  assert.equal(toRuntimePath('dist/lib/commands/foo.js'), 'dist/lib/commands/foo.js');
  assert.equal(toRuntimePath('README.md'), 'README.md');
});

test('getChangedFiles returns empty array when git diff fails', () => {
  const gitFn = mockGit([[/diff --name-only/, { status: 1, stdout: '', stderr: 'bad ref' }]]);
  const result = getChangedFiles('main', 'HEAD', { gitFn, repoRoot: '/repo' });
  assert.deepEqual(result, []);
});

test('extractLocalDependencies resolves relative require() specifiers', () => {
  const repoRoot = makeFixtureRepo();
  try {
    const deps = extractLocalDependencies('dist/lib/commands/foo.js', { repoRoot });
    assert.deepEqual(deps, ['dist/lib/core/helper.js']);
  } finally {
    fs.rmSync(repoRoot, { recursive: true, force: true });
  }
});

test('resolveCallees returns only direct callees (depth-1), not transitive', () => {
  const repoRoot = makeFixtureRepo();
  try {
    const callees = resolveCallees(['dist/index.js'], { repoRoot });
    assert.deepEqual(callees, ['dist/lib/commands/foo.js']);
    assert.ok(!callees.includes('dist/lib/core/helper.js'));
    assert.ok(!callees.includes('dist/lib/core/deep.js'));
    assert.ok(!callees.includes('dist/lib/core/unused.js'));
  } finally {
    fs.rmSync(repoRoot, { recursive: true, force: true });
  }
});

test('scopeMutationTargets unions changed files and their direct callees only', () => {
  const repoRoot = makeFixtureRepo();
  try {
    const gitFn = mockGit([
      [/diff --name-only/, { status: 0, stdout: 'index.ts\n' }],
    ]);
    const result = scopeMutationTargets('main', 'HEAD', { gitFn, repoRoot });
    assert.deepEqual(result.changedFiles, ['dist/index.js']);
    assert.deepEqual(result.calleeFiles, ['dist/lib/commands/foo.js']);
    assert.deepEqual(result.targetFiles, [
      'dist/index.js',
      'dist/lib/commands/foo.js',
    ]);
  } finally {
    fs.rmSync(repoRoot, { recursive: true, force: true });
  }
});
