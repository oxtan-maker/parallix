// @ts-nocheck -- TASK-2277: preserve legacy CommonJS mock behavior while mock-shape typings are hardened separately.

// Regression coverage for task-1431: integration preflight backlog-resolution
// regressions.
//
// Locks three transcripted defects in `px integrate` preflight:
//   1. A false "Could not resolve backlog task for <slug>." classification
//      failure even though the backlog task exists and is otherwise
//      integration-eligible, caused by classification resolution using a
//      different root than the one that actually resolved the task file.
//   2. Ambiguous-slug and missing-task scenarios must stay distinguishable:
//      ambiguous slugs are a hard failure with listed candidates; missing
//      tasks are a warning with an `unknown` classification fallback.
//   3. A null mission slug must never leak into preflight output ("Integration
//      preflight for null" / "expected mission/null") when the caller is
//      integrating a real mission.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  printIntegrationPreflight,
  buildIntegrationContext
} = require('../dist/lib/commands/integrate');

function withTempBaseWorktree(fn) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'task-1431-base-'));
  try {
    fs.mkdirSync(path.join(root, 'backlog', 'tasks'), { recursive: true });
    fn(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function baseContext(overrides) {
  return Object.assign({
    slug: 'task-preflight-test',
    branch: 'mission/task-preflight-test',
    currentBranch: 'mission/task-preflight-test',
    missionDir: '/tmp/docs/missions/2026/task-preflight-test',
    taskAssignee: 'codex',
    forgejoUser: 'codex',
    taskAssigneeWarning: null,
    pr: { exists: false, raw: 'no PR found' },
    approval: { ok: false, error: 'pr-missing', reviewState: null },
    mainBranch: 'main',
    mainDirty: false,
    mainDirtyEntries: []
  }, overrides);
}

function captureLines() {
  const lines = [];
  return { lines, log: line => lines.push(line) };
}

const defaultPreflightOpts = {
  readTokenFn: () => 'secret-token',
  resolveTokenFileFn: () => '/tmp/tokens/codex',
  isForgejoReviewEnabledFn: () => false,
  getUnresolvedIndexConflictsFn: () => ({ ok: true, files: [] })
};

test('printIntegrationPreflight resolves classification from the mission base worktree, not process.cwd()', () => {
  withTempBaseWorktree(root => {
    const taskFile = path.join(root, 'backlog', 'tasks', 'task-preflight-test - repro.md');
    fs.writeFileSync(taskFile, '---\nid: TASK-PREFLIGHT-TEST\nlabels:\n  - ai_sdlc\n---\n');

    const { lines, log } = captureLines();
    const context = baseContext({
      task: { ok: true, taskFile },
      taskStatus: 'ready-for-integration',
      baseWorktree: root
    });

    // Sanity check: the repo's own cwd (where this test process runs) does
    // NOT contain this fixture task, so any resolution that ignores
    // context.baseWorktree and defaults to process.cwd() must fail.
    assert.notEqual(process.cwd(), root);

    // @ts-expect-error TS2345 Argument of type '{ log: (line: any) => number; } & { readTokenFn: () => string;
    const result = printIntegrationPreflight(context, Object.assign({ log }, defaultPreflightOpts));

    const output = lines.join('\n');
    assert.ok(!result.failures.includes('classification'), `unexpected classification failure in:\n${output}`);
    assert.match(output, /Backlog classification: ai_sdlc/);
    assert.doesNotMatch(output, /Could not resolve backlog task for task-preflight-test\./);
  });
});

test('printIntegrationPreflight still hard-fails on an ambiguous slug rather than degrading to missing-task', () => {
  const { lines, log } = captureLines();
  const context = baseContext({
    task: { ok: false, reason: 'ambiguous', matches: ['a.md', 'b.md'] },
    taskStatus: null
  });

  // @ts-expect-error TS2345 Argument of type '{ log: (line: any) => number; } & { readTokenFn: () => string;
  const result = printIntegrationPreflight(context, Object.assign({ log }, defaultPreflightOpts));

  const output = lines.join('\n');
  assert.ok(result.failures.includes('task-ambiguity'));
  assert.match(output, /Backlog task: ambiguous slug task-preflight-test/);
  assert.match(output, /a\.md/);
  assert.match(output, /b\.md/);
  assert.doesNotMatch(output, /no task file found/);
  assert.doesNotMatch(output, /Backlog classification: unknown/);
});

test('printIntegrationPreflight still warns and falls back to unknown classification for a genuinely missing task', () => {
  const { lines, log } = captureLines();
  const context = baseContext({
    task: { ok: false, reason: 'missing' },
    taskStatus: null
  });

  // @ts-expect-error TS2345 Argument of type '{ log: (line: any) => number; } & { readTokenFn: () => string;
  const result = printIntegrationPreflight(context, Object.assign({ log }, defaultPreflightOpts));

  const output = lines.join('\n');
  assert.ok(!result.failures.includes('task-missing'));
  assert.ok(!result.failures.includes('classification'));
  assert.match(output, /no task file found for task-preflight-test/);
  assert.match(output, /Backlog classification: unknown/);
});

test('printIntegrationPreflight refuses to run with a null mission slug instead of printing "for null"', () => {
  const { lines, log } = captureLines();
  const context = baseContext({
    slug: null,
    branch: 'mission/null',
    task: { ok: true, taskFile: '/tmp/task.md' },
    taskStatus: 'ready-for-integration'
  });

  assert.throws(
    // @ts-expect-error TS2345 Argument of type '{ log: (line: any) => number; } & { readTokenFn: () => string;
    () => printIntegrationPreflight(context, Object.assign({ log }, defaultPreflightOpts)),
    /non-null mission slug/
  );

  const output = lines.join('\n');
  assert.doesNotMatch(output, /Integration preflight for null/);
  assert.doesNotMatch(output, /expected mission\/null/);
});

test('buildIntegrationContext refuses to build a context for a null mission slug', () => {
  assert.throws(() => buildIntegrationContext(null), /non-null mission slug/);
  assert.throws(() => buildIntegrationContext(undefined), /non-null mission slug/);
});
