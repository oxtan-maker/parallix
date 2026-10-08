// @ts-nocheck -- TASK-2328: partial test doubles from ESM seam migration

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'node:url';
import { mkdtempAt } from '../../../helpers/temp-dir.js';
import {
  canonicalSourceContainsFile,
  collectGoalCheckEvidenceRows,
  collectRepoTestNames,
  evidenceCellHasVerifiableReference,
  findUnverifiableGoalCheckRow,
  formatStaticReviewFindings,
  formatStaticReviewSuccess,
  performStaticReview,
} from '../../../../src/adapters/review/review-static-evidence.js';
import { findUnverifiableRecordedRow } from '../../../../src/application/static-evidence.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..', '..', '..');

// ============================================================================
// formatStaticReviewFindings
// ============================================================================

test('formatStaticReviewFindings formats single finding', () => {
  const result = formatStaticReviewFindings(['Finding 1']);
  assert.ok(result.includes('1. Finding 1'));
  assert.ok(result.includes('Auto-launching the act-on-review loop'));
});

test('formatStaticReviewFindings formats multiple findings', () => {
  const result = formatStaticReviewFindings(['Finding 1', 'Finding 2']);
  assert.ok(result.includes('1. Finding 1'));
  assert.ok(result.includes('2. Finding 2'));
});

test('formatStaticReviewFindings handles empty findings array', () => {
  const result = formatStaticReviewFindings([]);
  assert.ok(result.includes('Static review found the following issue(s)'));
  assert.ok(!result.match(/^\d+\./));
});

// ============================================================================
// formatStaticReviewSuccess
// ============================================================================

test('formatStaticReviewSuccess includes slug', () => {
  const result = formatStaticReviewSuccess('task-1234');
  assert.ok(result.includes('task-1234'));
  assert.ok(result.includes('found zero issues'));
});

test('formatStaticReviewSuccess lists checked items', () => {
  const result = formatStaticReviewSuccess('test-slug');
  assert.ok(result.includes('mission diff against the primary branch'));
  assert.ok(result.includes('checkpoint presence'));
  assert.ok(result.includes('final checkpoint Goal Check evidence'));
});

test('review static evidence preserves its goal-check helper exports', () => {
  for (const helper of [
    collectGoalCheckEvidenceRows,
    collectRepoTestNames,
    canonicalSourceContainsFile,
    evidenceCellHasVerifiableReference,
    findUnverifiableGoalCheckRow,
  ]) {
    assert.equal(typeof helper, 'function');
  }
});

// ============================================================================
// performStaticReview — valid evidence paths
// ============================================================================

