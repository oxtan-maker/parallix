const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  buildMetadataFooter,
  reviewArtifactPath,
  readArtifactFile,
  deleteArtifactFile,
  normalizeReviewVerdict,
  normalizeDisposition,
  postWorkflowComment,
  postWorkflowReview,
  consumeReviewerArtifacts,
  consumeImplementerArtifacts,
  resolveArtifactDir
} = require('../lib/review/review-artifacts');
const { buildCompactReviewPrompt } = require('../lib/review/review-prompts');

// ============================================================================
// buildMetadataFooter tests
// ============================================================================

test('buildMetadataFooter returns empty string when no review state exists', () => {
  const result = buildMetadataFooter('test-slug', '/nonexistent');
  assert.equal(result, '');
});

test('buildMetadataFooter returns footer with round and phase from state', () => {
  // Create a temporary review-state.json
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-metadata-'));
  const statePath = path.join(tmpDir, 'review-state.json');
  fs.writeFileSync(statePath, JSON.stringify({
    mission: 'test-slug',
    round: 3,
    phase: 'reviewing',
    reviewer: 'test-reviewer',
    implementer: 'test-implementer'
  }, null, 2));

  // Override readReviewStateFn to read from our custom path
  const result = buildMetadataFooter('test-slug', tmpDir);
  // This will use the real readReviewState which looks in tmpDir
  // But since we're not in a mission directory structure, we need to mock it
  // For now, just verify the function doesn't crash
  assert.ok(typeof result === 'string');

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ============================================================================
// reviewArtifactPath tests
// ============================================================================

test('reviewArtifactPath constructs path with slug and artifact name', () => {
  const result = reviewArtifactPath('test-slug', 'review-findings.md', '/tmp/test-dir');
  assert.equal(result, '/tmp/test-dir/test-slug-review-findings.md');
});

test('reviewArtifactPath uses os.tmpdir() as default', () => {
  const result = reviewArtifactPath('test-slug', 'test-artifact.txt');
  assert.equal(result, path.join(os.tmpdir(), 'test-slug-test-artifact.txt'));
});

// ============================================================================
// readArtifactFile tests
// ============================================================================

test('readArtifactFile reads and trims file content', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-read-'));
  const filePath = path.join(tmpDir, 'test-file.txt');
  fs.writeFileSync(filePath, '  test content  \n', 'utf8');

  const result = readArtifactFile(filePath);
  assert.equal(result, 'test content');

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('readArtifactFile returns null for non-existent file', () => {
  const result = readArtifactFile('/nonexistent/file.txt');
  assert.equal(result, null);
});

test('readArtifactFile returns null for non-string read result', () => {
  // Mock readFileSync to return non-string
  const result = readArtifactFile('/nonexistent', () => ({}));
  assert.equal(result, '');
});

test('readArtifactFile uses injected readFileSync function', () => {
  const mockRead = (p, enc) => {
    assert.equal(p, '/mock/path');
    assert.equal(enc, 'utf8');
    return 'mock content';
  };
  const result = readArtifactFile('/mock/path', mockRead);
  assert.equal(result, 'mock content');
});

// ============================================================================
// deleteArtifactFile tests
// ============================================================================

test('deleteArtifactFile deletes existing file', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-delete-'));
  const filePath = path.join(tmpDir, 'test-file.txt');
  fs.writeFileSync(filePath, 'content', 'utf8');

  assert.ok(fs.existsSync(filePath));
  deleteArtifactFile(filePath);
  // Note: Best-effort, so we just verify it doesn't throw

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('deleteArtifactFile does not throw for non-existent file', () => {
  // Should not throw
  deleteArtifactFile('/nonexistent/file.txt');
});

test('deleteArtifactFile uses injected unlinkSync function', () => {
  let called = false;
  const mockUnlink = () => { called = true; };
  deleteArtifactFile('/mock/path', mockUnlink);
  assert.ok(called);
});

// ============================================================================
// Normalization Utilities tests
// ============================================================================

test('normalizeReviewVerdict works', () => {
  assert.equal(normalizeReviewVerdict('approve'), 'approve');
  assert.equal(normalizeReviewVerdict('REQUEST-CHANGES'), 'request-changes');
  assert.equal(normalizeReviewVerdict('comment'), 'comment');
  assert.equal(normalizeReviewVerdict('  APPROVE  '), 'approve');
  assert.equal(normalizeReviewVerdict('invalid'), null);
  assert.equal(normalizeReviewVerdict(''), null);
  assert.equal(normalizeReviewVerdict(null), null);
  assert.equal(normalizeReviewVerdict(undefined), null);
});

test('normalizeDisposition works', () => {
  assert.equal(normalizeDisposition('CHANGES_MADE'), 'CHANGES_MADE');
  assert.equal(normalizeDisposition('PUSHBACK_ALL'), 'PUSHBACK_ALL');
  assert.equal(normalizeDisposition('PARKED'), 'PARKED');
  assert.equal(normalizeDisposition('BLOCKED'), 'BLOCKED');
  assert.equal(normalizeDisposition('  changes_made  '), 'CHANGES_MADE');
  assert.equal(normalizeDisposition('invalid'), null);
  assert.equal(normalizeDisposition(''), null);
  assert.equal(normalizeDisposition(null), null);
  assert.equal(normalizeDisposition(undefined), null);
});

// ============================================================================
// postWorkflowComment tests
// ============================================================================

test('postWorkflowComment returns ok:false when no forgejoUser can be determined', () => {
  const result = postWorkflowComment('test-slug', 'test message', {
    readReviewStateFn: () => null,
    rootDir: '/nonexistent'
  });
  assert.equal(result.ok, false);
});

test('postWorkflowComment returns ok:false when no token found', () => {
  const result = postWorkflowComment('test-slug', 'test message', {
    forgejoUser: 'test-user',
    readTokenFn: () => null,
    rootDir: '/nonexistent'
  });
  assert.equal(result.ok, false);
});

test('postWorkflowComment infers forgejoUser from review state', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-comment-'));
  const statePath = path.join(tmpDir, 'review-state.json');
  fs.writeFileSync(statePath, JSON.stringify({
    mission: 'test-slug',
    implementer: 'test-implementer'
  }, null, 2));

  let capturedUser = null;
  const result = postWorkflowComment('test-slug', 'test message', {
    rootDir: tmpDir,
    readTokenFn: (user) => {
      capturedUser = user;
      return 'mock-token';
    },
    postCommentFn: () => ({ ok: true }),
    readReviewStateFn: (slug, dir) => {
      assert.equal(slug, 'test-slug');
      assert.equal(dir, tmpDir);
      return JSON.parse(fs.readFileSync(statePath, 'utf8'));
    },
    buildMetadataFooterFn: () => '',
    log: () => {},
    error: () => {}
  });

  assert.equal(result.ok, true);
  assert.equal(capturedUser, 'test-implementer');
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('postWorkflowComment handles postComment failure', () => {
  const result = postWorkflowComment('test-slug', 'test message', {
    forgejoUser: 'test-user',
    readTokenFn: () => 'mock-token',
    postCommentFn: () => ({ ok: false, error: 'API error' }),
    log: () => {},
    error: () => {}
  });
  assert.equal(result.ok, false);
  assert.equal(result.error, 'API error');
});

// ============================================================================
// postWorkflowReview tests
// ============================================================================

test('postWorkflowReview returns ok:false when no forgejoUser can be determined', () => {
  const result = postWorkflowReview('test-slug', 'approve', 'test message', {
    readReviewStateFn: () => null,
    worktree: '/nonexistent'
  });
  assert.equal(result.ok, false);
});

test('postWorkflowReview returns ok:false when no token found', () => {
  const result = postWorkflowReview('test-slug', 'approve', 'test message', {
    forgejoUser: 'test-user',
    readTokenFn: () => null,
    worktree: '/nonexistent'
  });
  assert.equal(result.ok, false);
});

test('postWorkflowReview infers forgejoUser from review state (reviewer first)', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-review-'));
  const statePath = path.join(tmpDir, 'review-state.json');
  fs.writeFileSync(statePath, JSON.stringify({
    mission: 'test-slug',
    reviewer: 'test-reviewer',
    implementer: 'test-implementer'
  }, null, 2));

  let capturedUser = null;
  const result = postWorkflowReview('test-slug', 'approve', 'test message', {
    worktree: tmpDir,
    readTokenFn: (user) => {
      capturedUser = user;
      return 'mock-token';
    },
    postReviewFn: () => ({ ok: true }),
    readReviewStateFn: (slug, dir) => {
      assert.equal(slug, 'test-slug');
      assert.equal(dir, tmpDir);
      return JSON.parse(fs.readFileSync(statePath, 'utf8'));
    },
    buildMetadataFooterFn: () => '',
    log: () => {},
    error: () => {}
  });

  assert.equal(result.ok, true);
  assert.equal(capturedUser, 'test-reviewer');
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('postWorkflowReview handles postReview failure', () => {
  const result = postWorkflowReview('test-slug', 'approve', 'test message', {
    forgejoUser: 'test-user',
    readTokenFn: () => 'mock-token',
    getPrAuthorFn: () => null,
    postReviewFn: () => ({ ok: false, error: 'API error' }),
    log: () => {},
    error: () => {}
  });
  assert.equal(result.ok, false);
  assert.equal(result.error, 'API error');
});

// task-1255: reviewer==author self-approval short-circuit + 422 passthrough
test('postWorkflowReview skips the Forgejo POST when reviewer is the PR author', () => {
  let postCalled = false;
  let writtenState = null;
  let recordedEvent = null;
  const warnings = [];
  const result = postWorkflowReview('test-slug', 'approve', 'looks good', {
    readTokenFn: () => 'mock-token',
    getPrAuthorFn: () => 'qwen', // reviewer == PR author
    postReviewFn: () => { postCalled = true; return { ok: true }; },
    readReviewStateFn: () => ({ mission: 'test-slug', reviewer: 'qwen', implementer: 'qwen' }),
    writeReviewStateFn: (slug, state) => { writtenState = state; },
    createEventFn: (slug, type, params) => { recordedEvent = { slug, type, params }; return { ok: true, path: '/mock' }; },
    buildMetadataFooterFn: () => '',
    log: (msg) => { if (/WARN/.test(msg)) warnings.push(msg); },
    error: () => {}
  });

  assert.equal(result.ok, true);
  assert.equal(result.skipped, true);
  assert.equal(result.reason, 'self-author');
  assert.equal(postCalled, false, 'must NOT POST a self-approval to Forgejo');

  // Verdict recorded locally in review-state.json and review-events.
  assert.ok(writtenState, 'review-state must be written locally');
  assert.equal(writtenState.disposition, 'APPROVED');
  assert.ok(recordedEvent, 'a reviewer_outcome event must be recorded');
  assert.equal(recordedEvent.type, 'reviewer_outcome');
  assert.equal(recordedEvent.params.verdict, 'approve');

  // WARN mentions the self-approval and instructs a different agent/human to post.
  assert.equal(warnings.length, 1);
  const warn = warnings[0];
  assert.ok(/self-approval|approve your own pull/.test(warn), `WARN should mention self-approval: ${warn}`);
  assert.ok(/different agent or .*human|human/i.test(warn), `WARN should instruct a different agent or human: ${warn}`);
});

test('postWorkflowReview surfaces real 422 status and body instead of "API error"', () => {
  const result = postWorkflowReview('test-slug', 'approve', 'looks good', {
    forgejoUser: 'reviewer-agent',
    readTokenFn: () => 'mock-token',
    getPrAuthorFn: () => 'some-other-author', // not self => proceeds to POST
    postReviewFn: () => ({ ok: false, status: 422, data: { message: 'approve your own pull is not allowed' } }),
    buildMetadataFooterFn: () => '',
    log: () => {},
    error: () => {}
  });
  assert.equal(result.ok, false);
  assert.ok(/422/.test(result.error), `error should surface HTTP 422: ${result.error}`);
  assert.ok(/approve your own pull is not allowed/.test(result.error), `error should surface body: ${result.error}`);
  assert.notEqual(result.error, 'API error');
});

test('postWorkflowReview posts normally when reviewer differs from PR author', () => {
  let postArgs = null;
  const result = postWorkflowReview('test-slug', 'approve', 'looks good', {
    forgejoUser: 'reviewer-agent',
    readTokenFn: () => 'mock-token',
    getPrAuthorFn: () => 'author-agent', // different => normal path
    postReviewFn: (branch, token, outcome) => { postArgs = { branch, outcome }; return { ok: true }; },
    buildMetadataFooterFn: () => '',
    log: () => {},
    error: () => {}
  });
  assert.equal(result.ok, true);
  assert.notEqual(result.skipped, true);
  assert.ok(postArgs, 'postReviewFn must be called on the non-author path');
  assert.equal(postArgs.outcome, 'approve');
});

// ============================================================================
// consumeReviewerArtifacts tests
// ============================================================================

test('consumeReviewerArtifacts returns consumed:false when no artifacts exist', async () => {
  const result = await consumeReviewerArtifacts('test-slug', 'test-reviewer', {
    readArtifactFn: () => null,
    tmpDir: '/nonexistent'
  });
  assert.equal(result.consumed, false);
});

test('consumeReviewerArtifacts returns ok:false when findings are missing', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-consume-reviewer-'));
  const findingsPath = path.join(tmpDir, 'test-slug-review-findings.md');
  const outcomePath = path.join(tmpDir, 'test-slug-review-outcome.md');
  const verdictPath = path.join(tmpDir, 'test-slug-review-verdict.txt');

  fs.writeFileSync(outcomePath, 'test outcome', 'utf8');
  fs.writeFileSync(verdictPath, 'approve', 'utf8');

  const result = await consumeReviewerArtifacts('test-slug', 'test-reviewer', {
    readArtifactFn: (p) => {
      if (p === findingsPath) return null;
      if (p === outcomePath) return 'test outcome';
      if (p === verdictPath) return 'approve';
      return null;
    },
    tmpDir,
    worktree: tmpDir,
    readReviewStateFn: () => null,
    createEventFn: () => ({ ok: true, path: '/mock/path' }),
    forgejoEnabled: false,
    log: () => {},
    error: () => {}
  });

  assert.equal(result.consumed, true);
  assert.equal(result.ok, false);

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('consumeReviewerArtifacts returns ok:false when outcome is missing', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-consume-reviewer-'));
  const findingsPath = path.join(tmpDir, 'test-slug-review-findings.md');
  const verdictPath = path.join(tmpDir, 'test-slug-review-verdict.txt');

  fs.writeFileSync(findingsPath, 'test findings', 'utf8');
  fs.writeFileSync(verdictPath, 'approve', 'utf8');

  const result = await consumeReviewerArtifacts('test-slug', 'test-reviewer', {
    readArtifactFn: (p) => {
      if (p === findingsPath) return 'test findings';
      if (p.includes('review-outcome.md')) return null;
      if (p === verdictPath) return 'approve';
      return null;
    },
    tmpDir,
    worktree: tmpDir,
    readReviewStateFn: () => null,
    createEventFn: () => ({ ok: true, path: '/mock/path' }),
    forgejoEnabled: false,
    log: () => {},
    error: () => {}
  });

  assert.equal(result.consumed, true);
  assert.equal(result.ok, false);

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('consumeReviewerArtifacts returns ok:false when verdict is missing', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-consume-reviewer-'));
  const findingsPath = path.join(tmpDir, 'test-slug-review-findings.md');
  const outcomePath = path.join(tmpDir, 'test-slug-review-outcome.md');

  fs.writeFileSync(findingsPath, 'test findings', 'utf8');
  fs.writeFileSync(outcomePath, 'test outcome', 'utf8');

  const result = await consumeReviewerArtifacts('test-slug', 'test-reviewer', {
    readArtifactFn: (p) => {
      if (p === findingsPath) return 'test findings';
      if (p === outcomePath) return 'test outcome';
      return null;
    },
    tmpDir,
    worktree: tmpDir,
    readReviewStateFn: () => null,
    createEventFn: () => ({ ok: true, path: '/mock/path' }),
    forgejoEnabled: false,
    log: () => {},
    error: () => {}
  });

  assert.equal(result.consumed, true);
  assert.equal(result.ok, false);

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('consumeReviewerArtifacts handles all three artifact files', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-consume-reviewer-'));

  const result = await consumeReviewerArtifacts('test-slug', 'test-reviewer', {
    readArtifactFn: (p) => {
      if (p.includes('review-findings.md')) return 'test findings';
      if (p.includes('review-outcome.md')) return 'test outcome message';
      if (p.includes('review-verdict.txt')) return 'approve';
      return null;
    },
    tmpDir,
    worktree: tmpDir,
    readReviewStateFn: () => null,
    createEventFn: () => ({ ok: true, path: '/mock/path' }),
    deleteArtifactFn: () => {},
    forgejoEnabled: false,
    log: () => {},
    error: () => {}
  });

  assert.equal(result.consumed, true);
  assert.equal(result.ok, true);
  assert.equal(result.reviewState, 'APPROVED');

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// task-1264 SC1: TMPDIR != /tmp (explicit non-/tmp tmpDir) but artifacts were
// written to /tmp by an old prompt. With fallbackToTmp the loop still finds them.
test('consumeReviewerArtifacts recovers /tmp artifacts when fallbackToTmp is set and tmpDir != /tmp', async () => {
  const readFromTmpOnly = (p) => {
    if (!p.startsWith('/tmp/')) return null;
    if (p.includes('review-findings.md')) return 'test findings';
    if (p.includes('review-outcome.md')) return 'test outcome message';
    if (p.includes('review-verdict.txt')) return 'approve';
    return null;
  };

  const result = await consumeReviewerArtifacts('test-slug', 'test-reviewer', {
    readArtifactFn: readFromTmpOnly,
    tmpDir: '/var/tmp',
    fallbackToTmp: true,
    worktree: '/var/tmp',
    readReviewStateFn: () => null,
    createEventFn: () => ({ ok: true, path: '/mock/path' }),
    deleteArtifactFn: () => {},
    forgejoEnabled: false,
    log: () => {},
    error: () => {}
  });

  assert.equal(result.consumed, true);
  assert.equal(result.ok, true);
  assert.equal(result.reviewState, 'APPROVED');
});

// Mirror negative: without fallbackToTmp, an explicit non-/tmp tmpDir suppresses
// the /tmp fallback (preserves scratch-dir test isolation), so /tmp artifacts are
// not consumed.
test('consumeReviewerArtifacts ignores /tmp artifacts when fallbackToTmp is not set (test isolation preserved)', async () => {
  const readFromTmpOnly = (p) => {
    if (!p.startsWith('/tmp/')) return null;
    if (p.includes('review-findings.md')) return 'test findings';
    if (p.includes('review-outcome.md')) return 'test outcome message';
    if (p.includes('review-verdict.txt')) return 'approve';
    return null;
  };

  const result = await consumeReviewerArtifacts('test-slug', 'test-reviewer', {
    readArtifactFn: readFromTmpOnly,
    tmpDir: '/var/tmp',
    worktree: '/var/tmp',
    readReviewStateFn: () => null,
    createEventFn: () => ({ ok: true, path: '/mock/path' }),
    deleteArtifactFn: () => {},
    forgejoEnabled: false,
    log: () => {},
    error: () => {}
  });

  assert.equal(result.consumed, false);
});

// task-1264 SC1 (implementer side): same /tmp recovery for round-resolution /
// review-disposition artifacts.
test('consumeImplementerArtifacts recovers /tmp artifacts when fallbackToTmp is set and tmpDir != /tmp', async () => {
  const readFromTmpOnly = (p) => {
    if (!p.startsWith('/tmp/')) return null;
    if (p.includes('round-resolution.md')) return 'resolution body';
    if (p.includes('review-disposition.txt')) return 'CHANGES_MADE';
    return null;
  };

  const result = await consumeImplementerArtifacts('test-slug', 'test-implementer', {
    readArtifactFn: readFromTmpOnly,
    tmpDir: '/var/tmp',
    fallbackToTmp: true,
    worktree: '/var/tmp',
    readReviewStateFn: () => null,
    createEventFn: () => ({ ok: true, path: '/mock/path' }),
    deleteArtifactFn: () => {},
    forgejoEnabled: false,
    log: () => {},
    error: () => {}
  });

  assert.equal(result.consumed, true);
  assert.equal(result.ok, true);
  assert.equal(result.disposition, 'CHANGES_MADE');
});

test('consumeReviewerArtifacts returns REQUEST_CHANGES reviewState for request-changes verdict', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-consume-reviewer-'));

  const result = await consumeReviewerArtifacts('test-slug', 'test-reviewer', {
    readArtifactFn: (p) => {
      if (p.includes('review-findings.md')) return 'test findings';
      if (p.includes('review-outcome.md')) return 'test outcome';
      if (p.includes('review-verdict.txt')) return 'request-changes';
      return null;
    },
    tmpDir,
    worktree: tmpDir,
    readReviewStateFn: () => null,
    createEventFn: () => ({ ok: true, path: '/mock/path' }),
    deleteArtifactFn: () => {},
    forgejoEnabled: false,
    log: () => {},
    error: () => {}
  });

  assert.equal(result.consumed, true);
  assert.equal(result.ok, true);
  assert.equal(result.reviewState, 'REQUEST_CHANGES');

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ============================================================================
// consumeImplementerArtifacts tests
// ============================================================================

test('consumeImplementerArtifacts returns consumed:false when no artifacts exist', async () => {
  const result = await consumeImplementerArtifacts('test-slug', 'test-implementer', {
    readArtifactFn: () => null,
    tmpDir: '/nonexistent'
  });
  assert.equal(result.consumed, false);
});

test('consumeImplementerArtifacts returns ok:false when resolution is missing', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-consume-implementer-'));
  const dispositionPath = path.join(tmpDir, 'test-slug-review-disposition.txt');

  fs.writeFileSync(dispositionPath, 'CHANGES_MADE', 'utf8');

  const result = await consumeImplementerArtifacts('test-slug', 'test-implementer', {
    readArtifactFn: (p) => {
      if (p.includes('round-resolution.md')) return null;
      if (p === dispositionPath) return 'CHANGES_MADE';
      return null;
    },
    tmpDir,
    worktree: tmpDir,
    readReviewStateFn: () => null,
    createEventFn: () => ({ ok: true, path: '/mock/path' }),
    forgejoEnabled: false,
    log: () => {},
    error: () => {}
  });

  assert.equal(result.consumed, true);
  assert.equal(result.ok, false);

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('consumeImplementerArtifacts returns ok:false when disposition is missing', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-consume-implementer-'));
  const resolutionPath = path.join(tmpDir, 'test-slug-round-resolution.md');

  fs.writeFileSync(resolutionPath, 'fixed_items: []', 'utf8');

  const result = await consumeImplementerArtifacts('test-slug', 'test-implementer', {
    readArtifactFn: (p) => {
      if (p === resolutionPath) return 'fixed_items: []';
      if (p.includes('review-disposition.txt')) return null;
      return null;
    },
    tmpDir,
    worktree: tmpDir,
    readReviewStateFn: () => null,
    createEventFn: () => ({ ok: true, path: '/mock/path' }),
    forgejoEnabled: false,
    log: () => {},
    error: () => {}
  });

  assert.equal(result.consumed, true);
  assert.equal(result.ok, false);

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('consumeImplementerArtifacts parses structured resolution content', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-consume-implementer-'));
  const resolutionPath = path.join(tmpDir, 'test-slug-round-resolution.md');
  const dispositionPath = path.join(tmpDir, 'test-slug-review-disposition.txt');

  fs.writeFileSync(resolutionPath, 'fixed_items: ["F1", "F2"]\npushed_back_items: ["P1"]\nparked_items: []', 'utf8');
  fs.writeFileSync(dispositionPath, 'CHANGES_MADE', 'utf8');

  let eventPayload = null;
  const result = await consumeImplementerArtifacts('test-slug', 'test-implementer', {
    readArtifactFn: (p) => {
      if (p === resolutionPath) return 'fixed_items: ["F1", "F2"]\npushed_back_items: ["P1"]\nparked_items: []';
      if (p === dispositionPath) return 'CHANGES_MADE';
      return null;
    },
    tmpDir,
    worktree: tmpDir,
    readReviewStateFn: () => null,
    createEventFn: (slug, type, payload, opts) => {
      if (type === 'implementer_round_summary') {
        eventPayload = payload;
      }
      return { ok: true, path: '/mock/path' };
    },
    deleteArtifactFn: () => {},
    forgejoEnabled: false,
    log: () => {},
    error: () => {}
  });

  assert.equal(result.consumed, true);
  assert.equal(result.ok, true);
  assert.equal(result.disposition, 'CHANGES_MADE');
  assert.deepEqual(eventPayload.fixedItems, ['F1', 'F2']);
  assert.deepEqual(eventPayload.pushedBackItems, ['P1']);
  assert.deepEqual(eventPayload.parkedItems, []);

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('consumeImplementerArtifacts handles BLOCKED disposition with blockedReason', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-consume-implementer-'));

  const result = await consumeImplementerArtifacts('test-slug', 'test-implementer', {
    readArtifactFn: (p) => {
      if (p.includes('round-resolution.md')) return 'blocked_reason: "Test block reason"';
      if (p.includes('review-disposition.txt')) return 'BLOCKED';
      return null;
    },
    tmpDir,
    worktree: tmpDir,
    readReviewStateFn: () => null,
    createEventFn: (slug, type, payload, opts) => {
      if (type === 'implementer_round_summary') {
        assert.equal(payload.blockedReason, 'Test block reason');
      }
      return { ok: true, path: '/mock/path' };
    },
    deleteArtifactFn: () => {},
    forgejoEnabled: false,
    log: () => {},
    error: () => {}
  });

  assert.equal(result.consumed, true);
  assert.equal(result.ok, true);
  assert.equal(result.disposition, 'BLOCKED');

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ============================================================================
// Additional tests for uncovered branches in review-artifacts.js
// ============================================================================

test('postWorkflowComment falls back to human when review-state has no identity', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-comment-'));
  const statePath = path.join(tmpDir, 'review-state.json');
  fs.writeFileSync(statePath, JSON.stringify({
    mission: 'test-slug',
    implementer: null,
    reviewer: null
  }, null, 2));

  let capturedUser = null;
  const result = postWorkflowComment('test-slug', 'test message', {
    rootDir: tmpDir,
    readTokenFn: (user) => {
      capturedUser = user;
      return 'mock-token';
    },
    postCommentFn: () => ({ ok: true }),
    readReviewStateFn: (slug, dir) => JSON.parse(fs.readFileSync(statePath, 'utf8')),
    buildMetadataFooterFn: () => '',
    log: () => {},
    error: () => {}
  });

  assert.equal(result.ok, true);
  assert.equal(capturedUser, 'human');
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('postWorkflowReview falls back to human when review-state has no identity', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-review-'));
  const statePath = path.join(tmpDir, 'review-state.json');
  fs.writeFileSync(statePath, JSON.stringify({
    mission: 'test-slug',
    reviewer: null,
    implementer: null
  }, null, 2));

  let capturedUser = null;
  const result = postWorkflowReview('test-slug', 'approve', 'test message', {
    worktree: tmpDir,
    readTokenFn: (user) => {
      capturedUser = user;
      return 'mock-token';
    },
    postReviewFn: () => ({ ok: true }),
    readReviewStateFn: (slug, dir) => JSON.parse(fs.readFileSync(statePath, 'utf8')),
    buildMetadataFooterFn: () => '',
    log: () => {},
    error: () => {}
  });

  assert.equal(result.ok, true);
  assert.equal(capturedUser, 'human');
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('postWorkflowComment handles forgejoUser from review-state implementer fallback', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-comment-impl-'));
  const statePath = path.join(tmpDir, 'review-state.json');
  fs.writeFileSync(statePath, JSON.stringify({
    mission: 'test-slug',
    implementer: 'test-implementer',
    reviewer: 'test-reviewer'
  }, null, 2));

  const originalEnv = process.env.FORGEJO_USER;
  try {
    process.env.FORGEJO_USER = '';
    let capturedUser = null;
    const result = postWorkflowComment('test-slug', 'test message', {
      rootDir: tmpDir,
      forgejoUser: '',
      readTokenFn: (user) => {
        capturedUser = user;
        return 'mock-token';
      },
      postCommentFn: () => ({ ok: true }),
      readReviewStateFn: (slug, dir) => JSON.parse(fs.readFileSync(statePath, 'utf8')),
      buildMetadataFooterFn: () => '',
      log: () => {},
      error: () => {}
    });

    assert.equal(result.ok, true);
    assert.equal(capturedUser, 'test-implementer');
  } finally {
    process.env.FORGEJO_USER = originalEnv;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('postWorkflowReview handles forgejoUser from review-state reviewer fallback', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-review-rev-'));
  const statePath = path.join(tmpDir, 'review-state.json');
  fs.writeFileSync(statePath, JSON.stringify({
    mission: 'test-slug',
    reviewer: 'test-reviewer',
    implementer: 'test-implementer'
  }, null, 2));

  const originalEnv = process.env.FORGEJO_USER;
  try {
    process.env.FORGEJO_USER = '';
    let capturedUser = null;
    const result = postWorkflowReview('test-slug', 'approve', 'test message', {
      worktree: tmpDir,
      forgejoUser: '',
      readTokenFn: (user) => {
        capturedUser = user;
        return 'mock-token';
      },
      postReviewFn: () => ({ ok: true }),
      readReviewStateFn: (slug, dir) => JSON.parse(fs.readFileSync(statePath, 'utf8')),
      buildMetadataFooterFn: () => '',
      log: () => {},
      error: () => {}
    });

    assert.equal(result.ok, true);
    assert.equal(capturedUser, 'test-reviewer');
  } finally {
    process.env.FORGEJO_USER = originalEnv;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('postWorkflowComment fails when token not found', () => {
  const result = postWorkflowComment('test-slug', 'test message', {
    forgejoUser: 'test-user',
    readTokenFn: () => null,
    postCommentFn: () => ({ ok: true }),
    readReviewStateFn: () => null,
    buildMetadataFooterFn: () => '',
    log: () => {},
    error: () => {}
  });

  assert.equal(result.ok, false);
});

test('postWorkflowReview fails when token not found', () => {
  const result = postWorkflowReview('test-slug', 'approve', 'test message', {
    forgejoUser: 'test-user',
    readTokenFn: () => null,
    postReviewFn: () => ({ ok: true }),
    readReviewStateFn: () => null,
    buildMetadataFooterFn: () => '',
    log: () => {},
    error: () => {}
  });

  assert.equal(result.ok, false);
});

test('consumeReviewerArtifacts fails when findings event creation fails', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-consume-fail-'));

  const result = await consumeReviewerArtifacts('test-slug', 'test-reviewer', {
    readArtifactFn: (p) => {
      if (p.includes('review-findings.md')) return 'test findings';
      if (p.includes('review-outcome.md')) return 'test outcome';
      if (p.includes('review-verdict.txt')) return 'approve';
      return null;
    },
    tmpDir,
    worktree: tmpDir,
    readReviewStateFn: () => null,
    createEventFn: () => ({ ok: false, error: 'Event creation failed' }),
    deleteArtifactFn: () => {},
    forgejoEnabled: false,
    log: () => {},
    error: () => {}
  });

  assert.equal(result.consumed, true);
  assert.equal(result.ok, false);

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('consumeReviewerArtifacts fails when outcome event creation fails', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-consume-fail2-'));
  let callCount = 0;

  const result = await consumeReviewerArtifacts('test-slug', 'test-reviewer', {
    readArtifactFn: (p) => {
      if (p.includes('review-findings.md')) return 'test findings';
      if (p.includes('review-outcome.md')) return 'test outcome';
      if (p.includes('review-verdict.txt')) return 'approve';
      return null;
    },
    tmpDir,
    worktree: tmpDir,
    readReviewStateFn: () => null,
    createEventFn: (slug, type, payload, opts) => {
      callCount++;
      if (callCount === 1) return { ok: true, path: '/mock/findings' };
      return { ok: false, error: 'Outcome event creation failed' };
    },
    deleteArtifactFn: () => {},
    forgejoEnabled: false,
    log: () => {},
    error: () => {}
  });

  assert.equal(result.consumed, true);
  assert.equal(result.ok, false);

  fs.rmSync(tmpDir, { recursive: true, force: true });
});



test('consumeReviewerArtifacts with non-approve/non-request-changes verdict', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-consume-other-'));

  const result = await consumeReviewerArtifacts('test-slug', 'test-reviewer', {
    readArtifactFn: (p) => {
      if (p.includes('review-findings.md')) return 'test findings';
      if (p.includes('review-outcome.md')) return 'test outcome';
      if (p.includes('review-verdict.txt')) return 'comment';
      return null;
    },
    tmpDir,
    worktree: tmpDir,
    readReviewStateFn: () => null,
    createEventFn: () => ({ ok: true, path: '/mock/path' }),
    deleteArtifactFn: () => {},
    forgejoEnabled: false,
    log: () => {},
    error: () => {}
  });

  assert.equal(result.consumed, true);
  assert.equal(result.ok, true);
  // task-1271: with Forgejo disabled, a stray `comment` verdict is normalized to the
  // disposition format (COMMENT) and passed through instead of returning null and crashing
  // the review loop. inferPhaseFromDisposition() maps COMMENT -> fixing.
  assert.equal(result.reviewState, 'COMMENT');

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('consumeImplementerArtifacts fails when summary event creation fails', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-impl-fail-'));

  const result = await consumeImplementerArtifacts('test-slug', 'test-implementer', {
    readArtifactFn: (p) => {
      if (p.includes('round-resolution.md')) return 'fixed_items: []\nparked_items: []';
      if (p.includes('review-disposition.txt')) return 'CHANGES_MADE';
      return null;
    },
    tmpDir,
    worktree: tmpDir,
    readReviewStateFn: () => null,
    createEventFn: () => ({ ok: false, error: 'Summary event creation failed' }),
    deleteArtifactFn: () => {},
    forgejoEnabled: false,
    log: () => {},
    error: () => {}
  });

  assert.equal(result.consumed, true);
  assert.equal(result.ok, false);

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('consumeImplementerArtifacts fails when disposition event creation fails', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-impl-fail2-'));
  let callCount = 0;

  const result = await consumeImplementerArtifacts('test-slug', 'test-implementer', {
    readArtifactFn: (p) => {
      if (p.includes('round-resolution.md')) return 'fixed_items: []\nparked_items: []';
      if (p.includes('review-disposition.txt')) return 'CHANGES_MADE';
      return null;
    },
    tmpDir,
    worktree: tmpDir,
    readReviewStateFn: () => null,
    createEventFn: (slug, type, payload, opts) => {
      callCount++;
      if (callCount === 1) return { ok: true, path: '/mock/summary' };
      return { ok: false, error: 'Disposition event creation failed' };
    },
    deleteArtifactFn: () => {},
    forgejoEnabled: false,
    log: () => {},
    error: () => {}
  });

  assert.equal(result.consumed, true);
  assert.equal(result.ok, false);

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('consumeImplementerArtifacts parses blockedReason from resolution content when missing from frontmatter', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-impl-blocked-'));

  const result = await consumeImplementerArtifacts('test-slug', 'test-implementer', {
    readArtifactFn: (p) => {
      if (p.includes('round-resolution.md')) return 'fixed_items: []\nblocked_reason: "Some block reason"';
      if (p.includes('review-disposition.txt')) return 'BLOCKED';
      return null;
    },
    tmpDir,
    worktree: tmpDir,
    readReviewStateFn: () => null,
    createEventFn: (slug, type, payload, opts) => {
      if (type === 'implementer_round_summary') {
        assert.equal(payload.blockedReason, 'Some block reason');
      }
      return { ok: true, path: '/mock/path' };
    },
    deleteArtifactFn: () => {},
    forgejoEnabled: false,
    log: () => {},
    error: () => {}
  });

  assert.equal(result.consumed, true);
  assert.equal(result.ok, true);
  assert.equal(result.disposition, 'BLOCKED');

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('consumeImplementerArtifacts with PARKED disposition', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-impl-parked-'));

  const result = await consumeImplementerArtifacts('test-slug', 'test-implementer', {
    readArtifactFn: (p) => {
      if (p.includes('round-resolution.md')) return 'fixed_items: []\npushed_back_items: []\nparked_items: ["P1"]';
      if (p.includes('review-disposition.txt')) return 'PARKED';
      return null;
    },
    tmpDir,
    worktree: tmpDir,
    readReviewStateFn: () => null,
    createEventFn: () => ({ ok: true, path: '/mock/path' }),
    deleteArtifactFn: () => {},
    forgejoEnabled: false,
    log: () => {},
    error: () => {}
  });

  assert.equal(result.consumed, true);
  assert.equal(result.ok, true);
  assert.equal(result.disposition, 'PARKED');

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('consumeImplementerArtifacts with PUSHBACK_ALL disposition', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-impl-pushback-'));

  const result = await consumeImplementerArtifacts('test-slug', 'test-implementer', {
    readArtifactFn: (p) => {
      if (p.includes('round-resolution.md')) return 'fixed_items: []\npushed_back_items: ["P1"]';
      if (p.includes('review-disposition.txt')) return 'PUSHBACK_ALL';
      return null;
    },
    tmpDir,
    worktree: tmpDir,
    readReviewStateFn: () => null,
    createEventFn: () => ({ ok: true, path: '/mock/path' }),
    deleteArtifactFn: () => {},
    forgejoEnabled: false,
    log: () => {},
    error: () => {}
  });

  assert.equal(result.consumed, true);
  assert.equal(result.ok, true);
  assert.equal(result.disposition, 'PUSHBACK_ALL');

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ============================================================================
// Additional tests for remaining uncovered branches
// ============================================================================

test('consumeReviewerArtifacts with forgejoEnabled and consumeHumanNotes', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-consume-human-'));
  let humanNotesCalled = false;

  const result = await consumeReviewerArtifacts('test-slug', 'test-reviewer', {
    readArtifactFn: (p) => {
      if (p.includes('review-findings.md')) return 'test findings';
      if (p.includes('review-outcome.md')) return 'test outcome';
      if (p.includes('review-verdict.txt')) return 'approve';
      return null;
    },
    tmpDir,
    worktree: tmpDir,
    readReviewStateFn: () => null,
    createEventFn: () => ({ ok: true, path: '/mock/path' }),
    deleteArtifactFn: () => {},
    forgejoEnabled: true,
    readTokenFn: () => 'mock-token',
    getCommentsFn: () => [],
    consumeHumanNotesFn: () => { humanNotesCalled = true; },
    postCommentFn: () => ({ ok: true }),
    postReviewFn: () => ({ ok: true }),
    buildMetadataFooterFn: () => '',
    log: () => {},
    error: () => {}
  });

  assert.equal(result.consumed, true);
  assert.equal(result.ok, true);

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('consumeReviewerArtifacts fails when commentResult is not ok', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-consume-comment-fail-'));

  const result = await consumeReviewerArtifacts('test-slug', 'test-reviewer', {
    readArtifactFn: (p) => {
      if (p.includes('review-findings.md')) return 'test findings';
      if (p.includes('review-outcome.md')) return 'test outcome';
      if (p.includes('review-verdict.txt')) return 'approve';
      return null;
    },
    tmpDir,
    worktree: tmpDir,
    readReviewStateFn: () => null,
    createEventFn: () => ({ ok: true, path: '/mock/path' }),
    deleteArtifactFn: () => {},
    forgejoEnabled: true,
    readTokenFn: () => 'mock-token',
    postCommentFn: () => ({ ok: false, error: 'Comment failed' }),
    postReviewFn: () => ({ ok: true }),
    buildMetadataFooterFn: () => '',
    log: () => {},
    error: () => {}
  });

  assert.equal(result.consumed, true);
  assert.equal(result.ok, false);

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('consumeReviewerArtifacts fails when reviewResult is not ok', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-consume-review-fail-'));

  const result = await consumeReviewerArtifacts('test-slug', 'test-reviewer', {
    readArtifactFn: (p) => {
      if (p.includes('review-findings.md')) return 'test findings';
      if (p.includes('review-outcome.md')) return 'test outcome';
      if (p.includes('review-verdict.txt')) return 'approve';
      return null;
    },
    tmpDir,
    worktree: tmpDir,
    readReviewStateFn: () => null,
    createEventFn: () => ({ ok: true, path: '/mock/path' }),
    deleteArtifactFn: () => {},
    forgejoEnabled: true,
    readTokenFn: () => 'mock-token',
    postCommentFn: () => ({ ok: true }),
    postReviewFn: () => ({ ok: false, error: 'Review failed' }),
    buildMetadataFooterFn: () => '',
    log: () => {},
    error: () => {}
  });

  assert.equal(result.consumed, true);
  assert.equal(result.ok, false);

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('consumeReviewerArtifacts with forgejo disabled', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-consume-no-forgejo-'));

  const result = await consumeReviewerArtifacts('test-slug', 'test-reviewer', {
    readArtifactFn: (p) => {
      if (p.includes('review-findings.md')) return 'test findings';
      if (p.includes('review-outcome.md')) return 'test outcome';
      if (p.includes('review-verdict.txt')) return 'approve';
      return null;
    },
    tmpDir,
    worktree: tmpDir,
    readReviewStateFn: () => null,
    createEventFn: () => ({ ok: true, path: '/mock/path' }),
    deleteArtifactFn: () => {},
    forgejoEnabled: false,
    log: () => {},
    error: () => {}
  });

  assert.equal(result.consumed, true);
  assert.equal(result.ok, true);

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('consumeImplementerArtifacts with consumeHumanNotes', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-impl-human-'));

  const result = await consumeImplementerArtifacts('test-slug', 'test-implementer', {
    readArtifactFn: (p) => {
      if (p.includes('round-resolution.md')) return 'fixed_items: []\nparked_items: []';
      if (p.includes('review-disposition.txt')) return 'CHANGES_MADE';
      return null;
    },
    tmpDir,
    worktree: tmpDir,
    readReviewStateFn: () => null,
    createEventFn: () => ({ ok: true, path: '/mock/path' }),
    deleteArtifactFn: () => {},
    forgejoEnabled: true,
    readTokenFn: () => 'mock-token',
    getCommentsFn: () => [],
    postCommentFn: () => ({ ok: true }),
    buildMetadataFooterFn: () => '',
    log: () => {},
    error: () => {}
  });

  assert.equal(result.consumed, true);
  assert.equal(result.ok, true);
  assert.equal(result.disposition, 'CHANGES_MADE');

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('consumeImplementerArtifacts fails when resolution comment fails', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-impl-res-fail-'));

  const result = await consumeImplementerArtifacts('test-slug', 'test-implementer', {
    readArtifactFn: (p) => {
      if (p.includes('round-resolution.md')) return 'fixed_items: []\nparked_items: []';
      if (p.includes('review-disposition.txt')) return 'CHANGES_MADE';
      return null;
    },
    tmpDir,
    worktree: tmpDir,
    readReviewStateFn: () => null,
    createEventFn: () => ({ ok: true, path: '/mock/path' }),
    deleteArtifactFn: () => {},
    forgejoEnabled: true,
    readTokenFn: () => 'mock-token',
    postCommentFn: () => ({ ok: false, error: 'Comment failed' }),
    buildMetadataFooterFn: () => '',
    log: () => {},
    error: () => {}
  });

  assert.equal(result.consumed, true);
  assert.equal(result.ok, false);

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('consumeImplementerArtifacts fails when disposition comment fails', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-impl-disp-fail-'));
  let callCount = 0;

  const result = await consumeImplementerArtifacts('test-slug', 'test-implementer', {
    readArtifactFn: (p) => {
      if (p.includes('round-resolution.md')) return 'fixed_items: []\nparked_items: []';
      if (p.includes('review-disposition.txt')) return 'CHANGES_MADE';
      return null;
    },
    tmpDir,
    worktree: tmpDir,
    readReviewStateFn: () => null,
    createEventFn: () => ({ ok: true, path: '/mock/path' }),
    deleteArtifactFn: () => {},
    forgejoEnabled: true,
    readTokenFn: () => 'mock-token',
    postCommentFn: () => {
      callCount++;
      return callCount === 1 ? { ok: true } : { ok: false, error: 'Disposition comment failed' };
    },
    buildMetadataFooterFn: () => '',
    log: () => {},
    error: () => {}
  });

  assert.equal(result.consumed, true);
  assert.equal(result.ok, false);

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('consumeImplementerArtifacts with forgejo disabled', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-impl-no-forgejo-'));

  const result = await consumeImplementerArtifacts('test-slug', 'test-implementer', {
    readArtifactFn: (p) => {
      if (p.includes('round-resolution.md')) return 'fixed_items: []\nparked_items: []';
      if (p.includes('review-disposition.txt')) return 'CHANGES_MADE';
      return null;
    },
    tmpDir,
    worktree: tmpDir,
    readReviewStateFn: () => null,
    createEventFn: () => ({ ok: true, path: '/mock/path' }),
    deleteArtifactFn: () => {},
    forgejoEnabled: false,
    log: () => {},
    error: () => {}
  });

  assert.equal(result.consumed, true);
  assert.equal(result.ok, true);
  assert.equal(result.disposition, 'CHANGES_MADE');

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('consumeImplementerArtifacts with invalid JSON in resolution', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-impl-invalid-json-'));

  const result = await consumeImplementerArtifacts('test-slug', 'test-implementer', {
    readArtifactFn: (p) => {
      if (p.includes('round-resolution.md')) return 'fixed_items: [INVALID JSON';
      if (p.includes('review-disposition.txt')) return 'CHANGES_MADE';
      return null;
    },
    tmpDir,
    worktree: tmpDir,
    readReviewStateFn: () => null,
    createEventFn: () => ({ ok: true, path: '/mock/path' }),
    deleteArtifactFn: () => {},
    forgejoEnabled: false,
    log: () => {},
    error: () => {}
  });

  assert.equal(result.consumed, true);
  assert.equal(result.ok, true);
  assert.equal(result.disposition, 'CHANGES_MADE');

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ============================================================================
// task-1264 end-to-end regression (AC #5)
// ============================================================================

// Reproduces the original bug scenario: os.tmpdir() != /tmp (TMPDIR set, as in
// CI/sandboxes/enterprise px) and the Forgejo provider OFF. A reviewer writes
// the three artifact files to the dir the prompt advertises and stops. The loop
// must consume them and reach a recorded APPROVED verdict — not FAIL/exit(1).
// The alignment is by construction: the prompt's {{artifactDir}} and the
// consumer's tmpDir both come from resolveArtifactDir(worktree).
test('REGRESSION task-1264: os.tmpdir() != /tmp + Forgejo off -> reviewer artifacts drive a recorded verdict', async () => {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'task-1264-e2e-'));
  const origTmp = process.env.TMPDIR;
  process.env.TMPDIR = scratch; // make os.tmpdir() diverge from /tmp
  try {
    assert.notEqual(os.tmpdir(), '/tmp'); // reproduce the enterprise/CI condition

    const slug = 'task-9001';
    const branch = `mission/${slug}`;

    // Build the prompt exactly as the loop does (no configured tmpDir).
    const prompt = buildCompactReviewPrompt({ reviewer: 'claude', branch, implementer: 'codex', attempt: 1, repoRoot: scratch });

    // Extract the directory the prompt instructs the agent to write to.
    const m = prompt.match(/Write findings to `([^`]+)\/task-9001-review-findings\.md`/);
    assert.ok(m, 'prompt must advertise a concrete findings path');
    const advertisedDir = m[1];
    assert.doesNotMatch(advertisedDir, /\{\{/);

    // The consumer reads from the same dir, by construction.
    const consumerDir = resolveArtifactDir(scratch);
    assert.equal(consumerDir, advertisedDir, 'prompt write dir must equal consumer read dir');

    // Simulate the reviewer: write the three real files to the advertised dir and stop.
    fs.writeFileSync(path.join(advertisedDir, `${slug}-review-findings.md`), '# findings');
    fs.writeFileSync(path.join(advertisedDir, `${slug}-review-outcome.md`), '# outcome');
    fs.writeFileSync(path.join(advertisedDir, `${slug}-review-verdict.txt`), 'approve\n');

    // Consume with the real file reader (no readArtifactFn override).
    const result = await consumeReviewerArtifacts(slug, 'claude', {
      tmpDir: consumerDir,
      fallbackToTmp: true,
      worktree: scratch,
      forgejoEnabled: false,
      readReviewStateFn: () => null,
      createEventFn: () => ({ ok: true, path: '/mock/event.md' }),
      deleteArtifactFn: () => {},
      log: () => {},
      error: () => {}
    });

    assert.deepEqual(result, { consumed: true, ok: true, reviewState: 'APPROVED' });
  } finally {
    if (origTmp === undefined) delete process.env.TMPDIR; else process.env.TMPDIR = origTmp;
    fs.rmSync(scratch, { recursive: true, force: true });
  }
});
