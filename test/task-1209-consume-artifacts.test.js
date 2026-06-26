const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

// ============================================================================
// SC4: --consume-artifacts integration test
// ============================================================================

const { consumeArtifacts } = require('../lib/review/review-commands');

test('consumeArtifacts persists events and transitions backlog to review status (task-1209 SC4)', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'task-1209-consume-'));
  const eventDir = path.join(tmpDir, 'review-events');
  const missionDir = path.join(tmpDir, 'missions', '2026', 'task-999');
  const artifactDir = path.join(tmpDir, 'artifacts');
  const taskFile = path.join(tmpDir, 'backlog', 'tasks', 'task-999 - test.md');

  // Create artifact files
  fs.mkdirSync(artifactDir, { recursive: true });
  fs.writeFileSync(path.join(artifactDir, 'task-999-review-findings.md'), '## Findings\nBug in X.');
  fs.writeFileSync(path.join(artifactDir, 'task-999-review-outcome.md'), 'Verdict: approve');
  fs.writeFileSync(path.join(artifactDir, 'task-999-review-verdict.txt'), 'approve');

  // Create mission dir structure
  fs.mkdirSync(eventDir, { recursive: true });
  fs.mkdirSync(missionDir, { recursive: true });
  fs.writeFileSync(path.join(missionDir, 'MISSION.md'), '# Mission: test\n');

  // Create task file with minimal YAML frontmatter
  fs.mkdirSync(path.dirname(taskFile), { recursive: true });
  fs.writeFileSync(taskFile, `---
id: TASK-999
title: test
status: active
assignee: [custom]
---
`);

  let eventsWritten = [];
  let taskStatusUpdate = null;
  let reviewStateWritten = false;
  const logs = [];

  const result = await consumeArtifacts('task-999', {
    log: msg => logs.push(msg),
    error: msg => logs.push('[ERROR] ' + msg),
    exit: () => { throw new Error('exit called'); },
    resolveWorktreeFn: () => tmpDir,
    resolveTaskFileFn: () => ({ ok: true, taskFile: taskFile }),
    resolveArtifactDirFn: () => artifactDir,
    readArtifactFn: (p) => {
      if (p.includes('review-findings.md')) return '## Findings\nBug in X.';
      if (p.includes('review-outcome.md')) return 'Verdict: approve';
      if (p.includes('review-verdict.txt')) return 'approve';
      return null;
    },
    createEventFn: (taskSlug, type, params, opts) => {
      const evtPath = path.join(eventDir, `${taskSlug}-${type}-${Date.now()}.md`);
      fs.writeFileSync(evtPath, [
        `---`,
        `type: ${type}`,
        `actor: params.actor || 'unknown'`,
        `---\n`,
        params.content || '(no content)',
      ].join('\n'));
      eventsWritten.push({ type, path: evtPath });
      return { ok: true, path: evtPath };
    },
    deleteArtifactFn: (p) => { try { fs.unlinkSync(p); } catch (_) { } },
    transitionTaskFn: (taskSlug, status, opts) => {
      taskStatusUpdate = { slug: taskSlug, status };
      // Update the task file
      const content = fs.readFileSync(taskFile, 'utf8');
      const updated = content.replace(/status: \w+/, `status: ${status}`);
      fs.writeFileSync(taskFile, updated);
      return true;
    },
    getTaskAssigneeFn: () => 'custom',
  });

  assert.equal(result.consumed, true, 'should have consumed artifacts');
  assert.equal(result.ok, true, 'should succeed');
  assert.equal(taskStatusUpdate.status, 'review', 'task should be set to review status');
  assert.ok(eventsWritten.length >= 2, `should write at least 2 events, got ${eventsWritten.length}`);
  assert.ok(eventsWritten.some(e => e.type === 'reviewer_findings'), 'should include reviewer_findings event');
  assert.ok(eventsWritten.some(e => e.type === 'reviewer_outcome'), 'should include reviewer_outcome event');

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('consumeArtifacts leaves no untracked review-events files after a successful transition', async () => {
  const { execFileSync } = require('node:child_process');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'task-1327-consume-clean-'));
  const missionDir = path.join(root, 'missions', 'task-2200');
  const artifactDir = fs.mkdtempSync(path.join(os.tmpdir(), 'task-1327-consume-artifacts-'));
  const taskFile = path.join(root, 'backlog', 'tasks', 'task-2200 - consume-clean.md');

  try {
    fs.mkdirSync(missionDir, { recursive: true });
    fs.mkdirSync(path.dirname(taskFile), { recursive: true });
    fs.writeFileSync(path.join(missionDir, 'MISSION.md'), '# Mission\n');
    fs.writeFileSync(taskFile, [
      '---',
      'id: TASK-2200',
      'title: consume clean',
      'status: active',
      'assignee: [custom]',
      '---',
      '',
      'Status: ○ active',
      ''
    ].join('\n'));
    fs.writeFileSync(path.join(artifactDir, 'task-2200-review-findings.md'), '## Findings\nLooks good.');
    fs.writeFileSync(path.join(artifactDir, 'task-2200-review-outcome.md'), 'Verdict: approve');
    fs.writeFileSync(path.join(artifactDir, 'task-2200-review-verdict.txt'), 'approve');

    execFileSync('git', ['init'], { cwd: root });
    execFileSync('git', ['config', 'user.email', 'task-1327@example.com'], { cwd: root });
    execFileSync('git', ['config', 'user.name', 'Task 1327'], { cwd: root });
    execFileSync('git', ['add', '.'], { cwd: root });
    execFileSync('git', ['commit', '-m', 'fixture'], { cwd: root });

    const result = await consumeArtifacts('task-2200', {
      log: () => {},
      error: msg => { throw new Error(msg); },
      exit: code => { throw new Error(`exit ${code}`); },
      resolveWorktreeFn: () => root,
      resolveArtifactDirFn: () => artifactDir,
      getTaskAssigneeFn: () => 'custom',
    });

    assert.equal(result.ok, true);
    const status = execFileSync('git', ['status', '--short'], { cwd: root, encoding: 'utf8' });
    assert.equal(status.trim(), '');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(artifactDir, { recursive: true, force: true });
  }
});