test('performStaticReview accepts Goal Check with recognized repo command', () => {
  const tmpDir = mkdtempAt(REPO_ROOT, '.tmp-review-evidence-');
  const missionDir = path.join(tmpDir, 'missions', 'task-evidence');
  const scriptsDir = path.join(tmpDir, 'scripts');
  fs.mkdirSync(missionDir, { recursive: true });
  fs.mkdirSync(scriptsDir, { recursive: true });
  fs.writeFileSync(path.join(scriptsDir, 'verify-local.sh'), '#!/bin/bash\n', 'utf8');

  const checkpoint = path.join(missionDir, 'CP-1.md');
  fs.writeFileSync(checkpoint, `# Checkpoint 1

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Static analysis | \`./scripts/verify-local.sh static-analysis\` | PASS |
`, 'utf8');

  try {
    const result = performStaticReview('task-evidence', {
      log: () => {},
      findMissionDir: () => missionDir,
      findCheckpoints: () => [checkpoint],
      readFileSync: fs.readFileSync,
      run: () => ({ status: 0, stdout: '' }),
      resolveWorktree: () => tmpDir,
      rootDir: tmpDir,
    });
    assert.equal(result.ok, true, `Expected pass but got findings: ${result.findings.join('; ')}`);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('performStaticReview accepts Goal Check with recognized test name', () => {
  const tmpDir = mkdtempAt(REPO_ROOT, '.tmp-review-evidence-');
  const missionDir = path.join(tmpDir, 'missions', 'task-testname');
  const testDir = path.join(tmpDir, 'test');
  fs.mkdirSync(missionDir, { recursive: true });
  fs.mkdirSync(testDir, { recursive: true });

  // Create a test file with a recognizable test name
  fs.writeFileSync(
    path.join(testDir, 'example.test.ts'),
    `import test from 'node:test';\ntest('formatStaticReviewFindings formats single finding', () => {});`,
    'utf8'
  );

  const checkpoint = path.join(missionDir, 'CP-1.md');
  fs.writeFileSync(checkpoint, `# Checkpoint 1

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Formatting coverage | \`"formatStaticReviewFindings formats single finding"\` | PASS |
`, 'utf8');

  try {
    const result = performStaticReview('task-testname', {
      log: () => {},
      findMissionDir: () => missionDir,
      findCheckpoints: () => [checkpoint],
      readFileSync: fs.readFileSync,
      run: () => ({ status: 0, stdout: '' }),
      resolveWorktree: () => tmpDir,
      rootDir: tmpDir,
    });
    assert.equal(result.ok, true, `Expected pass but got findings: ${result.findings.join('; ')}`);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('performStaticReview accepts Goal Check with test file path', () => {
  const tmpDir = mkdtempAt(REPO_ROOT, '.tmp-review-evidence-');
  const missionDir = path.join(tmpDir, 'missions', 'task-testpath');
  const testDir = path.join(tmpDir, 'test');
  fs.mkdirSync(missionDir, { recursive: true });
  fs.mkdirSync(testDir, { recursive: true });
  fs.writeFileSync(path.join(testDir, 'example.test.ts'), '');

  const checkpoint = path.join(missionDir, 'CP-1.md');
  fs.writeFileSync(checkpoint, `# Checkpoint 1

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Test coverage | \`test/example.test.ts\` | PASS |
`, 'utf8');

  try {
    const result = performStaticReview('task-testpath', {
      log: () => {},
      findMissionDir: () => missionDir,
      findCheckpoints: () => [checkpoint],
      readFileSync: fs.readFileSync,
      run: () => ({ status: 0, stdout: '' }),
      resolveWorktree: () => tmpDir,
      rootDir: tmpDir,
    });
    assert.equal(result.ok, true, `Expected pass but got findings: ${result.findings.join('; ')}`);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

// ============================================================================
// performStaticReview — invalid evidence paths
// ============================================================================

test('performStaticReview accepts a bare repo path whose file exists (may contain spaces)', () => {
  const tmpDir = mkdtempAt(REPO_ROOT, '.tmp-review-evidence-');
  const missionDir = path.join(tmpDir, 'missions', 'task-spacepath');
  const backlogDir = path.join(tmpDir, 'backlog', 'tasks');
  fs.mkdirSync(missionDir, { recursive: true });
  fs.mkdirSync(backlogDir, { recursive: true });

  // A follow-up task file whose name contains spaces — the :line pattern and
  // the command-prefix rule both miss these; only a bare-path check accepts it.
  const spacedFile = path.join(backlogDir, 'task-2437.01 - design-fidelity-audit-vs-reference.md');
  fs.writeFileSync(spacedFile, '# TASK-2437.01\n', 'utf8');

  const checkpoint = path.join(missionDir, 'CP-1.md');
  fs.writeFileSync(
    checkpoint,
    `# Checkpoint 1

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Deferred gate | follow-up task \`backlog/tasks/task-2437.01 - design-fidelity-audit-vs-reference.md\` | FOLLOW-UP |
`,
    'utf8'
  );

  try {
    // The fixture lives under the temp dir, so the review worktree root the
    // gate resolves against must be that temp dir, not REPO_ROOT. Passing
    // REPO_ROOT (as a prior version of this test did) only passed because a
    // real backlog/tasks file happened to exist at the repository root; the
    // assertion should depend on the fixture, not on repo layout.
    const result = performStaticReview('task-spacepath', {
      log: () => {},
      findMissionDir: () => missionDir,
      findCheckpoints: () => [checkpoint],
      readFileSync: fs.readFileSync,
      run: () => ({ status: 0, stdout: '' }),
      // Resolve evidence against the fixture root, not the live checkout: the
      // cited follow-up task file is created here, so the case no longer breaks
      // when the real backlog task moves from `tasks/` to `completed/`.
      resolveWorktree: () => tmpDir,
      rootDir: tmpDir,
    });
    assert.equal(result.ok, true, `Expected pass but got findings: ${result.findings.join('; ')}`);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('performStaticReview accepts a bare repo path without a :line suffix', () => {
  const tmpDir = mkdtempAt(REPO_ROOT, '.tmp-review-evidence-');
  const missionDir = path.join(tmpDir, 'missions', 'task-barepath');
  const scriptsDir = path.join(tmpDir, 'scripts');
  fs.mkdirSync(missionDir, { recursive: true });
  fs.mkdirSync(scriptsDir, { recursive: true });
  fs.writeFileSync(path.join(scriptsDir, 'verify-local.sh'), '#!/bin/bash\n', 'utf8');

  const checkpoint = path.join(missionDir, 'CP-1.md');
  fs.writeFileSync(
    checkpoint,
    `# Checkpoint 1

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Docs | \`scripts/verify-local.sh\` | PASS |
`,
    'utf8'
  );

  try {
    const result = performStaticReview('task-barepath', {
      log: () => {},
      findMissionDir: () => missionDir,
      findCheckpoints: () => [checkpoint],
      readFileSync: fs.readFileSync,
      run: () => ({ status: 0, stdout: '' }),
      resolveWorktree: () => tmpDir,
      rootDir: tmpDir,
    });
    assert.equal(result.ok, true, `Expected pass but got findings: ${result.findings.join('; ')}`);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('performStaticReview accepts a bare repo path named mid-sentence', () => {
  const tmpDir = mkdtempAt(REPO_ROOT, '.tmp-review-evidence-');
  const missionDir = path.join(tmpDir, 'missions', 'task-prosepath');
  fs.mkdirSync(missionDir, { recursive: true });
  fs.writeFileSync(path.join(tmpDir, 'package.json'), '{}');

  const checkpoint = path.join(missionDir, 'CP-1.md');
  fs.writeFileSync(
    checkpoint,
    `# Checkpoint 1

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Packaging | the shipped layout is described by package.json | PASS |
`,
    'utf8'
  );

  try {
    const result = performStaticReview('task-prosepath', {
      log: () => {},
      findMissionDir: () => missionDir,
      findCheckpoints: () => [checkpoint],
      readFileSync: fs.readFileSync,
      run: () => ({ status: 0, stdout: '' }),
      resolveWorktree: () => tmpDir,
      rootDir: tmpDir,
    });
    assert.equal(result.ok, true, `Expected pass but got findings: ${result.findings.join('; ')}`);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('performStaticReview rejects placeholder-only evidence', () => {
  const tmpDir = mkdtempAt(REPO_ROOT, '.tmp-review-evidence-');
  const missionDir = path.join(tmpDir, 'missions', 'task-placeholder');
  fs.mkdirSync(missionDir, { recursive: true });

  const checkpoint = path.join(missionDir, 'CP-1.md');
  fs.writeFileSync(checkpoint, `# Checkpoint 1

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Helper coverage | \`TBD\` | TODO |
`, 'utf8');

  try {
    const result = performStaticReview('task-placeholder', {
      log: () => {},
      findMissionDir: () => missionDir,
      findCheckpoints: () => [checkpoint],
      readFileSync: fs.readFileSync,
      run: () => ({ status: 0, stdout: '' }),
      resolveWorktree: () => tmpDir,
      rootDir: tmpDir,
    });
    assert.equal(result.ok, false, 'Expected failure for placeholder evidence');
    assert.ok(result.findings.some(f => f.includes('verifiable reference')));
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('performStaticReview rejects separator-only table', () => {
  const tmpDir = mkdtempAt(REPO_ROOT, '.tmp-review-evidence-');
  const missionDir = path.join(tmpDir, 'missions', 'task-separator');
  fs.mkdirSync(missionDir, { recursive: true });

  const checkpoint = path.join(missionDir, 'CP-1.md');
  fs.writeFileSync(checkpoint, `# Checkpoint 1

## Goal Check

|---|---|---|
`, 'utf8');

  try {
    const result = performStaticReview('task-separator', {
      log: () => {},
      findMissionDir: () => missionDir,
      findCheckpoints: () => [checkpoint],
      readFileSync: fs.readFileSync,
      run: () => ({ status: 0, stdout: '' }),
      resolveWorktree: () => tmpDir,
      rootDir: tmpDir,
    });
    assert.equal(result.ok, false, 'Expected failure for separator-only table');
    assert.ok(result.findings.some(f => f.includes('no evidence rows')));
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('performStaticReview rejects prose-only evidence', () => {
  const tmpDir = mkdtempAt(REPO_ROOT, '.tmp-review-evidence-');
  const missionDir = path.join(tmpDir, 'missions', 'task-prose');
  fs.mkdirSync(missionDir, { recursive: true });

  const checkpoint = path.join(missionDir, 'CP-1.md');
  fs.writeFileSync(checkpoint, `# Checkpoint 1

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Coverage | All tests pass successfully | PASS |
`, 'utf8');

  try {
    const result = performStaticReview('task-prose', {
      log: () => {},
      findMissionDir: () => missionDir,
      findCheckpoints: () => [checkpoint],
      readFileSync: fs.readFileSync,
      run: () => ({ status: 0, stdout: '' }),
      resolveWorktree: () => tmpDir,
      rootDir: tmpDir,
    });
    assert.equal(result.ok, false, 'Expected failure for prose-only evidence');
    assert.ok(result.findings.some(f => f.includes('verifiable reference')));
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

// ============================================================================
// Shared reference semantics — recording and handoff (TASK-2662)
// ============================================================================

/** An in-memory repository: `files` maps repository-relative paths to content. */
function memoryRepository(files: Record<string, string>) {
  const root = '/repo';
  const absolute = Object.fromEntries(Object.entries(files).map(([file, content]) => [path.join(root, file), content]));
  const children = (dir: string) => [...new Set(Object.keys(absolute)
    .filter(file => file.startsWith(`${dir}/`))
    .map(file => file.slice(dir.length + 1).split('/')[0]))];
  const isFile = (target: string) => target in absolute;
  const isDir = (target: string) => Object.keys(absolute).some(file => file.startsWith(`${target}/`));
  return {
    root,
    fileSystem: {
      existsSync: (target: string) => isFile(target) || isDir(target),
      readText: (target: string) => absolute[target] ?? '',
      listNames: children,
      listEntries: (dir: string) => children(dir).map(name => ({
        name, isFile: () => isFile(path.join(dir, name)), isDirectory: () => isDir(path.join(dir, name)),
      })),
    },
  };
}

const CASE_MODULE = 'test/unit/interfaces/web/web-board-interaction.cases.ts';
const caseRepository = () => memoryRepository({
  [CASE_MODULE]: "test('rapid repeated activation synchronously sends one request (TASK-2657)', async () => {});\n",
});

test('exact quoted test names in owning .cases.ts modules are verifiable (TASK-2662)', () => {
  const { root, fileSystem } = caseRepository();
  assert.ok(collectRepoTestNames(fileSystem, root).has('rapid repeated activation synchronously sends one request (TASK-2657)'));
  const row = { criterion: 'one request per activation', evidence: '"rapid repeated activation synchronously sends one request (TASK-2657)"' };
  assert.equal(findUnverifiableRecordedRow(fileSystem, [row], root), null);
});

test('nonexistent test names and test-file paths are rejected (TASK-2662)', () => {
  const { root, fileSystem } = caseRepository();
  for (const evidence of ['"a test name nobody wrote"', '`test/unit/missing-suite.test.ts`']) {
    const unverifiable = findUnverifiableRecordedRow(fileSystem, [{ criterion: 'covered', evidence }], root);
    assert.ok(unverifiable, `${evidence} must not be accepted`);
    assert.match(unverifiable.message, /cites no verifiable reference/);
  }
});

test('a basename-only case module reference is rejected with a repository-relative path hint (TASK-2657)', () => {
  const { root, fileSystem } = caseRepository();
  const basename = findUnverifiableRecordedRow(fileSystem, [{ criterion: 'board interaction', evidence: 'web-board-interaction.cases.ts' }], root);
  assert.ok(basename, 'a basename does not resolve from the repository root');
  assert.match(basename.message, /`web-board-interaction\.cases\.ts` does not exist relative to the repository root; cite the repository-relative path/);
  assert.match(basename.message, /Offending row: \| board interaction \| web-board-interaction\.cases\.ts \|/);
  assert.equal(findUnverifiableRecordedRow(fileSystem, [{ criterion: 'board interaction', evidence: CASE_MODULE }], root), null);
});

test('existing files outside the repository are not evidence, including file:line and command forms (TASK-2662)', () => {
  const outside = { '/etc/ssl/openssl.cnf': '', '/code/package.json': '' };
  const { root, fileSystem } = caseRepository();
  const escaping = { ...fileSystem, existsSync: (target: string) => target in outside || fileSystem.existsSync(target) };
  for (const evidence of ['/etc/ssl/openssl.cnf', '/etc/ssl/openssl.cnf:3', '../code/package.json', '`cat ../code/package.json`', '`./../code/package.json`']) {
    assert.ok(findUnverifiableRecordedRow(escaping, [{ criterion: 'covered', evidence }], root), `${evidence} lies outside the repository`);
  }
  assert.equal(findUnverifiableRecordedRow(escaping, [{ criterion: 'covered', evidence: `./${CASE_MODULE}:1` }], root), null);
});

test('the legacy lib/ file:line alias still respects the root-escape rule (TASK-2662)', () => {
  // canonicalSourceContainsFile maps a compiled lib/ path to its src/ basename;
  // the alias must not let a lib/../../ form reach that fallback.
  const srcRepo = memoryRepository({ 'src/static-evidence.ts': 'export const x = 1\n' });
  for (const evidence of ['lib/../../static-evidence.ts:1', 'lib/../../../etc/passwd:1']) {
    const unverifiable = findUnverifiableRecordedRow(srcRepo.fileSystem, [{ criterion: 'covered', evidence }], srcRepo.root);
    assert.ok(unverifiable, `${evidence} escapes the repository and must not be accepted`);
    assert.match(unverifiable.message, /cites no verifiable reference/);
  }
  assert.equal(findUnverifiableRecordedRow(srcRepo.fileSystem, [{ criterion: 'covered', evidence: 'lib/static-evidence.ts:1' }], srcRepo.root), null);
});

test('a path that escapes and re-enters the repository is rejected even when the re-entered file exists (TASK-2662)', () => {
  const reenter = memoryRepository({ 'pkg/package.json': '{}' });
  // `../../repo/pkg/package.json` walks above the root, then resolves back
  // into the repository at an existing file; the escape must win.
  const evidence = '../../repo/pkg/package.json';
  const unverifiable = findUnverifiableRecordedRow(reenter.fileSystem, [{ criterion: 'covered', evidence }], reenter.root);
  assert.ok(unverifiable, `${evidence} escapes the repository and must not be accepted`);
  assert.match(unverifiable.message, /cites no verifiable reference/);
});
