import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  scopeMutationTargets,
  getChangedFiles,
  resolveCallees,
  extractLocalDependencies,
  isInScope,
} from '../src/adapters/git/mutation-scoper.js';

const mockGit = (responses) => (args) => {
  const cmd = args.join(' ');
  for (const [pattern, response] of responses) {
    if (pattern instanceof RegExp ? pattern.test(cmd) : cmd.includes(pattern)) {
      return response;
    }
  }
  return { status: 0, stdout: '', stderr: '' };
};

// Mirrors the canonical `src/` layer tree the scoper targets after TASK-2328
// retired the transpiled CommonJS mirror. ESM specifiers name the emitted
// `.js`, which the scoper resolves back onto the authored `.ts`.
function makeFixtureRepo() {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mutation-scoper-'));
  const srcRoot = path.join(repoRoot, 'src');
  fs.mkdirSync(path.join(srcRoot, 'adapters', 'cli', 'commands'), { recursive: true });
  fs.mkdirSync(path.join(srcRoot, 'adapters', 'filesystem'), { recursive: true });
  fs.writeFileSync(
    path.join(srcRoot, 'composition.ts'),
    "import { foo } from './adapters/cli/commands/foo.js';\nexport { foo };\n",
  );
  fs.writeFileSync(
    path.join(srcRoot, 'adapters', 'cli', 'commands', 'foo.ts'),
    "import { helper } from '../../filesystem/helper.js';\nexport const foo = helper;\n",
  );
  fs.writeFileSync(
    path.join(srcRoot, 'adapters', 'filesystem', 'helper.ts'),
    "import { deep } from './deep.js';\nexport const helper = deep;\n",
  );
  fs.writeFileSync(path.join(srcRoot, 'adapters', 'filesystem', 'deep.ts'), 'export const deep = true;\n');
  fs.writeFileSync(path.join(srcRoot, 'adapters', 'filesystem', 'unused.ts'), 'export const unused = true;\n');
  fs.mkdirSync(path.join(repoRoot, 'test'), { recursive: true });
  fs.writeFileSync(
    path.join(repoRoot, 'test', 'foo.test.ts'),
    "import { foo } from '../src/adapters/cli/commands/foo.js';\nexport { foo };\n",
  );
  return repoRoot;
}

test('isInScope accepts canonical src/ layer modules and rejects test/, config and build output', () => {
  assert.equal(isInScope('src/adapters/cli/commands/index.ts'), true);
  assert.equal(isInScope('src/adapters/git/mutation-scoper.ts'), true);
  assert.equal(isInScope('src/domain/mission.d.ts'), false);
  assert.equal(isInScope('test/foo.test.ts'), false);
  assert.equal(isInScope('config/mutation-baseline.json'), false);
  assert.equal(isInScope('build/px.mjs'), false);
  assert.equal(isInScope('scripts/build-canonical-bundle.ts'), false);
});

test('getChangedFiles filters diff output to in-scope source files only', () => {
  const gitFn = mockGit([
    [/diff --name-only/, {
      status: 0,
      stdout: [
        'src/adapters/cli/commands/foo.ts',
        'src/adapters/filesystem/helper.ts',
        'src/application/services/example.ts',
        'test/foo.test.ts',
        'README.md',
        'config/mutation-baseline.json',
      ].join('\n') + '\n',
    }],
  ]);

  const result = getChangedFiles('main', 'HEAD', { gitFn, repoRoot: '/repo' });
  assert.deepEqual(result, [
    'src/adapters/cli/commands/foo.ts',
    'src/adapters/filesystem/helper.ts',
    'src/application/services/example.ts',
  ]);
});

test('getChangedFiles returns empty array when git diff fails', () => {
  const gitFn = mockGit([[/diff --name-only/, { status: 1, stdout: '', stderr: 'bad ref' }]]);
  const result = getChangedFiles('main', 'HEAD', { gitFn, repoRoot: '/repo' });
  assert.deepEqual(result, []);
});

test('extractLocalDependencies resolves relative ESM import specifiers back onto TypeScript sources', () => {
  const repoRoot = makeFixtureRepo();
  try {
    const deps = extractLocalDependencies('src/adapters/cli/commands/foo.ts', { repoRoot });
    assert.deepEqual(deps, ['src/adapters/filesystem/helper.ts']);
  } finally {
    fs.rmSync(repoRoot, { recursive: true, force: true });
  }
});

test('resolveCallees returns only direct callees (depth-1), not transitive', () => {
  const repoRoot = makeFixtureRepo();
  try {
    const callees = resolveCallees(['src/composition.ts'], { repoRoot });
    assert.deepEqual(callees, ['src/adapters/cli/commands/foo.ts']);
    assert.ok(!callees.includes('src/adapters/filesystem/helper.ts'));
    assert.ok(!callees.includes('src/adapters/filesystem/deep.ts'));
    assert.ok(!callees.includes('src/adapters/filesystem/unused.ts'));
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
    assert.deepEqual(result.changedFiles, ['src/composition.ts']);
    assert.deepEqual(result.calleeFiles, ['src/adapters/cli/commands/foo.ts']);
    assert.deepEqual(result.targetFiles, [
      'src/adapters/cli/commands/foo.ts',
      'src/composition.ts',
    ]);
  } finally {
    fs.rmSync(repoRoot, { recursive: true, force: true });
  }
});