// ============================================================================
// SC5: consumeReviewerArtifacts distinguishes "no artifacts" from "artifacts but no verdict"
// ============================================================================

const { consumeReviewerArtifacts } = require('../lib/review/review-artifacts');

test('consumeReviewerArtifacts returns consumed:false when no artifact files exist (task-1209 SC5a)', async () => {
  const result = await consumeReviewerArtifacts('test-slug', 'test-reviewer', {
    readArtifactFn: () => null,
    tmpDir: '/nonexistent-no-files',
  });
  assert.equal(result.consumed, false);
});

test('consumeReviewerArtifacts returns informative message when artifacts exist but verdict missing and provider=none (task-1209 SC5b)', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'task-1209-scmessages-'));
  const findingsPath = path.join(tmpDir, 'test-slug-review-findings.md');
  const outcomePath = path.join(tmpDir, 'test-slug-review-outcome.md');
  fs.writeFileSync(findingsPath, 'test findings');
  fs.writeFileSync(outcomePath, 'test outcome content');

  let capturedMessage = null;
  const result = await consumeReviewerArtifacts('test-slug', 'test-reviewer', {
    readArtifactFn: (p) => {
      if (p.includes('review-findings.md')) return 'test findings';
      if (p.includes('review-outcome.md')) return 'test outcome content';
      return null;
    },
    tmpDir,
    worktree: tmpDir,
    readReviewStateFn: () => null,
    createEventFn: () => ({ ok: true, path: '/mock/path' }),
    deleteArtifactFn: () => {},
    forgejoEnabled: false,
    log: () => {},
    error: (msg) => { capturedMessage = msg; },
  });

  assert.equal(result.consumed, true, 'should have consumed');
  assert.equal(result.ok, false, 'should report ok:false');
  assert.ok(capturedMessage && capturedMessage.includes('provider=none') || capturedMessage && capturedMessage.includes('verdict'),
    'error should reference provider=none or verdict absence');

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('consumeReviewerArtifacts extracts verdict from review-outcome.md when review-verdict.txt is absent', async () => {
  const persistedEvents = [];

  const result = await consumeReviewerArtifacts('test-slug', 'test-reviewer', {
    readArtifactFn: (p) => {
      if (p.includes('review-findings.md')) return 'findings';
      if (p.includes('review-outcome.md')) return 'Verdict: approve';
      return null;
    },
    tmpDir: '/unused',
    worktree: process.cwd(),
    createEventFn: (slug, type, params) => {
      persistedEvents.push({ slug, type, params });
      return { ok: true, path: `/tmp/${type}.md` };
    },
    deleteArtifactFn: () => {},
    forgejoEnabled: false,
    log: () => {},
    error: (msg) => {
      throw new Error(`unexpected error: ${msg}`);
    },
  });

  assert.equal(result.consumed, true);
  assert.equal(result.ok, true);
  assert.equal(result.reviewState, 'APPROVED');
  assert.equal(persistedEvents.length, 2, 'should persist findings and outcome events');
});

// ============================================================================
// --submit pre-check warning
// ============================================================================

test('--submit pre-check warns when unprocessed artifact files exist', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'task-1209-submit-check-'));
  const artifactDir = path.join(tmpDir, 'artifacts');
  fs.mkdirSync(artifactDir, { recursive: true });
  fs.writeFileSync(path.join(artifactDir, 'task-888-review-findings.md'), 'findings');
  fs.writeFileSync(path.join(artifactDir, 'task-888-review-outcome.md'), 'outcome');
  fs.writeFileSync(path.join(artifactDir, 'task-888-review-verdict.txt'), 'approve');

  let warnings = [];
  const logs = [];

  // We test the pre-check inline: simulate what the --submit branch does
  const findingsPath = path.join(artifactDir, 'task-888-review-findings.md');
  const outcomePath = path.join(artifactDir, 'task-888-review-outcome.md');
  const verdictPath = path.join(artifactDir, 'task-888-review-verdict.txt');

  if (fs.existsSync(findingsPath) || fs.existsSync(outcomePath) || fs.existsSync(verdictPath)) {
    warnings.push(`Unprocessed review artifacts found at ${artifactDir}`);
  }

  assert.ok(warnings.length > 0, 'should warn about unprocessed artifacts');
  assert.ok(warnings[0].includes('artifacts'), 'warning should mention artifacts');

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('--submit pre-check does not warn when no artifacts exist', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'task-1209-submit-nofiles-'));
  const artifactDir = path.join(tmpDir, 'artifacts');
  fs.mkdirSync(artifactDir, { recursive: true });

  let warned = false;
  const findingsPath = path.join(artifactDir, 'task-777-review-findings.md');
  const outcomePath = path.join(artifactDir, 'task-777-review-outcome.md');
  const verdictPath = path.join(artifactDir, 'task-777-review-verdict.txt');

  if (fs.existsSync(findingsPath) || fs.existsSync(outcomePath) || fs.existsSync(verdictPath)) {
    warned = true;
  }

  assert.equal(warned, false, 'should NOT warn when no artifacts exist');

  fs.rmSync(tmpDir, { recursive: true, force: true });
});
