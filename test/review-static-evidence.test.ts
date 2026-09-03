// @ts-nocheck -- TASK-2328: partial test doubles from ESM seam migration

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'node:url';
import { formatStaticReviewFindings, formatStaticReviewSuccess, performStaticReview } from '../src/adapters/review/review-static-evidence.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');

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

// ============================================================================
// performStaticReview — valid evidence paths
// ============================================================================

test('performStaticReview accepts Goal Check with recognized repo command', () => {
  const tmpDir = fs.mkdtempSync(path.join(REPO_ROOT, '.tmp-review-evidence-'));
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
      resolveWorktree: () => REPO_ROOT,
      rootDir: REPO_ROOT,
    });
    assert.equal(result.ok, true, `Expected pass but got findings: ${result.findings.join('; ')}`);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('performStaticReview accepts Goal Check with recognized test name', () => {
  const tmpDir = fs.mkdtempSync(path.join(REPO_ROOT, '.tmp-review-evidence-'));
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
      resolveWorktree: () => REPO_ROOT,
      rootDir: REPO_ROOT,
    });
    assert.equal(result.ok, true, `Expected pass but got findings: ${result.findings.join('; ')}`);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('performStaticReview accepts Goal Check with test file path', () => {
  const tmpDir = fs.mkdtempSync(path.join(REPO_ROOT, '.tmp-review-evidence-'));
  const missionDir = path.join(tmpDir, 'missions', 'task-testpath');
  fs.mkdirSync(missionDir, { recursive: true });

  const checkpoint = path.join(missionDir, 'CP-1.md');
  fs.writeFileSync(checkpoint, `# Checkpoint 1

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Test coverage | \`test/review-static-evidence.test.ts\` | PASS |
`, 'utf8');

  try {
    const result = performStaticReview('task-testpath', {
      log: () => {},
      findMissionDir: () => missionDir,
      findCheckpoints: () => [checkpoint],
      readFileSync: fs.readFileSync,
      run: () => ({ status: 0, stdout: '' }),
      resolveWorktree: () => REPO_ROOT,
      rootDir: REPO_ROOT,
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
  const tmpDir = fs.mkdtempSync(path.join(REPO_ROOT, '.tmp-review-evidence-'));
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
    const result = performStaticReview('task-spacepath', {
      log: () => {},
      findMissionDir: () => missionDir,
      findCheckpoints: () => [checkpoint],
      readFileSync: fs.readFileSync,
      run: () => ({ status: 0, stdout: '' }),
      resolveWorktree: () => REPO_ROOT,
      rootDir: REPO_ROOT,
    });
    assert.equal(result.ok, true, `Expected pass but got findings: ${result.findings.join('; ')}`);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('performStaticReview accepts a bare repo path without a :line suffix', () => {
  const tmpDir = fs.mkdtempSync(path.join(REPO_ROOT, '.tmp-review-evidence-'));
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
      resolveWorktree: () => REPO_ROOT,
      rootDir: REPO_ROOT,
    });
    assert.equal(result.ok, true, `Expected pass but got findings: ${result.findings.join('; ')}`);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('performStaticReview accepts a bare repo path named mid-sentence', () => {
  const tmpDir = fs.mkdtempSync(path.join(REPO_ROOT, '.tmp-review-evidence-'));
  const missionDir = path.join(tmpDir, 'missions', 'task-prosepath');
  fs.mkdirSync(missionDir, { recursive: true });

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
      resolveWorktree: () => REPO_ROOT,
      rootDir: REPO_ROOT,
    });
    assert.equal(result.ok, true, `Expected pass but got findings: ${result.findings.join('; ')}`);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('performStaticReview rejects placeholder-only evidence', () => {
  const tmpDir = fs.mkdtempSync(path.join(REPO_ROOT, '.tmp-review-evidence-'));
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
      resolveWorktree: () => REPO_ROOT,
      rootDir: REPO_ROOT,
    });
    assert.equal(result.ok, false, 'Expected failure for placeholder evidence');
    assert.ok(result.findings.some(f => f.includes('verifiable reference')));
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('performStaticReview rejects separator-only table', () => {
  const tmpDir = fs.mkdtempSync(path.join(REPO_ROOT, '.tmp-review-evidence-'));
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
      resolveWorktree: () => REPO_ROOT,
      rootDir: REPO_ROOT,
    });
    assert.equal(result.ok, false, 'Expected failure for separator-only table');
    assert.ok(result.findings.some(f => f.includes('no evidence rows')));
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('performStaticReview rejects prose-only evidence', () => {
  const tmpDir = fs.mkdtempSync(path.join(REPO_ROOT, '.tmp-review-evidence-'));
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
      resolveWorktree: () => REPO_ROOT,
      rootDir: REPO_ROOT,
    });
    assert.equal(result.ok, false, 'Expected failure for prose-only evidence');
    assert.ok(result.findings.some(f => f.includes('verifiable reference')));
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
