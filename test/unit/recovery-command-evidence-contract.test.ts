import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { mkdtemp } from '../helpers/temp-dir.js';
import { initCommittedRepository } from '../fixtures/git-repository.js';
import { captureVerifiedTreeProof } from '../../src/adapters/verification/verification.js';
import { run } from '../../src/adapters/git/git.js';
import {
  captureRecoveryEvidence,
  captureRecoveryEvidenceRetry,
  lookupRecoveryEvidence,
  listRecoveryEvidence,
  RECOVERY_EVIDENCE_VERSION,
  type RecoveryEvidenceRef,
} from '../../src/application/recovery-evidence.js';
import { buildReboundFixPrompt, buildFreshDiagnosticRepairPrompt, rebound } from '../../src/application/rebound-kernel.js';

/**
 * CONTRACT (TASK-2642 / CP-1): a failed verification command whose actionable
 * failure sits between a large passing prefix and a later passing-looking
 * parallel summary must be captured in full, persisted to durable per-mission
 * storage before any repair launches, and retrievable by both resumed-targeted
 * and fresh-context repairs — without any customer runner changes.
 *
 * The fixture command below prints 300 passing lines, then a single real
 * assertion failure, then a "2019 passed" summary that looks like success. A
 * terminal tail or a generic final error hides the failure; the retained
 * evidence must not.
 */

/** A fixture repo whose verification gate hides a real failure in noise. */
function fixtureRepoWithHiddenFailure(root: string): void {
  const script = [
    '#!/usr/bin/env bash',
    '# 300 passing lines inflate the terminal tail past the failure.',
    'for i in $(seq 1 300); do echo "PASS test $i: ok"; done',
    '# The actionable failure, hidden between the prefix and the summary.',
    'echo "[unit-test-budget:exceeded]: suite CPU budget exceeded"',
    'echo "  expected: 0; actual: 1"',
    '# A later passing-looking summary that must not substitute for the outcome.',
    'echo ""',
    'echo "tests: 2019 passed, 1 failed"',
    'echo "parallel summary: all green"',
    'exit 1',
  ].join('\n');
  fs.writeFileSync(path.join(root, 'verify.sh'), script, { mode: 0o755, encoding: 'utf8' });
  fs.writeFileSync(
    path.join(root, 'workflow.config.json'),
    JSON.stringify({
      product: { name: 'Fixture Project' },
      adapters: {
        tasks: { provider: 'backlog-md', storage: 'backlog' },
        missions: { baseDir: 'docs/missions', branchPrefix: 'mission/', worktreePattern: '../<repo>-<slug>' },
        verification: { command: 'bash ./verify.sh {{area}}', defaultArea: 'docs' },
        review: { provider: 'forgejo', baseUrl: 'http://localhost:3300', remote: 'review', repo: 'test-org/test-repo' },
        agents: { commandEnvPrefix: 'AUTONOMOUS_REVIEW_' },
      },
    }, null, 2),
    'utf8',
  );
}

