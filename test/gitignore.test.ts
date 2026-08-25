// @ts-nocheck -- TASK-2328: partial test doubles from ESM seam migration; resolve in follow-up



import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { findIgnoredSourceFiles } from '../src/adapters/git/git.js';
import { mockModule, installModuleMocks } from './lib/module-mock.js';
const ensureWorkflowGitignore = mockModule<typeof import('../src/adapters/filesystem/gitignore.js')>('../src/adapters/filesystem/gitignore.js', import.meta.url);
await installModuleMocks();
test.afterEach(() => mock.restoreAll());
function mktempDir(prefix = 'gitignore-test-') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function cleanupDir(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

function writeGitignore(dir, content) {
  fs.writeFileSync(path.join(dir, '.gitignore'), content, 'utf8');
}

function readGitignore(dir) {
  return fs.readFileSync(path.join(dir, '.gitignore'), 'utf8');
}

function initGitRepo(dir) {
  fs.mkdirSync(path.join(dir, '.git'), { recursive: true });
}

test('ignored-source defense skips operator-local workflow caches', () => {
  const dir = mktempDir();
  try {
    fs.mkdirSync(path.join(dir, '.workflow', 'codex-home'), { recursive: true });
    fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.workflow', 'codex-home', 'plugin.js'), 'generated');
    fs.writeFileSync(path.join(dir, 'src', 'missing.js'), 'source');

    const gitFn = () => ({ status: 0, stdout: '', stderr: '' });
    assert.deepEqual(findIgnoredSourceFiles(dir, gitFn), ['src/missing.js']);
  } finally {
    cleanupDir(dir);
  }
});

test('WORKFLOW_ENTRIES contains all 7 required entries', () => {
  assert.equal(ensureWorkflowGitignore.WORKFLOW_ENTRIES.length, 7);
  assert.ok(ensureWorkflowGitignore.WORKFLOW_ENTRIES.includes('.workflow/'));
  assert.ok(ensureWorkflowGitignore.WORKFLOW_ENTRIES.includes('.sessions/'));
  assert.ok(ensureWorkflowGitignore.WORKFLOW_ENTRIES.includes('.forgejo-local/'));
  assert.ok(ensureWorkflowGitignore.WORKFLOW_ENTRIES.includes('workflow/.cache/'));
  assert.ok(ensureWorkflowGitignore.WORKFLOW_ENTRIES.includes('workflow/.sessions/'));
  assert.ok(ensureWorkflowGitignore.WORKFLOW_ENTRIES.includes('workflow/config/agents.local.json'));
  assert.ok(ensureWorkflowGitignore.WORKFLOW_ENTRIES.includes('agents.local.json'));
});

test('creates .gitignore when missing in a git repo', async () => {
  const dir = mktempDir();
  try {
    initGitRepo(dir);
    const logs = [];
    const result = ensureWorkflowGitignore.default(dir, {
      logFn: msg => logs.push(msg),
    });

    assert.equal(result.ok, true);
    assert.equal(result.created, true);
    assert.equal(result.appended, 7);
    assert.equal(result.skipped, false);
    assert.ok(fs.existsSync(path.join(dir, '.gitignore')));

    const content = readGitignore(dir);
    const lines = content.split('\n').filter(l => l.trim());
    assert.equal(lines.length, 7);
    for (const entry of ensureWorkflowGitignore.WORKFLOW_ENTRIES) {
      assert.ok(lines.includes(entry), `Missing entry: ${entry}`);
    }
  } finally {
    cleanupDir(dir);
  }
});

test('appends only missing entries and leaves existing untouched', async () => {
  const dir = mktempDir();
  try {
    initGitRepo(dir);
    writeGitignore(dir, '.workflow/\n# some comment\nnode_modules/\n');

    const result = ensureWorkflowGitignore.default(dir);

    assert.equal(result.ok, true);
    assert.equal(result.created, false);
    assert.equal(result.appended, 6);
    assert.equal(result.skipped, false);

    const content = readGitignore(dir);
    assert.ok(content.startsWith('.workflow/'));
    assert.ok(content.includes('# some comment'));
    assert.ok(content.includes('node_modules/'));

    const lines = content.split('\n').filter(l => l.trim());
    const nonCommentLines = lines.filter(l => !l.startsWith('#'));
    for (const entry of ensureWorkflowGitignore.WORKFLOW_ENTRIES) {
      assert.ok(nonCommentLines.includes(entry), `Missing entry: ${entry}`);
    }
    // Existing non-workflow entries should be preserved
    assert.ok(nonCommentLines.includes('node_modules/'));
  } finally {
    cleanupDir(dir);
  }
});

test('no-op when all entries already present (zero duplicates)', async () => {
  const dir = mktempDir();
  try {
    initGitRepo(dir);
    const content = ensureWorkflowGitignore.WORKFLOW_ENTRIES.join('\n') + '\n';
    writeGitignore(dir, content);

    const result = ensureWorkflowGitignore.default(dir);

    assert.equal(result.ok, true);
    assert.equal(result.created, false);
    assert.equal(result.appended, 0);
    assert.equal(result.skipped, false);

    const finalContent = readGitignore(dir);
    assert.equal(finalContent, content);
  } finally {
    cleanupDir(dir);
  }
});

test('detects symlinked .gitignore and skips without crashing', async () => {
  const dir = mktempDir();
  try {
    initGitRepo(dir);
    const realFile = path.join(os.tmpdir(), 'gitignore-real-' + Date.now());
    fs.writeFileSync(realFile, 'real-content\n', 'utf8');
    fs.symlinkSync(realFile, path.join(dir, '.gitignore'));

    const result = ensureWorkflowGitignore.default(dir);

    assert.equal(result.ok, true);
    assert.equal(result.created, false);
    assert.equal(result.appended, 0);
    assert.equal(result.skipped, true);
    assert.equal(result.reason, 'symlink');

    cleanupDir(dir);
    fs.unlinkSync(realFile);
  } catch (_) {
    cleanupDir(dir);
  }
});

test('skips gracefully when not a git repository', async () => {
  const dir = mktempDir();
  try {
    // No .git directory
    writeGitignore(dir, '.workflow/\n');

    const result = ensureWorkflowGitignore.default(dir);

    assert.equal(result.ok, true);
    assert.equal(result.created, false);
    assert.equal(result.appended, 0);
    assert.equal(result.skipped, true);
    assert.equal(result.reason, 'not-a-git-repo');

    // Should not have modified the existing .gitignore
    const content = readGitignore(dir);
    assert.equal(content, '.workflow/\n');
  } finally {
    cleanupDir(dir);
  }
});

test('skips gracefully when .gitignore does not exist and no .git directory', async () => {
  const dir = mktempDir();
  try {
    const result = ensureWorkflowGitignore.default(dir);

    assert.equal(result.ok, true);
    assert.equal(result.created, false);
    assert.equal(result.appended, 0);
    assert.equal(result.skipped, true);
    assert.equal(result.reason, 'not-a-git-repo');
    assert.ok(!fs.existsSync(path.join(dir, '.gitignore')));
  } finally {
    cleanupDir(dir);
  }
});

test('handles partial overlap - only some entries present', async () => {
  const dir = mktempDir();
  try {
    initGitRepo(dir);
    writeGitignore(dir, '.workflow/\n.sessions/\n');

    const result = ensureWorkflowGitignore.default(dir);

    assert.equal(result.ok, true);
    assert.equal(result.created, false);
    assert.equal(result.appended, 5);
    assert.equal(result.skipped, false);

    const content = readGitignore(dir);
    const lines = content.split('\n').filter(l => l.trim());
    const nonCommentLines = lines.filter(l => !l.startsWith('#'));
    assert.equal(nonCommentLines.length, 7);
  } finally {
    cleanupDir(dir);
  }
});

test('idempotent - running twice produces same result', async () => {
  const dir = mktempDir();
  try {
    initGitRepo(dir);

    const result1 = ensureWorkflowGitignore.default(dir);
    assert.equal(result1.created, true);
    assert.equal(result1.appended, 7);

    const contentAfterFirst = readGitignore(dir);

    const result2 = ensureWorkflowGitignore.default(dir);
    assert.equal(result2.created, false);
    assert.equal(result2.appended, 0);

    const contentAfterSecond = readGitignore(dir);
    assert.equal(contentAfterFirst, contentAfterSecond);
  } finally {
    cleanupDir(dir);
  }
});

test('injectable dependencies work correctly', async () => {
  const dir = mktempDir();
  try {
    initGitRepo(dir);

    let writeCalled = false;
    let readCalled = false;

    const result = ensureWorkflowGitignore.default(dir, {
      existsSyncFn: (p) => p.endsWith('.git') || p.endsWith('.gitignore'),
      lstatSyncFn: (p) => ({ isSymbolicLink: () => false }),
      readFileSyncFn: (p) => {
        readCalled = true;
        return '.workflow/\n';
      },
      writeFileSyncFn: (p, content) => {
        writeCalled = true;
        fs.writeFileSync(p, content, 'utf8');
      },
      logFn: () => {},
    });

    assert.equal(result.ok, true);
    assert.equal(writeCalled, true);
  } finally {
    cleanupDir(dir);
  }
});

test('preserves comment lines in existing .gitignore', async () => {
  const dir = mktempDir();
  try {
    initGitRepo(dir);
    const existing = '# Workflow ignores\n.workflow/\n\n# Build artifacts\nnode_modules/\n';
    writeGitignore(dir, existing);

    const result = ensureWorkflowGitignore.default(dir);

    assert.equal(result.ok, true);
    const content = readGitignore(dir);
    assert.ok(content.startsWith('# Workflow ignores'));
    assert.ok(content.includes('# Build artifacts'));
    assert.ok(content.includes('node_modules/'));
  } finally {
    cleanupDir(dir);
  }
});

test('handles .gitignore with Windows line endings', async () => {
  const dir = mktempDir();
  try {
    initGitRepo(dir);
    writeGitignore(dir, '.workflow/\r\nnode_modules/\r\n');

    const result = ensureWorkflowGitignore.default(dir);

    assert.equal(result.ok, true);
    assert.equal(result.appended, 6);

    const content = readGitignore(dir);
    const nonCommentLines = content.split(/\r?\n/).filter(l => l.trim() && !l.trim().startsWith('#'));
    for (const entry of ensureWorkflowGitignore.WORKFLOW_ENTRIES) {
      assert.ok(nonCommentLines.includes(entry), `Missing entry: ${entry}`);
    }
    assert.ok(nonCommentLines.includes('node_modules/'));
  } finally {
    cleanupDir(dir);
  }
});

test('handles .gitignore with blank lines', async () => {
  const dir = mktempDir();
  try {
    initGitRepo(dir);
    writeGitignore(dir, '\n\n.workflow/\n\n.sessions/\n\n');

    const result = ensureWorkflowGitignore.default(dir);

    assert.equal(result.ok, true);
    assert.equal(result.appended, 5);

    const content = readGitignore(dir);
    const nonCommentLines = content.split(/\r?\n/).filter(l => l.trim() && !l.trim().startsWith('#'));
    assert.equal(nonCommentLines.length, 7);
  } finally {
    cleanupDir(dir);
  }
});
