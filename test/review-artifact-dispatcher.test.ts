// @ts-nocheck -- TASK-2274: role-owned artifact recovery dispatcher tests

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  consumeReviewerArtifacts,
  consumeImplementerArtifacts,
  dispatchArtifactFailure,
  MAX_ARTIFACT_RETRY,
  REVIEWER_ARTIFACT_RETRY_KEY,
  IMPLEMENTER_ARTIFACT_RETRY_KEY,
  isArtifactInfraDiagnostic,
} from '../src/adapters/review/review-artifacts.js';

// ============================================================================
// consumeReviewerArtifacts — diagnostic field tests
// ============================================================================

test('consumeReviewerArtifacts returns diagnostic when findings are missing', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-dispatcher-'));
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
  assert.ok(result.diagnostic, 'should have diagnostic on failure');
  assert.ok(result.diagnostic!.includes('findings'), `diagnostic should mention findings: ${result.diagnostic}`);

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('consumeReviewerArtifacts returns diagnostic when outcome is missing', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-dispatcher-'));
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
  assert.ok(result.diagnostic, 'should have diagnostic on failure');
  assert.ok(result.diagnostic!.includes('outcome'), `diagnostic should mention outcome: ${result.diagnostic}`);

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('consumeReviewerArtifacts returns diagnostic when verdict is missing', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-dispatcher-'));
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
  assert.ok(result.diagnostic, 'should have diagnostic on failure');
  assert.ok(result.diagnostic!.includes('verdict'), `diagnostic should mention verdict: ${result.diagnostic}`);

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('consumeReviewerArtifacts returns diagnostic when persist fails', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-dispatcher-'));

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
    createEventFn: () => ({ ok: false, error: 'DB connection failed' }),
    forgejoEnabled: false,
    log: () => {},
    error: () => {}
  });

  assert.equal(result.consumed, true);
  assert.equal(result.ok, false);
  assert.ok(result.diagnostic, 'should have diagnostic on persist failure');
  assert.ok(result.diagnostic!.includes('persist'), `diagnostic should mention persist: ${result.diagnostic}`);

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ============================================================================
// consumeImplementerArtifacts — diagnostic field tests
// ============================================================================

test('consumeImplementerArtifacts returns diagnostic when round-resolution is missing', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-dispatcher-'));
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
  assert.ok(result.diagnostic, 'should have diagnostic on failure');
  assert.ok(result.diagnostic!.includes('round-resolution'), `diagnostic should mention round-resolution: ${result.diagnostic}`);

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('consumeImplementerArtifacts returns diagnostic when disposition is missing', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-dispatcher-'));
  const resolutionPath = path.join(tmpDir, 'test-slug-round-resolution.md');

  fs.writeFileSync(resolutionPath, 'fixed_items: ["f1"]', 'utf8');

  const result = await consumeImplementerArtifacts('test-slug', 'test-implementer', {
    readArtifactFn: (p) => {
      if (p === resolutionPath) return 'fixed_items: ["f1"]';
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
  assert.ok(result.diagnostic, 'should have diagnostic on failure');
  assert.ok(result.diagnostic!.includes('disposition'), `diagnostic should mention disposition: ${result.diagnostic}`);

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('consumeImplementerArtifacts returns diagnostic when persist fails', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-dispatcher-'));

  const result = await consumeImplementerArtifacts('test-slug', 'test-implementer', {
    readArtifactFn: (p) => {
      if (p.includes('round-resolution.md')) return 'fixed_items: ["f1"]';
      if (p.includes('review-disposition.txt')) return 'CHANGES_MADE';
      return null;
    },
    tmpDir,
    worktree: tmpDir,
    readReviewStateFn: () => null,
    createEventFn: () => ({ ok: false, error: 'DB write failed' }),
    forgejoEnabled: false,
    log: () => {},
    error: () => {}
  });

  assert.equal(result.consumed, true);
  assert.equal(result.ok, false);
  assert.ok(result.diagnostic, 'should have diagnostic on persist failure');
  assert.ok(result.diagnostic!.includes('persist'), `diagnostic should mention persist: ${result.diagnostic}`);

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ============================================================================
// dispatchArtifactFailure — reviewer role tests
// ============================================================================

test('dispatchArtifactFailure returns relaunch for reviewer on first failure', async () => {
  const state = { slug: 'test-slug', metadata: {} };
  let persistedState = state;

  const result = await dispatchArtifactFailure('reviewer', 'Reviewer artifacts incomplete: missing findings', {
    slug: 'test-slug',
    worktree: '/mock/worktree',
    readReviewStateFn: () => persistedState,
    writeReviewStateFn: async (_s, s) => { persistedState = s; return { ok: true }; },
    log: () => {},
    error: () => {}
  });

  assert.equal(result.action, 'relaunch');
  assert.equal(result.role, 'reviewer');
  assert.equal(result.retryCount, 1);
  assert.equal(result.maxRetries, MAX_ARTIFACT_RETRY);
  assert.equal(persistedState.metadata[REVIEWER_ARTIFACT_RETRY_KEY], 1);
});

test('dispatchArtifactFailure returns strand for reviewer after max retries', async () => {
  const state = { slug: 'test-slug', metadata: { [REVIEWER_ARTIFACT_RETRY_KEY]: 2 } };
  let persistedState = state;

  const result = await dispatchArtifactFailure('reviewer', 'Reviewer artifacts incomplete: missing verdict', {
    slug: 'test-slug',
    worktree: '/mock/worktree',
    readReviewStateFn: () => persistedState,
    writeReviewStateFn: async (_s, s) => { persistedState = s; return { ok: true }; },
    log: () => {},
    error: () => {}
  });

  assert.equal(result.action, 'strand');
  assert.equal(result.role, 'reviewer');
  assert.equal(result.retryCount, 2);
  assert.ok(persistedState.metadata['reviewerArtifactStrandedAt'], 'should record stranded timestamp');
  assert.ok(persistedState.metadata['reviewerArtifactStrandReason'], 'should record strand reason');
});

// ============================================================================
// dispatchArtifactFailure — implementer role tests
// ============================================================================

test('dispatchArtifactFailure returns relaunch for implementer on first failure', async () => {
  const state = { slug: 'test-slug', metadata: {} };
  let persistedState = state;

  const result = await dispatchArtifactFailure('implementer', 'Implementer artifacts incomplete: missing disposition', {
    slug: 'test-slug',
    worktree: '/mock/worktree',
    readReviewStateFn: () => persistedState,
    writeReviewStateFn: async (_s, s) => { persistedState = s; return { ok: true }; },
    log: () => {},
    error: () => {}
  });

  assert.equal(result.action, 'relaunch');
  assert.equal(result.role, 'implementer');
  assert.equal(result.retryCount, 1);
  assert.equal(persistedState.metadata[IMPLEMENTER_ARTIFACT_RETRY_KEY], 1);
});

test('dispatchArtifactFailure returns strand for implementer after max retries', async () => {
  const state = { slug: 'test-slug', metadata: { [IMPLEMENTER_ARTIFACT_RETRY_KEY]: 2 } };
  let persistedState = state;

  const result = await dispatchArtifactFailure('implementer', 'Implementer artifacts incomplete: missing round-resolution', {
    slug: 'test-slug',
    worktree: '/mock/worktree',
    readReviewStateFn: () => persistedState,
    writeReviewStateFn: async (_s, s) => { persistedState = s; return { ok: true }; },
    log: () => {},
    error: () => {}
  });

  assert.equal(result.action, 'strand');
  assert.equal(result.role, 'implementer');
  assert.equal(result.retryCount, 2);
  assert.ok(persistedState.metadata['implementerArtifactStrandedAt'], 'should record stranded timestamp');
  assert.ok(persistedState.metadata['implementerArtifactStrandReason'], 'should record strand reason');
});

// ============================================================================
// Independent per-role retry counters
// ============================================================================

test('reviewer and implementer artifact retry counters are independent', async () => {
  const state = { slug: 'test-slug', metadata: {} };
  let persistedState = state;

  const readFn = () => persistedState;
  const writeFn = async (_s, s) => { persistedState = s; return { ok: true }; };

  // Consume 1 reviewer retry
  const r1 = await dispatchArtifactFailure('reviewer', 'missing findings', {
    slug: 'test-slug', worktree: '/mock', readReviewStateFn: readFn, writeReviewStateFn: writeFn, log: () => {}, error: () => {}
  });
  assert.equal(r1.retryCount, 1);
  assert.equal(persistedState.metadata[REVIEWER_ARTIFACT_RETRY_KEY], 1);
  assert.equal(persistedState.metadata[IMPLEMENTER_ARTIFACT_RETRY_KEY], undefined);

  // Consume 1 implementer retry — reviewer counter unchanged
  const i1 = await dispatchArtifactFailure('implementer', 'missing disposition', {
    slug: 'test-slug', worktree: '/mock', readReviewStateFn: readFn, writeReviewStateFn: writeFn, log: () => {}, error: () => {}
  });
  assert.equal(i1.retryCount, 1);
  assert.equal(persistedState.metadata[REVIEWER_ARTIFACT_RETRY_KEY], 1);
  assert.equal(persistedState.metadata[IMPLEMENTER_ARTIFACT_RETRY_KEY], 1);

  // Second implementer retry — still within bound (count becomes 2)
  const i2 = await dispatchArtifactFailure('implementer', 'missing disposition again', {
    slug: 'test-slug', worktree: '/mock', readReviewStateFn: readFn, writeReviewStateFn: writeFn, log: () => {}, error: () => {}
  });
  assert.equal(i2.action, 'relaunch');
  assert.equal(persistedState.metadata[REVIEWER_ARTIFACT_RETRY_KEY], 1);
  assert.equal(persistedState.metadata[IMPLEMENTER_ARTIFACT_RETRY_KEY], 2);

  // Third implementer call — bound exhausted, strands
  const i3 = await dispatchArtifactFailure('implementer', 'missing disposition third time', {
    slug: 'test-slug', worktree: '/mock', readReviewStateFn: readFn, writeReviewStateFn: writeFn, log: () => {}, error: () => {}
  });
  assert.equal(i3.action, 'strand');
  assert.equal(i3.retryCount, 2);
  assert.equal(persistedState.metadata[REVIEWER_ARTIFACT_RETRY_KEY], 1);

  // Reviewer still has retries available (at 1, max is 2)
  const r2 = await dispatchArtifactFailure('reviewer', 'missing findings again', {
    slug: 'test-slug', worktree: '/mock', readReviewStateFn: readFn, writeReviewStateFn: writeFn, log: () => {}, error: () => {}
  });
  assert.equal(r2.action, 'relaunch');
  assert.equal(r2.retryCount, 2);
});

// ============================================================================
// Retry exhaustion produces stranded state
// ============================================================================

test('stranded state records actionable metadata for reviewer', async () => {
  const state = { slug: 'test-slug', metadata: { [REVIEWER_ARTIFACT_RETRY_KEY]: 2 } };
  let persistedState = state;
  const diagnostic = 'Reviewer artifacts incomplete: missing findings';

  await dispatchArtifactFailure('reviewer', diagnostic, {
    slug: 'test-slug', worktree: '/mock',
    readReviewStateFn: () => persistedState,
    writeReviewStateFn: async (_s, s) => { persistedState = s; return { ok: true }; },
    log: () => {}, error: () => {}
  });

  assert.ok(persistedState.metadata['reviewerArtifactStrandedAt'], 'strandedAt should be set');
  assert.equal(persistedState.metadata['reviewerArtifactStrandReason'], diagnostic, 'strandReason should match diagnostic');
});

test('stranded state records actionable metadata for implementer', async () => {
  const state = { slug: 'test-slug', metadata: { [IMPLEMENTER_ARTIFACT_RETRY_KEY]: 2 } };
  let persistedState = state;
  const diagnostic = 'Implementer artifacts incomplete: missing round-resolution';

  await dispatchArtifactFailure('implementer', diagnostic, {
    slug: 'test-slug', worktree: '/mock',
    readReviewStateFn: () => persistedState,
    writeReviewStateFn: async (_s, s) => { persistedState = s; return { ok: true }; },
    log: () => {}, error: () => {}
  });

  assert.ok(persistedState.metadata['implementerArtifactStrandedAt'], 'strandedAt should be set');
  assert.equal(persistedState.metadata['implementerArtifactStrandReason'], diagnostic, 'strandReason should match diagnostic');
});

// ============================================================================
// HumanOnly failure categories (ADR 0048) — dispatcher does not intercept
// ============================================================================

test('dispatchArtifactFailure uses separate metadata keys from gate retry counters', async () => {
  // Gate failure uses metadata.gateFailureRetryCount; artifact dispatcher uses
  // metadata.reviewerArtifactRetryCount. They must not collide.
  const state = { slug: 'test-slug', metadata: { gateFailureRetryCount: 1 } };
  let persistedState = state;

  const result = await dispatchArtifactFailure('reviewer', 'missing findings', {
    slug: 'test-slug', worktree: '/mock',
    readReviewStateFn: () => persistedState,
    writeReviewStateFn: async (_s, s) => { persistedState = s; return { ok: true }; },
    log: () => {}, error: () => {}
  });

  assert.equal(result.action, 'relaunch');
  assert.equal(result.retryCount, 1);
  assert.equal(persistedState.metadata.gateFailureRetryCount, 1, 'gate counter unchanged');
  assert.equal(persistedState.metadata[REVIEWER_ARTIFACT_RETRY_KEY], 1, 'artifact counter incremented');
});

test('dispatchArtifactFailure handles null persisted state', async () => {
  let persistedState = null;

  const result = await dispatchArtifactFailure('reviewer', 'missing findings', {
    slug: 'test-slug', worktree: '/mock',
    readReviewStateFn: () => persistedState,
    writeReviewStateFn: async (_s, s) => { persistedState = s; return { ok: true }; },
    log: () => {}, error: () => {}
  });

  assert.equal(result.action, 'relaunch');
  assert.equal(result.retryCount, 1);
  assert.ok(persistedState, 'state should be created');
  assert.equal(persistedState.metadata[REVIEWER_ARTIFACT_RETRY_KEY], 1);
});

// ============================================================================
// Custom maxRetries
// ============================================================================

test('dispatchArtifactFailure respects custom maxRetries', async () => {
  const state = { slug: 'test-slug', metadata: { [REVIEWER_ARTIFACT_RETRY_KEY]: 4 } };
  let persistedState = state;

  const result = await dispatchArtifactFailure('reviewer', 'missing findings', {
    slug: 'test-slug', worktree: '/mock',
    maxRetries: 5,
    readReviewStateFn: () => persistedState,
    writeReviewStateFn: async (_s, s) => { persistedState = s; return { ok: true }; },
    log: () => {}, error: () => {}
  });

  assert.equal(result.action, 'relaunch');
  assert.equal(result.retryCount, 5);
  assert.equal(result.maxRetries, 5);
});

// ============================================================================
// isArtifactInfraDiagnostic — infra vs artifact failure classification
// ============================================================================

test('isArtifactInfraDiagnostic identifies post-failure diagnostics as infra', () => {
  assert.ok(isArtifactInfraDiagnostic('Reviewer comment post failed: 502 Bad Gateway'));
  assert.ok(isArtifactInfraDiagnostic('Reviewer review post failed: connection refused'));
  assert.ok(isArtifactInfraDiagnostic('Implementer resolution post failed: API error'));
  assert.ok(isArtifactInfraDiagnostic('Implementer disposition post failed: network error'));
});

test('isArtifactInfraDiagnostic identifies persist-failure diagnostics as infra', () => {
  assert.ok(isArtifactInfraDiagnostic('Reviewer artifact persist failed (findings): DB connection failed'));
  assert.ok(isArtifactInfraDiagnostic('Reviewer artifact persist failed (outcome): DB write failed'));
  assert.ok(isArtifactInfraDiagnostic('Implementer artifact persist failed (round-summary): disk full'));
  assert.ok(isArtifactInfraDiagnostic('Implementer artifact persist failed (disposition): timeout'));
});

test('isArtifactInfraDiagnostic returns false for artifact production failures', () => {
  assert.equal(isArtifactInfraDiagnostic('Reviewer artifacts incomplete: missing findings'), false);
  assert.equal(isArtifactInfraDiagnostic('Reviewer artifacts incomplete: missing verdict'), false);
  assert.equal(isArtifactInfraDiagnostic('Implementer artifacts incomplete: missing disposition'), false);
  assert.equal(isArtifactInfraDiagnostic('Implementer artifacts incomplete: missing round-resolution'), false);
});

test('isArtifactInfraDiagnostic handles null/undefined/empty', () => {
  assert.equal(isArtifactInfraDiagnostic(null), false);
  assert.equal(isArtifactInfraDiagnostic(undefined), false);
  assert.equal(isArtifactInfraDiagnostic(''), false);
});

// ============================================================================
// dispatchArtifactFailure — in-memory state sync (finding 1)
// ============================================================================

test('dispatchArtifactFailure syncs retry count into in-memory state on relaunch', async () => {
  const inMemoryState = { slug: 'test-slug', metadata: {} };
  let persistedState = { slug: 'test-slug', metadata: {} };

  const result = await dispatchArtifactFailure('reviewer', 'missing findings', {
    slug: 'test-slug', worktree: '/mock',
    readReviewStateFn: () => persistedState,
    writeReviewStateFn: async (_s, s) => { persistedState = s; return { ok: true }; },
    state: inMemoryState,
    log: () => {}, error: () => {}
  });

  assert.equal(result.action, 'relaunch');
  assert.equal(inMemoryState.metadata[REVIEWER_ARTIFACT_RETRY_KEY], 1, 'in-memory state synced');
  assert.equal(persistedState.metadata[REVIEWER_ARTIFACT_RETRY_KEY], 1, 'disk state synced');
});

test('dispatchArtifactFailure syncs strand markers into in-memory state', async () => {
  const inMemoryState = { slug: 'test-slug', metadata: { [REVIEWER_ARTIFACT_RETRY_KEY]: 2 } };
  let persistedState = { slug: 'test-slug', metadata: { [REVIEWER_ARTIFACT_RETRY_KEY]: 2 } };

  const result = await dispatchArtifactFailure('reviewer', 'missing findings', {
    slug: 'test-slug', worktree: '/mock',
    readReviewStateFn: () => persistedState,
    writeReviewStateFn: async (_s, s) => { persistedState = s; return { ok: true }; },
    state: inMemoryState,
    log: () => {}, error: () => {}
  });

  assert.equal(result.action, 'strand');
  assert.ok(inMemoryState.metadata['reviewerArtifactStrandedAt'], 'strandedAt synced to in-memory state');
  assert.ok(inMemoryState.metadata['reviewerArtifactStrandReason'], 'strandReason synced to in-memory state');
  assert.ok(persistedState.metadata['reviewerArtifactStrandedAt'], 'strandedAt persisted to disk');
  assert.ok(persistedState.metadata['reviewerArtifactStrandReason'], 'strandReason persisted to disk');
});

test('dispatchArtifactFailure returns metadata in result', async () => {
  const state = { slug: 'test-slug', metadata: {} };
  let persistedState = state;

  const result = await dispatchArtifactFailure('implementer', 'missing disposition', {
    slug: 'test-slug', worktree: '/mock',
    readReviewStateFn: () => persistedState,
    writeReviewStateFn: async (_s, s) => { persistedState = s; return { ok: true }; },
    state,
    log: () => {}, error: () => {}
  });

  assert.ok(result.metadata, 'metadata should be present in result');
  assert.equal(result.metadata![IMPLEMENTER_ARTIFACT_RETRY_KEY], 1);
});

// ============================================================================
// HumanOnly infra failures — dispatcher does not relaunch (finding 3)
// ============================================================================

test('isArtifactInfraDiagnostic gates infra failures from artifact dispatcher', () => {
  // Infra diagnostics should be caught before reaching dispatchArtifactFailure
  // so they do not consume artifact retry budget or trigger agent relaunch
  const infraDiagnostics = [
    'Reviewer comment post failed: 502 Bad Gateway',
    'Reviewer review post failed: connection refused',
    'Reviewer artifact persist failed (findings): DB connection failed',
    'Implementer resolution post failed: API error',
    'Implementer disposition post failed: network error',
    'Implementer artifact persist failed (round-summary): disk full',
  ];

  for (const diag of infraDiagnostics) {
    assert.ok(isArtifactInfraDiagnostic(diag), `should classify as infra: ${diag}`);
  }

  // Artifact production failures should NOT be classified as infra
  const artifactDiagnostics = [
    'Reviewer artifacts incomplete: missing findings',
    'Reviewer artifacts incomplete: missing verdict',
    'Implementer artifacts incomplete: missing disposition',
    'Implementer artifacts incomplete: missing round-resolution',
  ];

  for (const diag of artifactDiagnostics) {
    assert.equal(isArtifactInfraDiagnostic(diag), false, `should NOT classify as infra: ${diag}`);
  }
});

test('dispatchArtifactFailure skips state sync when state is null', async () => {
  let persistedState = { slug: 'test-slug', metadata: {} };

  const result = await dispatchArtifactFailure('reviewer', 'missing findings', {
    slug: 'test-slug', worktree: '/mock',
    readReviewStateFn: () => persistedState,
    writeReviewStateFn: async (_s, s) => { persistedState = s; return { ok: true }; },
    state: null,
    log: () => {}, error: () => {}
  });

  assert.equal(result.action, 'relaunch');
  assert.equal(result.retryCount, 1);
  // No crash when state is null
});

test('dispatchArtifactFailure skips state sync when state has no metadata', async () => {
  const inMemoryState = { slug: 'test-slug' };
  let persistedState = { slug: 'test-slug', metadata: {} };

  const result = await dispatchArtifactFailure('reviewer', 'missing findings', {
    slug: 'test-slug', worktree: '/mock',
    readReviewStateFn: () => persistedState,
    writeReviewStateFn: async (_s, s) => { persistedState = s; return { ok: true }; },
    state: inMemoryState as any,
    log: () => {}, error: () => {}
  });

  assert.equal(result.action, 'relaunch');
  assert.equal(result.retryCount, 1);
  // No crash when state.metadata is undefined
});