test('CP-1 hidden failure is captured in full before any repair launch', () => {
  const root = mkdtemp('task-2642-recovery-capture-');
  try {
    initCommittedRepository(root, { 'verify.sh': '#!/bin/bash\nexit 1\n' });
    fixtureRepoWithHiddenFailure(root);

    const result = captureVerifiedTreeProof('docs', root, { runFn: run });
    assert.equal(result.ok, false, 'the hidden failure must be reported as a failure');
    assert.ok(result.exitCode && result.exitCode !== 0, 'exit code is non-zero');
    assert.ok(result.command, 'the exact command is retained');
    assert.ok(result.cwd, 'the working directory is retained');

    // The captured output must include the hidden assertion, not only the
    // passing-looking tail.
    const combined = `${result.stdout ?? ''}\n${result.stderr ?? ''}`;
    assert.match(combined, /unit-test-(?:budget|cpu):exceeded/, 'stdout/stderr attribution retains the hidden failure');
    assert.match(combined, /2019 passed/, 'the later passing-looking summary is also retained');

    // The retained evidence reference carries the durable metadata.
    assert.ok(result.recoveryEvidence, 'durable evidence was persisted before repair launch');
    const ref = result.recoveryEvidence!;
    assert.equal(ref.version, RECOVERY_EVIDENCE_VERSION);
    assert.equal(ref.exitCode, result.exitCode, 'exit/signal is the process outcome, never inferred');
    assert.equal(ref.command, result.command);
    assert.equal(ref.cwd, result.cwd);
    assert.ok(ref.capturedRevision, 'the captured revision is retained');
    assert.equal(ref.attempt, 1);
    assert.ok(ref.incidentId && ref.incidentId.length > 0, 'incident identity is stable');
    assert.match(ref.stdoutPath, /\.stdout\.txt$/, 'stdout path is attributed to its stream');
    assert.match(ref.stderrPath, /\.stderr\.txt$/, 'stderr path is attributed to its stream');
    assert.equal(ref.captureComplete, true, 'capture is reported complete, not silently partial');

    // The evidence survives a fresh read from disk: durable across a restart.
    const readBack = lookupRecoveryEvidence({ cwd: root, incidentId: ref.incidentId, attempt: 1 });
    assert.equal(readBack.ok, true, 'retrieval works after a simulated restart');
    assert.equal(readBack.evidence?.incidentId, ref.incidentId);
    assert.equal(readBack.evidence?.attempt, 1);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

/**
 * CONTRACT (TASK-2642 / CP-2): the metadata each failed invocation must retain
 * in durable storage, and that original and retry evidence cannot overwrite or
 * be confused with another concurrent mission or repository. Evidence is stored
 * under the mission worktree's `.workflow/recovery-evidence/`, so two
 * repositories write to two stores and never cross-contaminate; the incident
 * fingerprint groups the original with its retries while the attempt number
 * keeps them in separate files.
 */
test('CP-2 original and retry metadata survive as separate records in durable storage', () => {
  const root = mkdtemp('task-2642-recovery-meta-');
  try {
    initCommittedRepository(root);
    const original = captureRecoveryEvidence({
      command: 'npm test -- --area docs',
      cwd: root,
      capturedRevision: '1111',
      exitCode: 1,
      signal: null,
      stdout: 'not ok 7 — expect 1 got 2',
      stderr: 'heap out of memory',
      diagnostic: 'assertion failure in src/index.ts',
    });
    assert.equal(original.ok, true, 'the original failure is captured');
    const retry = captureRecoveryEvidenceRetry({
      ...original.ref!,
      incidentId: original.ref!.incidentId,
      capturedRevision: '1111',
      stdout: 'not ok 7 — expect 1 got 2 (retry, same tree)',
      stderr: 'heap out of memory (retry)',
    });
    assert.equal(retry.ok, true, 'the retry is captured');

    // Every metadata field the criterion requires is present and correct.
    const a = original.ref!;
    const b = retry.ref!;
    for (const ref of [a, b]) {
      assert.equal(ref.version, RECOVERY_EVIDENCE_VERSION);
      assert.equal(ref.command, 'npm test -- --area docs');
      assert.equal(ref.cwd, root);
      assert.equal(ref.capturedRevision, '1111');
      assert.equal(ref.exitCode, 1);
      assert.equal(ref.signal, null);
      assert.match(ref.stdoutPath, /\.stdout\.txt$/);
      assert.match(ref.stderrPath, /\.stderr\.txt$/);
      assert.ok(ref.stdoutBytes > 0, 'stdout attribution records a byte count');
      assert.ok(ref.stderrBytes > 0, 'stderr attribution records a byte count');
      assert.equal(ref.captureComplete, true);
      assert.ok(ref.incidentId, 'incident identity is present');
    }
    assert.equal(a.attempt, 1, 'the original is attempt 1');
    assert.equal(b.attempt, 2, 'the retry is attempt 2');
    assert.notEqual(a.stdoutPath, b.stdoutPath, 'each record keeps its own stdout file');
    assert.notEqual(a.stderrPath, b.stderrPath, 'each record keeps its own stderr file');

    // Both records are independently retrievable after a simulated restart.
    const listed = listRecoveryEvidence({ cwd: root });
    const attempts = listed.map((r) => r.attempt).sort();
    assert.deepEqual(attempts, [1, 2], 'original and retry both survive as separate records');
    const byAttempt = listed.find((r) => r.attempt === 2);
    assert.equal(byAttempt?.incidentId, a.incidentId, 'the retry shares the incident but is not the original');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('CP-2 evidence in one repository is not readable from another', () => {
  const repoA = mkdtemp('task-2642-repo-a-');
  const repoB = mkdtemp('task-2642-repo-b-');
  try {
    initCommittedRepository(repoA);
    initCommittedRepository(repoB);
    fixtureRepoWithHiddenFailure(repoA);
    fixtureRepoWithHiddenFailure(repoB);

    const a = captureRecoveryEvidence({
      command: 'bash ./verify.sh docs',
      cwd: repoA,
      capturedRevision: 'aaaa',
      exitCode: 1,
      signal: null,
      stdout: 'failure only in repo A',
      stderr: '',
      diagnostic: 'unit-test-budget:exceeded',
    });
    assert.equal(a.ok, true, 'repo A captured its failure');
    const b = captureRecoveryEvidence({
      command: 'bash ./verify.sh docs',
      cwd: repoB,
      capturedRevision: 'bbbb',
      exitCode: 1,
      signal: null,
      stdout: 'failure only in repo B',
      stderr: '',
      diagnostic: 'unit-test-budget:exceeded',
    });
    assert.equal(b.ok, true, 'repo B captured its failure');

    // Each worktree's store holds only its own evidence: a fresh-context agent
    // launched in repo B can never read repo A's hidden failure.
    const listedA = listRecoveryEvidence({ cwd: repoA });
    const listedB = listRecoveryEvidence({ cwd: repoB });
    assert.equal(listedA.length, 1, 'repo A sees exactly its own incident');
    assert.equal(listedB.length, 1, 'repo B sees exactly its own incident');
    assert.equal(listedA[0].capturedRevision, 'aaaa');
    assert.equal(listedB[0].capturedRevision, 'bbbb');
    assert.notEqual(listedA[0].incidentId, listedB[0].incidentId, 'the two stores hold distinct incidents');

    // Cross-repository lookup is honestly empty, never a stale match.
    const cross = lookupRecoveryEvidence({ cwd: repoB, incidentId: a.ref!.incidentId });
    assert.equal(cross.ok, false, 'repo B cannot resolve repo A incident');
    assert.equal(cross.error, 'missing');
  } finally {
    fs.rmSync(repoA, { recursive: true, force: true });
    fs.rmSync(repoB, { recursive: true, force: true });
  }
});

test('CP-1 retry of the same failure reuses the incident and advances the attempt', () => {
  const root = mkdtemp('task-2642-recovery-retry-');
  try {
    initCommittedRepository(root);
    fixtureRepoWithHiddenFailure(root);
    const first = captureRecoveryEvidence({
      command: 'bash ./verify.sh docs',
      cwd: root,
      capturedRevision: 'abc123',
      exitCode: 1,
      signal: null,
      stdout: 'not ok — budget exceeded',
      stderr: '',
      diagnostic: 'unit-test-budget:exceeded',
    });
    assert.equal(first.ok, true);
    const second = captureRecoveryEvidenceRetry({
      ...first.ref!,
      incidentId: first.ref!.incidentId,
      capturedRevision: 'def456',
      stdout: 'not ok — budget exceeded (retry)',
      stderr: '',
    });
    assert.equal(second.ok, true);
    assert.equal(second.ref!.attempt, 2, 'the retry advances the attempt within the same incident');
    assert.equal(second.ref!.incidentId, first.ref!.incidentId, 'the retry reuses the incident');

    const listed = listRecoveryEvidence({ cwd: root });
    const attempts = listed.map((r) => r.attempt).sort();
    assert.deepEqual(attempts, [1, 2], 'both the original and the retry are retrievable');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

/**
 * CONTRACT (TASK-2642 / CP-2): the capture step writes evidence before any
 * repair launches, so the reference returned from the capture call already
 * carries durable metadata; the launched repair prompt then exposes it. This
 * ties the "before the repair launch" ordering to an assertion on the returned
 * reference rather than to timing.
 */
test('CP-2 evidence is retained before the repair launch', () => {
  const root = mkdtemp('task-2642-recovery-before-');
  try {
    initCommittedRepository(root);
    fixtureRepoWithHiddenFailure(root);
    // captureVerifiedTreeProof runs the gate and persists evidence in one step,
    // before rebound() would launch a repair agent.
    const result = captureVerifiedTreeProof('docs', root, { runFn: run });
    assert.equal(result.ok, false);
    assert.ok(result.recoveryEvidence, 'evidence exists on the failure result, before any repair launch');
    const ref = result.recoveryEvidence!;
    assert.equal(ref.command, result.command);
    assert.equal(ref.exitCode, result.exitCode);
    // The durable copy on disk matches the returned reference after a restart.
    const readBack = lookupRecoveryEvidence({ cwd: root, incidentId: ref.incidentId, attempt: 1 });
    assert.equal(readBack.ok, true);
    assert.equal(readBack.evidence?.command, ref.command);
    assert.equal(readBack.evidence?.exitCode, ref.exitCode);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// The repair commits a tree that the integration gate re-verifies only when it
// is clean, so retained evidence must stay out of `git status` even in a
// repository that does not ignore `.workflow/` (task-2620 loop regression).
test('CP-2 retained evidence never dirties a repository that does not ignore .workflow/', () => {
  const root = mkdtemp('task-2642-recovery-clean-');
  try {
    initCommittedRepository(root);
    const captured = captureRecoveryEvidence({
      command: 'make check',
      cwd: root,
      capturedRevision: '1111',
      exitCode: 1,
      signal: null,
      stdout: 'ok',
      stderr: 'AssertionError: repaired.txt is missing',
      diagnostic: 'gate failed',
      missionId: 'task-9642',
    });
    assert.equal(captured.ok, true, 'the failure is captured');
    assert.ok(fs.existsSync(captured.ref!.stderrPath), 'the stream is retained inside the worktree');
    assert.equal(String(run('git', ['-C', root, 'status', '--porcelain', '--untracked-files=all']).stdout).trim(), '', 'the worktree stays clean');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('CP-1 repaired fix prompt carries the evidence and a working retrieval route', () => {
  const root = mkdtemp('task-2642-recovery-prompt-');
  try {
    initCommittedRepository(root);
    fixtureRepoWithHiddenFailure(root);
    const captured = captureRecoveryEvidence({
      command: 'bash ./verify.sh docs',
      cwd: root,
      capturedRevision: 'abc123',
      exitCode: 1,
      signal: null,
      stdout: 'not ok — unit-test-budget: exceeded',
      stderr: 'warn: something',
      diagnostic: 'unit-test-budget:exceeded',
    });
    assert.equal(captured.ok, true);
    const slots = {
      label: 'PRE-REVIEW GATE FAILURE',
      slug: 'task-1',
      worktree: root,
      area: 'gate',
      facts: [] as Array<[string, string]>,
      diagnostic: 'not ok — unit-test-budget: exceeded',
      classification: { failureClass: 'GateFailure', dispatchAction: 'AutoSendBack', isRelaunchable: true, label: 'PRE-REVIEW GATE FAILURE' } as any,
      attempt: 1,
      maxAttempts: 2,
      remedy: 'fix it',
    };
    const targeted = buildReboundFixPrompt({ ...slots, recoveryEvidence: captured.ref });
    const fresh = buildFreshDiagnosticRepairPrompt({ ...slots, recoveryEvidence: captured.ref });
    assert.match(targeted, /Retained evidence/, 'targeted prompt exposes the retained evidence');
    assert.match(targeted, /unit-test-budget: exceeded/, 'the prompt names the retained command output');
    assert.match(targeted, /\.stdout\.txt/, 'the prompt gives a retrievable stdout path');
    assert.match(targeted, /lookupRecoveryEvidence/, 'the prompt gives a working retrieval route');
    assert.match(fresh, /Retained evidence/, 'fresh-context prompt also carries the evidence references');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('CP-1 missing evidence is reported honestly with a fallback, not a completeness claim', () => {
  const root = mkdtemp('task-2642-recovery-missing-');
  try {
    initCommittedRepository(root);
    const lookup = lookupRecoveryEvidence({ cwd: root, incidentId: 'deadbeef' });
    assert.equal(lookup.ok, false);
    assert.equal(lookup.error, 'missing', 'a missing record is reported, never implied');
    // A prompt built with no retained evidence must not claim completeness.
    const slots = {
      label: 'PRE-REVIEW GATE FAILURE',
      slug: 'task-1',
      worktree: root,
      area: 'gate',
      facts: [] as Array<[string, string]>,
      diagnostic: 'no output',
      classification: { failureClass: 'GateFailure', dispatchAction: 'AutoSendBack', isRelaunchable: true, label: 'PRE-REVIEW GATE FAILURE' } as any,
      attempt: 1,
      maxAttempts: 2,
      remedy: 'fix it',
      recoveryEvidence: null,
      recoveryEvidenceError: 'no retained evidence for this mission',
    };
    const prompt = buildReboundFixPrompt(slots);
    assert.match(prompt, /No retained evidence/, 'a prompt with no evidence states it honestly');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('CP-3 both resumed-targeted and fresh-context repair receive the bounded route with omitted-middle retrieval after a restart', () => {
  const root = mkdtemp('task-2642-recovery-both-');
  try {
    initCommittedRepository(root);
    fixtureRepoWithHiddenFailure(root);
    const captured = captureRecoveryEvidence({
      command: 'bash ./verify.sh docs',
      cwd: root,
      capturedRevision: 'abc123',
      exitCode: 1,
      signal: null,
      stdout: 'not ok — unit-test-budget: exceeded',
      stderr: 'warn: something',
      diagnostic: 'unit-test-budget:exceeded',
    });
    assert.equal(captured.ok, true);
    // Simulate a process restart: a fresh-context agent has no in-memory ref,
    // only the durable store. Read the reference back from disk; the path and
    // incidentId are stable across processes, so the references are not
    // invalidated by the restart.
    const readBack = lookupRecoveryEvidence({ cwd: root, incidentId: captured.ref.incidentId, attempt: 1 });
    assert.equal(readBack.ok, true, 'the reference resolves after a simulated restart');
    assert.ok(readBack.evidence?.stdoutPath, 'the recovered reference still names the stdout file');
    const slots = {
      label: 'PRE-REVIEW GATE FAILURE',
      slug: 'task-1',
      worktree: root,
      area: 'gate',
      facts: [] as Array<[string, string]>,
      diagnostic: 'not ok — unit-test-budget: exceeded',
      classification: { failureClass: 'GateFailure', dispatchAction: 'AutoSendBack', isRelaunchable: true, label: 'PRE-REVIEW GATE FAILURE' } as any,
      attempt: 1,
      maxAttempts: 2,
      remedy: 'fix it',
    };
    // Both repair entry points get the same bounded route: the retained command
    // and the retrieval route, not the previous model's assumptions.
    const targeted = buildReboundFixPrompt({ ...slots, recoveryEvidence: readBack.evidence ?? null });
    const fresh = buildFreshDiagnosticRepairPrompt({ ...slots, recoveryEvidence: readBack.evidence ?? null });
    for (const [label, prompt] of [['targeted', targeted], ['fresh', fresh]] as const) {
      assert.match(prompt, /Retained evidence for this failure/, `${label} prompt exposes retained evidence`);
      assert.match(prompt, /retrieve the omitted middle/, `${label} prompt includes omitted-middle retrieval`);
      assert.match(prompt, /bash .*verify\.sh docs/, `${label} prompt names the retained command`);
      assert.match(prompt, new RegExp(`lookupRecoveryEvidence\\(\\{ cwd, incidentId: "${captured.ref.incidentId}" \\}\\)`), `${label} prompt gives a working retrieval route`);
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('CP-4 truncated, expired, and redacted evidence are reported explicitly with a fallback, never a completeness claim', () => {
  const root = mkdtemp('task-2642-recovery-honest-');
  try {
    initCommittedRepository(root);
    const slots = (recoveryEvidence: RecoveryEvidenceRef | null, recoveryEvidenceError?: string) => ({
      label: 'PRE-REVIEW GATE FAILURE',
      slug: 'task-1',
      worktree: root,
      area: 'gate',
      facts: [] as Array<[string, string]>,
      diagnostic: 'no output',
      classification: { failureClass: 'GateFailure', dispatchAction: 'AutoSendBack', isRelaunchable: true, label: 'PRE-REVIEW GATE FAILURE' } as any,
      attempt: 1,
      maxAttempts: 2,
      remedy: 'fix it',
      recoveryEvidence,
      recoveryEvidenceError,
    });

    // Truncated: more than the 5 MB byte cap is written, so the record states
    // capture is incomplete and points at the retained file for the omitted
    // middle rather than claiming the output is whole.
    const big = 'a'.repeat(6 * 1024 * 1024);
    const truncated = captureRecoveryEvidence({
      command: 'bash ./verify.sh docs',
      cwd: root,
      capturedRevision: 'abc123',
      exitCode: 1,
      signal: null,
      stdout: big,
      stderr: '',
      diagnostic: 'unit-test-budget:exceeded',
    });
    assert.equal(truncated.ok, true);
    assert.equal(truncated.ref.captureComplete, false, 'a record past the byte cap reports capture incomplete');
    assert.equal(truncated.ref.truncatedFrom, 'stdout');
    assert.match(truncated.ref.stdoutPath, /\.stdout\.txt$/);
    const truncatedPrompt = buildReboundFixPrompt(slots(truncated.ref));
    assert.match(truncatedPrompt, /capture complete: no/, 'the prompt states capture is not complete');
    assert.match(truncatedPrompt, /truncated — see capture-completeness note/, 'the prompt points at the omitted middle');

    // Redaction: a caller that ran the configured credential pipeline marks the
    // record so the prompt discloses redaction instead of implying the shown
    // output is the raw output.
    const redacted = captureRecoveryEvidence({
      command: 'bash ./verify.sh docs',
      cwd: root,
      capturedRevision: 'abc123',
      exitCode: 1,
      signal: null,
      stdout: 'token=REDACTED',
      stderr: '',
      diagnostic: 'unit-test-budget:exceeded',
      redacted: true,
    });
    assert.equal(redacted.ok, true);
    assert.equal(redacted.ref.redacted, true);
    const redactedPrompt = buildReboundFixPrompt(slots(redacted.ref));
    assert.match(redactedPrompt, /redacted per configured credential redaction/, 'the prompt discloses redaction');

    // Configured credential redaction is applied to the retained streams before
    // they touch disk: a supplied redactor scrubs the stored stdout, and the
    // record marks itself redacted so nothing claims the raw output is kept.
    const scrubbed = captureRecoveryEvidence({
      command: 'bash ./verify.sh docs',
      cwd: root,
      capturedRevision: 'abc123',
      exitCode: 1,
      signal: null,
      stdout: 'api_key=SECRET123',
      stderr: '',
      diagnostic: 'unit-test-budget:exceeded',
      redactor: (value) => value.replace(/SECRET\d+/g, 'REDACTED'),
    });
    assert.equal(scrubbed.ok, true);
    assert.equal(scrubbed.ref.redacted, true);
    const storedStdout = fs.readFileSync(scrubbed.ref.stdoutPath, 'utf8');
    assert.ok(!/SECRET123/.test(storedStdout), 'the configured redactor scrubbed the credential from the retained stream');
    assert.match(storedStdout, /REDACTED/, 'the scrubbed credential is replaced, not retained');

    // Expired: a record past the retention window is reported expired with the
    // related incidents as an actionable fallback, never silently dropped.
    const fresh = captureRecoveryEvidence({
      command: 'bash ./verify.sh docs',
      cwd: root,
      capturedRevision: 'abc123',
      exitCode: 1,
      signal: null,
      stdout: 'not ok — unit-test-budget: exceeded',
      stderr: '',
      diagnostic: 'unit-test-budget:exceeded',
    });
    assert.equal(fresh.ok, true);
    const expired = lookupRecoveryEvidence({ cwd: root, incidentId: fresh.ref.incidentId, attempt: 1, now: () => new Date(Date.now() + 31 * 24 * 60 * 60 * 1000) });
    assert.equal(expired.ok, false, 'an expired record is not retrievable');
    assert.equal(expired.error, 'expired', 'the retrieval reports the expiry, not a missing record');
    assert.ok(expired.recent && expired.recent.length > 0, 'the expired lookup still returns related incidents as a fallback');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('CP-5 opaque failure survives opaque capture; exhaustion still reports the failed check, attempts and retrieval route', async () => {
  const root = mkdtemp('task-2642-recovery-opaque-');
  try {
    initCommittedRepository(root);
    // An opaque, non-framework command (a bash script) is captured by reading
    // the real process outcome — stdout/stderr/exit code — with no framework,
    // Node-glyph, tmux, or Parallix special-casing. A later passing-looking
    // summary must not override the actual non-zero outcome.
    fixtureRepoWithHiddenFailure(root);
    const proof = captureVerifiedTreeProof('docs', root, { runFn: run });
    assert.equal(proof.ok, false, 'the hidden non-zero failure is not masked by a passing-looking summary');
    assert.equal(proof.exitCode, 1, 'the actual exit code is captured, not inferred from prose');
    assert.ok(proof.recoveryEvidence, 'opaque failure produced attributable evidence');

    // Drive the rebound kernel to exhaustion and assert the retry budget is
    // preserved (exhausts the configured attempts) and the dossier still names
    // the failed check, the attempts, and the retrieval route.
    let dossier = '';
    const outcome = await rebound(
      { kind: 'gate-failure', area: 'docs', command: 'bash ./verify.sh docs', exitCode: 1, stdout: 'not ok — unit-test-budget: exceeded', stderr: '' },
      {
        slug: 'task-2642',
        worktree: root,
        implementer: 'claude',
        maxAttempts: 1,
        startAgent: async () => ({ agent: 'claude', result: { status: 0 } }),
        verify: () => ({ ok: false, diagnostic: 'still failing' }),
        log: () => {},
        error: (msg) => { dossier = msg; },
      },
    );
    assert.equal(outcome.outcome, 'exhausted', 'the retry budget is preserved, not silently widened');
    assert.match(dossier, /bash \.\/verify\.sh docs/, 'the exhaustion dossier reports the failed check');
    assert.match(dossier, /Attempt 1:/, 'the exhaustion dossier reports the attempts');
    assert.match(dossier, /Retained evidence for this failure/, 'the exhaustion dossier carries the retrieval route');
    assert.match(dossier, /lookupRecoveryEvidence/, 'the exhaustion dossier exposes a working retrieval route');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
