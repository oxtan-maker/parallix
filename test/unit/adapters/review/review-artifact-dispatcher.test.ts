// @ts-nocheck -- TASK-2274 / TASK-2377.04: artifact recovery through the rebound kernel

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  consumeReviewerArtifacts,
  consumeImplementerArtifacts,
} from '../../../../src/adapters/review/review-artifacts.js';
import { isArtifactInfraDiagnostic } from '../../../../src/application/ports/review-round.js';
import { DEFAULT_REBOUND_ATTEMPTS, rebound } from '../../../../src/application/rebound-kernel.js';
import { runReviewLoop } from '../../../../src/application/review-loop/review-loop.js';
import { fakeReviewLoopPorts } from '../../../helpers/review-loop-ports.js';

const ARTIFACT_REBOUND_ATTEMPTS = DEFAULT_REBOUND_ATTEMPTS;
import { mkdtemp as registeredMkdtemp } from '../../../helpers/temp-dir.js';

// ============================================================================
// consumeReviewerArtifacts — diagnostic field tests
// ============================================================================

test('consumeReviewerArtifacts returns diagnostic when findings are missing', async () => {
  const tmpDir = registeredMkdtemp('test-dispatcher-');
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
  const tmpDir = registeredMkdtemp('test-dispatcher-');
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
  const tmpDir = registeredMkdtemp('test-dispatcher-');
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
  const tmpDir = registeredMkdtemp('test-dispatcher-');

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
  const tmpDir = registeredMkdtemp('test-dispatcher-');
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
  const tmpDir = registeredMkdtemp('test-dispatcher-');
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
  const tmpDir = registeredMkdtemp('test-dispatcher-');

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
// Artifact recovery — one rebound-kernel occurrence (TASK-2377.04)
//
// The review loop recovers incomplete artifacts through `rebound()`
// (src/application/rebound-kernel.ts) with an `artifact-incomplete` reason: the
// budget is per occurrence and in-memory, and the occurrence is only `fixed`
// when the verify callback re-consumes complete artifacts.
// ============================================================================

/** Minimal kernel collaborators: a launch port that always succeeds. */
function dispatcherOptions(overrides = {}) {
  return {
    slug: 'test-slug',
    worktree: '/mock/worktree',
    implementer: 'codex',
    maxAttempts: ARTIFACT_REBOUND_ATTEMPTS,
    startAgent: async () => ({ agent: 'codex', result: { status: 0 } }),
    log: () => {},
    error: () => {},
    ...overrides,
  };
}

/** One artifact-failure occurrence for a role. */
const dispatchArtifactFailure = (role, diagnostic, options) => rebound({ kind: 'artifact-incomplete', role, diagnostic }, options);

test('artifact recovery reports fixed only when the re-consumed reviewer artifacts are complete', async () => {
  let launches = 0;
  let verifies = 0;
  const result = await dispatchArtifactFailure('reviewer', 'Reviewer artifacts incomplete: missing findings', dispatcherOptions({
    startAgent: async () => { launches++; return { agent: 'codex', result: { status: 0 } }; },
    verify: () => { verifies++; return { ok: true }; },
  }));

  assert.equal(result.outcome, 'fixed');
  assert.equal(result.attempts, 1);
  assert.equal(launches, 1);
  assert.equal(verifies, 1, 'the artifacts must be re-consumed before reporting fixed');
});

test('artifact recovery relaunches with the fresh diagnostic when the re-consume still fails', async () => {
  const prompts = [];
  const result = await dispatchArtifactFailure('reviewer', 'Reviewer artifacts incomplete: missing findings', dispatcherOptions({
    startAgent: async (_step, options) => {
      prompts.push(options.prompt('codex'));
      return { agent: 'codex', result: { status: 0 } };
    },
    verify: (attempt) => attempt === 1
      ? { ok: false, diagnostic: 'Reviewer artifacts incomplete: missing verdict' }
      : { ok: true },
  }));

  assert.equal(result.outcome, 'fixed');
  assert.equal(result.attempts, 2);
  assert.equal(prompts.length, 2, 'a failed re-consume consumes an attempt and relaunches');
  assert.match(prompts[0], /INCOMPLETE ARTIFACTS/);
  assert.match(prompts[0], /missing findings/);
  assert.match(prompts[1], /missing verdict/, 'the relaunch carries the fresh diagnostic');
});

test('artifact recovery strands with the last diagnostic when the occurrence budget is spent', async () => {
  let launches = 0;
  const result = await dispatchArtifactFailure('reviewer', 'Reviewer artifacts incomplete: missing findings', dispatcherOptions({
    startAgent: async () => { launches++; return { agent: 'codex', result: { status: 0 } }; },
    verify: () => ({ ok: false, diagnostic: 'Reviewer artifacts incomplete: still missing verdict' }),
  }));

  assert.equal(result.outcome, 'exhausted');
  assert.equal(result.attempts, ARTIFACT_REBOUND_ATTEMPTS);
  assert.equal(launches, ARTIFACT_REBOUND_ATTEMPTS, 'no third launch after the budget is spent');
  assert.match(result.diagnostic, /still missing verdict/);
});

test('artifact recovery gives every occurrence a fresh budget (no persisted carryover)', async () => {
  const runOccurrence = async () => {
    let launches = 0;
    const outcome = await dispatchArtifactFailure('implementer', 'Implementer artifacts incomplete: missing disposition', dispatcherOptions({
      startAgent: async () => { launches++; return { agent: 'codex', result: { status: 0 } }; },
      verify: () => ({ ok: false, diagnostic: 'Implementer artifacts incomplete: missing disposition' }),
    }));
    return { outcome, launches };
  };

  const first = await runOccurrence();
  const second = await runOccurrence();

  assert.equal(first.outcome.outcome, 'exhausted');
  assert.equal(second.outcome.outcome, 'exhausted');
  assert.equal(second.launches, ARTIFACT_REBOUND_ATTEMPTS,
    'the second occurrence starts with a full budget: nothing carries over');
});

test('artifact recovery routes the implementer role through the kernel with its own diagnostic', async () => {
  const prompts = [];
  const result = await dispatchArtifactFailure('implementer', 'Implementer artifacts incomplete: missing round-resolution', dispatcherOptions({
    startAgent: async (_step, options) => {
      prompts.push(options.prompt('codex'));
      return { agent: 'codex', result: { status: 0 } };
    },
    verify: () => ({ ok: true }),
  }));

  assert.equal(result.outcome, 'fixed');
  assert.match(prompts[0], /Role: implementer/);
  assert.match(prompts[0], /missing round-resolution/);
});

test('artifact recovery treats an ambiguous null exit status as a failed attempt', async () => {
  let verifies = 0;
  const result = await dispatchArtifactFailure('implementer', 'Implementer artifacts incomplete: missing disposition', dispatcherOptions({
    startAgent: async () => ({ agent: 'codex', result: { status: null } }),
    verify: () => { verifies++; return { ok: true }; },
  }));

  assert.equal(result.outcome, 'exhausted');
  assert.equal(verifies, 0, 'a null-exit launch is no evidence of a fix, so verify never runs');
});

test('artifact recovery resolves the relaunched agent through the fallback port', async () => {
  const result = await dispatchArtifactFailure('reviewer', 'Reviewer artifacts incomplete: missing findings', dispatcherOptions({
    applyAgentFallback: () => 'claude',
    verify: () => ({ ok: true }),
  }));

  assert.equal(result.implementer, 'claude');
});

test('artifact recovery persists no retry state anywhere', async () => {
  const fake = fakeReviewLoopPorts({
    artifacts: { consumeReviewer: async () => ({ consumed: true, ok: false, diagnostic: 'Reviewer artifacts incomplete: still incomplete' }) },
  });
  await runReviewLoop({ slug: 'test-slug', implementer: 'claude', reviewer: 'codex', maxAttempts: 1, skipHandoff: true }, fake.ports);

  assert.deepEqual(fake.stops, ['REVIEWER_ARTIFACT_RETRY_EXHAUSTED']);
  assert.ok(fake.writes.every(state => Object.keys((state.metadata ?? {}) as object).every(key => !/retry|attempt/i.test(key))),
    'the kernel budget is in-memory: no review-state write carries a retry counter');
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

test('isArtifactInfraDiagnostic gates infra failures from artifact recovery', () => {
  // Infra diagnostics are caught before artifact recovery starts so
  // they neither consume the occurrence budget nor relaunch an agent.
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
