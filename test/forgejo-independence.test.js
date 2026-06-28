/**
 * Forgejo-independence tests for the core workflow path.
 *
 * When adapters.review.provider !== 'forgejo', the workflow should not require
 * Forgejo tokens, remotes, or API reachability for the core lifecycle.
 *
 * Added as part of task-1148 CP-1. Tests start by documenting the gap (asserting
 * the gate function works), then are updated in CP-2/CP-3 to assert the fixed behavior.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const os = require('os');

const { isForgejoReviewEnabled } = require('../lib/core/product-config');

function createTempConfigDir(reviewProvider) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-forgejo-ind-'));
  const config = {
    product: { name: 'Test' },
    adapters: {
      tasks: { provider: 'backlog-md', storage: 'backlog' },
      missions: { baseDir: 'docs/missions', branchPrefix: 'mission/', worktreePattern: '../<repo>-<slug>' },
      verification: { command: 'npm test', defaultArea: 'docs' },
      review: reviewProvider !== null
        ? { provider: reviewProvider, baseUrl: 'http://localhost:3300', remote: 'review', repo: 'test/repo' }
        : {},
      agents: { commandEnvPrefix: 'AUTONOMOUS_REVIEW_' },
    },
  };
  fs.writeFileSync(path.join(dir, 'workflow.config.json'), JSON.stringify(config, null, 2));
  return dir;
}

// =============================================================================
// Section 1: isForgejoReviewEnabled gate function
// =============================================================================

test('isForgejoReviewEnabled returns true when provider is forgejo', () => {
  const dir = createTempConfigDir('forgejo');
  assert.equal(isForgejoReviewEnabled(dir), true);
  fs.rmSync(dir, { recursive: true });
});

test('isForgejoReviewEnabled returns false when provider is none', () => {
  const dir = createTempConfigDir('none');
  assert.equal(isForgejoReviewEnabled(dir), false);
  fs.rmSync(dir, { recursive: true });
});

test('isForgejoReviewEnabled defaults to false when provider is null/missing (opt-in)', () => {
  const dir = createTempConfigDir(null);
  assert.equal(isForgejoReviewEnabled(dir), false);
  fs.rmSync(dir, { recursive: true });
});

test('isForgejoReviewEnabled defaults to false for legacy repo without config', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-forgejo-ind-'));
  assert.equal(isForgejoReviewEnabled(dir), false);
  fs.rmSync(dir, { recursive: true });
});

// =============================================================================
// Section 2: mission-start preflight gates Forgejo PR check
// =============================================================================

test('mission-start accepts isForgejoReviewEnabledFn option and skips PR check when false', () => {
  const missionStart = require('../lib/commands/mission-start');
  const lines = [];
  let prStatusCalled = false;

  const result = missionStart(['task-test'], {
    returnResult: true,
    cwdFn: () => '/tmp/project-task-test',
    getCurrentBranchFn: () => 'mission/task-test',
    resolveTaskFileFn: () => ({ ok: true, taskFile: '/tmp/task-test.md' }),
    resolveMissionClassificationFn: () => ({ classification: 'user_value' }),
    getTaskStatusFn: () => 'active',
    toVirtualFn: (s) => s,
    findMissionDirFn: () => '/tmp/docs/missions/2026/task-test',
    fsExistsSync: () => true,
    findCheckpointsFn: () => ['/tmp/docs/missions/2026/task-test/CP-1.md'],
    getFirstLineFn: () => '# CP-1',
    getMissionYearFn: () => '2026',
    conventionalWorktreePathFn: () => '/tmp/project-task-test',
    getLastCommitFn: () => ({ sha: 'abcdef123456', subject: 'test', date: '2026-05-26' }),
    getPrStatusFn: () => {
      prStatusCalled = true;
      return { exists: false };
    },
    evaluateRepositoryReadinessFn: () => ({ mode: 'configured', configPath: '/tmp/workflow.config.json', issues: [] }),
    evaluateReviewSetupFn: () => ({ required: false, ok: true, issues: [], steps: [] }),
    adapterChecklistFn: () => [],
    isForgejoReviewEnabledFn: () => false,
    getPrimaryBranchFn: () => 'main',
    log: line => lines.push(line),
    error: line => lines.push(line),
  });

  assert.deepEqual(result, { pass: true });
  assert.equal(prStatusCalled, false, 'getPrStatus should NOT be called when Forgejo review is disabled');
});

// =============================================================================
// Section 3: handoff gates Forgejo PR creation
// =============================================================================

test('performHandoff gates Forgejo PR creation behind isForgejoReviewEnabled', () => {
  const handoff = require('../lib/commands/handoff');
  const src = handoff.performHandoff.toString();
  assert.ok(src.includes('isForgejoReviewEnabled'),
    'performHandoff should check isForgejoReviewEnabled to skip Forgejo PR creation');
});

// =============================================================================
// Section 4: integrate gates syncMerged behind review provider
// =============================================================================

test('integrate gates syncMerged behind isForgejoReviewEnabled', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'lib', 'commands', 'integrate.js'), 'utf8');
  assert.ok(src.includes('isForgejoReviewEnabled'),
    'integrate.js should gate syncMerged behind isForgejoReviewEnabled');
});

// =============================================================================
// Section 5: evaluateReviewSetup respects review provider
// =============================================================================

test('evaluateReviewSetup returns not-required when provider is not forgejo', () => {
  const { evaluateReviewSetup } = require('../lib/tools/setup-review');
  const dir = createTempConfigDir('none');
  const result = evaluateReviewSetup(dir, {
    users: ['claude'],
    tokenPathFn: () => '/nonexistent/token',
    getRemoteUrlFn: () => null,
    remoteUrlFn: () => null,
    requestFn: () => { throw new Error('Should not make API requests when Forgejo is off'); },
  });
  fs.rmSync(dir, { recursive: true });

  assert.equal(result.required, false, 'Review setup should not be required when provider is not forgejo');
  assert.equal(result.ok, true);
});

// =============================================================================
// Section 6: review.js verifyReview skips PR check when Forgejo is off
// =============================================================================

test('verifyReview skips Forgejo PR check when review provider is not forgejo', () => {
  const { verifyReview } = require('../lib/review/review');
  const lines = [];
  let prStatusCalled = false;

  verifyReview('task-test', false, {
    log: line => lines.push(line),
    error: line => lines.push(line),
    exit: () => {},
    resolveWorktreeFn: () => '/tmp/project-task-test',
    findMissionDirFn: () => '/tmp/docs/missions/2026/task-test',
    getCurrentBranchFn: () => 'mission/task-test',
    resolveTaskFileFn: () => ({ ok: true, taskFile: '/tmp/task.md' }),
    getTaskStatusFn: () => 'review',
    findMissionAreaFn: () => 'docs',
    runFn: () => ({ status: 0 }),
    getAcceptanceCriteriaFn: () => [],
    formatMatrixSummaryFn: () => [],
    buildAutonomousReviewMatrixFn: () => [],
    readReviewStateFn: () => null,
    cwdFn: () => '/tmp/project-task-test',
    getPrStatusFn: () => {
      prStatusCalled = true;
      return { exists: false };
    },
    isForgejoReviewEnabledFn: () => false,
  });

  assert.equal(prStatusCalled, false, 'getPrStatus should NOT be called when Forgejo is disabled');
  const output = lines.join('\n').replace(/\x1B\[\d+m/g, '');
  assert.ok(output.includes('skipped'), 'Should log that Forgejo PR check was skipped');
});

// =============================================================================
// Section 7: review.js startReviewLoop gates Forgejo availability check
// =============================================================================

test('startReviewLoop gates Forgejo availability behind isForgejoReviewEnabled', () => {
  // Check review-loop.js since startReviewLoop is now extracted there
  const src = fs.readFileSync(path.join(__dirname, '..', 'lib', 'review', 'review-loop.js'), 'utf8');
  assert.ok(src.includes('forgejoEnabled') && src.includes('isForgejoReviewEnabled'),
    'review-loop.js startReviewLoop should gate Forgejo checks behind isForgejoReviewEnabled');
});

// =============================================================================
// Section 8: integrate printIntegrationPreflight gates PR/approval checks
// =============================================================================

test('integrate printIntegrationPreflight gates Forgejo checks', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'lib', 'commands', 'integrate.js'), 'utf8');
  const preflightSection = src.slice(src.indexOf('function printIntegrationPreflight'));
  assert.ok(preflightSection.includes('isForgejoReviewEnabled'),
    'printIntegrationPreflight should gate Forgejo PR/approval checks');
});

// =============================================================================
// Section 9: review.js consumeReviewerArtifacts does not call Forgejo helpers when disabled
// =============================================================================

test('consumeReviewerArtifacts does not call Forgejo helpers when forgejoEnabled is false', async () => {
  const { consumeReviewerArtifacts, reviewArtifactPath } = require('../lib/review/review');
  
  let consumeHumanNotesCalled = false;
  let postCommentCalled = false;
  let postReviewCalled = false;
  
  // Create a real temporary mission directory structure so createEvent succeeds
  const testWorktree = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-test-worktree-'));
  const missionDir = path.join(testWorktree, 'docs', 'missions', '2026', 'task-test', 'review-events');
  fs.mkdirSync(missionDir, { recursive: true });
  
  const tmpDir = os.tmpdir();
  
  // Create temp artifact files so consumeReviewerArtifacts actually tries to consume them
  const findingsPath = reviewArtifactPath('task-test', 'review-findings.md', tmpDir);
  const outcomePath = reviewArtifactPath('task-test', 'review-outcome.md', tmpDir);
  const verdictPath = reviewArtifactPath('task-test', 'review-verdict.txt', tmpDir);
  
  fs.writeFileSync(findingsPath, '# Findings\n\n## Finding 1\nSeverity: LOW\nFile: test.js\nPattern: test', 'utf8');
  fs.writeFileSync(outcomePath, 'verdict: approve\n\n# Review Outcome\nAll good.', 'utf8');
  fs.writeFileSync(verdictPath, 'approve', 'utf8');
  
  const Module = require('module');
  const originalRequire = Module.prototype.require;
  
  Module.prototype.require = function(id) {
    if (id === '../lib/review-events' || id.endsWith('/lib/review-events')) {
      const original = originalRequire.apply(this, arguments);
      return {
        ...original,
        consumeHumanNotes: () => { 
          consumeHumanNotesCalled = true;
          throw new Error('consumeHumanNotes called when forgejoEnabled=false'); 
        }
      };
    }
    return originalRequire.apply(this, arguments);
  };
  
  delete require.cache[require.resolve('../lib/review/review')];
  delete require.cache[require.resolve('../lib/review/review-events')];
  const { consumeReviewerArtifacts: fresh } = require('../lib/review/review');
  Module.prototype.require = originalRequire;
  
  const result = await fresh('task-test', 'codex', {
    worktree: testWorktree,
    forgejoEnabled: false,
    tmpDir,
    readTokenFn: () => { postCommentCalled = true; throw new Error('readToken called'); },
    getCommentsFn: () => { throw new Error('getComments called'); },
    postCommentFn: () => { postCommentCalled = true; throw new Error('postComment called'); },
    postReviewFn: () => { postReviewCalled = true; throw new Error('postReview called'); },
    buildMetadataFooterFn: () => '',
    log: () => {},
    error: () => {},
  });
  
  // Clean up temp files
  try { fs.unlinkSync(findingsPath); } catch (_) {}
  try { fs.unlinkSync(outcomePath); } catch (_) {}
  try { fs.unlinkSync(verdictPath); } catch (_) {}
  
  // Clean up test worktree
  fs.rmSync(testWorktree, { recursive: true, force: true });
  
  assert.equal(consumeHumanNotesCalled, false, 'consumeHumanNotes should NOT be called');
  assert.equal(postCommentCalled, false, 'postCommentFn should NOT be called');
  assert.equal(postReviewCalled, false, 'postReviewFn should NOT be called');
  assert.equal(result.consumed, true, 'Artifacts should be consumed');
  assert.equal(result.ok, true, 'Consumption should succeed');
  assert.equal(result.reviewState, 'APPROVED', 'Should return APPROVED reviewState for approve verdict');
});

// =============================================================================
// Section 10: review.js consumeImplementerArtifacts does not call Forgejo helpers when disabled
// =============================================================================

test('consumeImplementerArtifacts does not call Forgejo helpers when forgejoEnabled is false', async () => {
  const { consumeImplementerArtifacts, reviewArtifactPath } = require('../lib/review/review');
  
  let consumeHumanNotesCalled = false;
  let postCommentCalled = false;
  
  // Create a real temporary mission directory structure so createEvent succeeds
  const testWorktree = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-test-worktree-'));
  const missionDir = path.join(testWorktree, 'docs', 'missions', '2026', 'task-test', 'review-events');
  fs.mkdirSync(missionDir, { recursive: true });
  
  const tmpDir = os.tmpdir();
  
  // Create temp artifact files so consumeImplementerArtifacts actually tries to consume them
  const resolutionPath = reviewArtifactPath('task-test', 'round-resolution.md', tmpDir);
  const dispositionPath = reviewArtifactPath('task-test', 'review-disposition.txt', tmpDir);
  
  fs.writeFileSync(resolutionPath, 'fixed_items:\n  - "test fix"\npushed_back_items: []\nparked_items: []\nblocked_reason: null', 'utf8');
  fs.writeFileSync(dispositionPath, 'CHANGES_MADE', 'utf8');
  
  const Module = require('module');
  const originalRequire = Module.prototype.require;
  
  Module.prototype.require = function(id) {
    if (id === '../lib/review-events' || id.endsWith('/lib/review-events')) {
      const original = originalRequire.apply(this, arguments);
      return {
        ...original,
        consumeHumanNotes: () => { 
          consumeHumanNotesCalled = true;
          throw new Error('consumeHumanNotes called when forgejoEnabled=false'); 
        }
      };
    }
    return originalRequire.apply(this, arguments);
  };
  
  delete require.cache[require.resolve('../lib/review/review')];
  delete require.cache[require.resolve('../lib/review/review-events')];
  const { consumeImplementerArtifacts: fresh } = require('../lib/review/review');
  Module.prototype.require = originalRequire;
  
  const result = await fresh('task-test', 'mistral', {
    worktree: testWorktree,
    forgejoEnabled: false,
    tmpDir,
    readTokenFn: () => { throw new Error('readToken called'); },
    getCommentsFn: () => { throw new Error('getComments called'); },
    postCommentFn: () => { postCommentCalled = true; throw new Error('postComment called'); },
    buildMetadataFooterFn: () => '',
    log: () => {},
    error: () => {},
  });
  
  // Clean up temp files
  try { fs.unlinkSync(resolutionPath); } catch (_) {}
  try { fs.unlinkSync(dispositionPath); } catch (_) {}
  
  // Clean up test worktree
  fs.rmSync(testWorktree, { recursive: true, force: true });
  
  assert.equal(consumeHumanNotesCalled, false, 'consumeHumanNotes should NOT be called');
  assert.equal(postCommentCalled, false, 'postCommentFn should NOT be called');
  assert.equal(result.consumed, true, 'Artifacts should be consumed');
  assert.equal(result.ok, true, 'Consumption should succeed');
  assert.equal(result.disposition, 'CHANGES_MADE', 'Should return CHANGES_MADE disposition');
});

// =============================================================================
// Section 11: integrate printIntegrationPreflight does not call Forgejo helpers when disabled
// =============================================================================

test('printIntegrationPreflight does not call Forgejo API helpers when context indicates provider off', () => {
  const { printIntegrationPreflight } = require('../lib/commands/integrate');
  
  let getPrStatusCalled = false;
  let readTokenCalled = false;
  
  const Module = require('module');
  const originalRequire = Module.prototype.require;
  
  Module.prototype.require = function(id) {
    if (id === '../lib/forgejo' || id.endsWith('/lib/forgejo')) {
      const original = originalRequire.apply(this, arguments);
      return {
        ...original,
        getPrStatus: () => { getPrStatusCalled = true; throw new Error('getPrStatus called'); },
        readToken: () => { readTokenCalled = true; throw new Error('readToken called'); },
      };
    }
    return originalRequire.apply(this, arguments);
  };
  
  delete require.cache[require.resolve('../lib/commands/integrate')];
  delete require.cache[require.resolve('../lib/tools/forgejo')];
  const { printIntegrationPreflight: fresh } = require('../lib/commands/integrate');
  Module.prototype.require = originalRequire;
  
  // Create a context that indicates Forgejo is disabled
  const context = {
    slug: 'task-test',
    branch: 'mission/task-test',
    currentBranch: 'mission/task-test',
    missionDir: '/tmp/docs/missions/2026/task-test',
    area: 'docs',
    task: { ok: true, taskFile: '/tmp/task.md' },
    taskStatus: 'review',
    taskAssignee: null,
    forgejoUser: null,
    taskAssigneeWarning: null,
    pr: { exists: false },
    approval: { ok: false, error: 'forgejo-off', reviewState: null },
    siblingPrs: [],
  };
  
  const lines = [];
  fresh(context, {
    log: (line) => lines.push(line),
    getPrimaryBranchFn: () => 'main',
    getPrimaryWorktreeFn: () => '/tmp',
  });
  
  assert.equal(getPrStatusCalled, false, 'getPrStatus should NOT be called');
  assert.equal(readTokenCalled, false, 'readToken should NOT be called');
});
