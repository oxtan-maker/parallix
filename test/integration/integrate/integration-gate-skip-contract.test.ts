import type { OperationalHistoryEntry } from '../../../src/application/ports/operation-history.js';
import { missionVersion } from '../../../src/application/domain-ports.js';
import type { IntegrateWorkflowPorts, IntegrationGateRunRecord } from '../../../src/application/ports/integrate-workflow.js';
import { approvedReview, fixtureMission, inMemoryTransitionStore } from '../../fixtures/mission-builders.js';
import { classifyReboundReason } from '../../../src/domain/rebound-policy.js';
import { phaseGateResult } from '../../helpers/phase-gate-result.js';
import { integrationServices } from '../../helpers/stub-integration-services.js';
import { integrationContext } from '../../fixtures/integration-context.js';
import { stubIntegrateWorkflowPorts } from '../../helpers/stub-integrate-workflow-ports.js';
import { mkdtemp } from '../../helpers/temp-dir.js';
// TASK-2625: sha-keyed integration-validation marker.
//
// Covers the four success criteria:
//  1. the marker is recorded when the integration suite passes green (recorded by the validation path);
//  2. integrate skips the validated high-level hooks from the whitelist;
//  3. integrate falls back to the full suite when the marker is missing or the validating sha does not cover the current branch;
//  4. the bounce-from-integration-to-active-to-resolved-to-integrate flow skips validated hooks on integrate.
//
// TASK-2646 extends coverage to a finalized commit that moved past the
// validated sha: bookkeeping-only movement (direct or through a rebase) reuses
// the marker; any substantive path or git failure runs the full suite.
// PX-0048 adds completed-rebase lineage: a recorded completed rebase carries
// the marker whatever the rebase brought in; edits outside it still run.
//
// No .only, no bare .skip.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  buildIntegrationValidationMarker,
  INTEGRATION_VALIDATION_EVENT_TYPE,
  partitionGatesForSkip,
  parseIntegrationValidationMarker,
  isBookkeepingPath,
  passingIntegrationReceiptApplies,
  validationSkipApplies,
} from '../../../src/application/integrate/validation-marker.js';
import { captureFinalIntegrationTree, listChangedPathsBetween } from '../../../src/adapters/cli/commands/integrate-gates.js';
import { createTestsActionExecutor } from '../../../src/application/integrate/tests-action.js';
import { createIntegrationGateStep } from '../../../src/application/integrate/gates.js';
import { routeIntegrationGateFailure } from '../../../src/adapters/cli/commands/integrate-gate-rebound.js';
import { setLogger } from '../../../src/application/presentation/cli-format.js';
import type { OperationalHistoryService } from '../../../src/application/services/operational-history-service.js';
import { openRepairFixture } from '../../lib/integration-repair-fixture.js';
import { SqliteOperationalHistoryRepository } from '../../../src/adapters/sqlite/operational-history-repository.js';
import { completedRebaseLineageForCheckout, ensureRebaseCompletionRecorder } from '../../../src/adapters/git/rebase-completion-recorder.js';
import { writeJson } from '../../../src/adapters/storage/storage.js';
import { bookkeepingCommitMessage } from '../../../src/domain/approval-coverage.js';
import { verificationEquivalentRevision } from '../../../src/adapters/git/revision-equivalence.js';
import { approveEligibleIntegrationShortcut } from '../../../src/application/integrate/approval.js';
import { MissionLifecycleService } from '../../../src/application/mission-lifecycle-service.js';
import { recordApproval } from '../../../src/adapters/review/review-round.js';
import { agentFamily } from '../../../src/domain/agents.js';
import { changeRevision, type Review } from '../../../src/domain/review.js';
import { createIntegrationVerificationEvidencePort, readIntegrationGateRun } from '../../../src/adapters/verification/integration-verification-proof.js';
import { missionId } from '../../../src/domain/mission.js';

const EVENT = INTEGRATION_VALIDATION_EVENT_TYPE;
const SLUG = 'task-2625';

// ── buildIntegrationValidationMarker ─────────────────────────────────────────

test('buildIntegrationValidationMarker keeps distinct non-empty hooks and rejects an empty whitelist', () => {
  const marker = buildIntegrationValidationMarker(SLUG, 'abc123', ['unit', 'integration-ci', 'unit']);
  assert.deepEqual(marker.hooks, ['unit', 'integration-ci']);
  assert.equal(marker.sha, 'abc123');
  assert.throws(() => buildIntegrationValidationMarker(SLUG, 'abc', []), /at least one validated hook/);
  assert.throws(() => buildIntegrationValidationMarker(SLUG, '', ['unit']), /validating sha/);
  assert.throws(() => buildIntegrationValidationMarker('', 'sha', ['unit']), /mission id/);
});

// ── parseIntegrationValidationMarker ──────────────────────────────────────────

test('parseIntegrationValidationMarker accepts a well-formed marker and rejects every malformed shape', () => {
  const good = parseIntegrationValidationMarker({
    eventType: EVENT,
    eventData: JSON.stringify({ missionId: SLUG, sha: 'deadbeef', hooks: ['unit', 'integration-ci'] }),
  });
  assert.equal(good?.sha, 'deadbeef');
  assert.deepEqual(good?.hooks, ['unit', 'integration-ci']);

  assert.equal(parseIntegrationValidationMarker({ eventType: 'other', eventData: '{}' }), null);
  assert.equal(parseIntegrationValidationMarker({ eventType: EVENT, eventData: 'not json' }), null);
  assert.equal(parseIntegrationValidationMarker({ eventType: EVENT, eventData: JSON.stringify({ sha: 'x', hooks: ['unit'] }) }), null); // no missionId
  assert.equal(parseIntegrationValidationMarker({ eventType: EVENT, eventData: JSON.stringify({ missionId: SLUG, sha: 'x' }) }), null); // no hooks
  assert.equal(parseIntegrationValidationMarker({ eventType: EVENT, eventData: JSON.stringify({ missionId: SLUG, sha: 'x', hooks: [] }) }), null); // empty whitelist
  assert.equal(parseIntegrationValidationMarker(null), null);
});

// ── validationSkipApplies ─────────────────────────────────────────────────────

test('validationSkipApplies is true only when the validating sha still covers the current branch', () => {
  const marker = buildIntegrationValidationMarker(SLUG, 'validating-sha', ['unit', 'integration-ci']);
  assert.equal(validationSkipApplies(marker, 'validating-sha'), true);
  assert.equal(validationSkipApplies(marker, 'moved-sha'), false, 'branch moved -> fallback');
  assert.equal(validationSkipApplies(marker, null), false, 'no current head -> fallback');
  assert.equal(validationSkipApplies(null, 'validating-sha'), false, 'no marker -> fallback');
  // A marker is never built with an empty whitelist (buildIntegrationValidationMarker rejects it),
  // so an empty whitelist also falls back; assert via the guarded predicate directly.
  assert.equal(validationSkipApplies({ missionId: SLUG, sha: 's', hooks: [] }, 's'), false, 'empty whitelist -> fallback');
});

// ── partitionGatesForSkip ─────────────────────────────────────────────────────

test('partitionGatesForSkip splits whitelisted (skip) from unvalidated (run) hooks', () => {
  const marker = buildIntegrationValidationMarker(SLUG, 's', ['unit']);
  const { skip, run } = partitionGatesForSkip(['unit', 'integration-ci', 'quality-gate'], marker);
  assert.deepEqual(skip, ['unit']);
  assert.deepEqual(run, ['integration-ci', 'quality-gate']);
});

test('passing receipt policy preserves exact and equivalent coverage but rejects incomplete, stale, failed, cancelled, superseded, and other-plan evidence (TASK-2867.09)', () => {
  const configured = [{ key: 'unit', command: 'u' }, { key: 'integration-ci', command: 'i' }];
  const receipt = { gateRunId: 'original-run', revision: 'tested', status: 'passed' as const, current: true, carried: null,
    gates: configured, outcomes: configured.map(gate => ({ ...gate, exitCode: 0 })) };
  assert.equal(passingIntegrationReceiptApplies(receipt, 'tested', configured, 'exact'), true, 'exact-head policy restart');
  assert.equal(passingIntegrationReceiptApplies({ ...receipt, revision: 'before-backlog' }, 'after-backlog', configured, 'equivalent'), true,
    'adapter-proven equivalent inputs retain the receipt');
  assert.equal(passingIntegrationReceiptApplies({ ...receipt, current: false, carried: [{ from: 'before', to: 'after' }] },
    'after', configured, 'equivalent'), true, 'completed rebase retains the receipt');
  const rejected = [
    null,
    { ...receipt, gateRunId: null },
    { ...receipt, gates: configured.slice(0, 1), outcomes: receipt.outcomes.slice(0, 1) },
    { ...receipt, current: false },
    { ...receipt, status: 'failed' as const },
    { ...receipt, status: 'cancelled' as const },
    { ...receipt, status: 'running' as const },
    { ...receipt, outcomes: [{ ...configured[0], exitCode: 1 }, receipt.outcomes[1]] },
  ];
  for (const candidate of rejected) {
    assert.equal(passingIntegrationReceiptApplies(candidate, 'tested', configured, 'equivalent'), false);
  }
  assert.equal(passingIntegrationReceiptApplies(receipt, 'tested', [{ key: 'unit', command: 'changed' }], 'equivalent'), false,
    'gate-plan mismatch reruns');
});

// ── resolveSkippableGates (the wired skip decision) ───────────────────────────

test('revision equivalence avoids Git reads for the identical revision and stops after one diff for obvious changes (TASK-2867.09)', () => {
  const original = '1'.repeat(40), candidate = '2'.repeat(40);
  const calls: string[][] = [];
  const backlogOnly = (args: string[]) => {
    calls.push(args);
    return { status: 0, stdout: 'backlog/tasks/task-1.md\0', stderr: '' };
  };
  assert.equal(verificationEquivalentRevision('/repo', original, original, backlogOnly), true);
  assert.equal(calls.length, 0, 'same revision requires no Git read');
  assert.equal(verificationEquivalentRevision('/repo', original, candidate, backlogOnly), true);
  assert.equal(calls.length, 1, 'Backlog-only movement requires one diff');

  calls.length = 0;
  const substantive = (args: string[]) => {
    calls.push(args);
    return { status: 0, stdout: 'src/change.ts\0', stderr: '' };
  };
  assert.equal(verificationEquivalentRevision('/repo', original, candidate, substantive), false);
  assert.equal(calls.length, 1, 'an obviously substantive path stops after one diff');
});

function markerEntry(sha: string, hooks: string[]) {
  return { createdAt: '2026-10-01T00:00:00Z', eventType: EVENT, eventData: JSON.stringify({ missionId: SLUG, sha, hooks }) };
}

type ChangedPathsResult = { ok: true; paths: string[] } | { ok: false; error: string };

function makeStep(overrides: {
  loadLatest?: () => Promise<OperationalHistoryEntry | null> | OperationalHistoryEntry | null;
  runPhaseGates?: IntegrateWorkflowPorts['gates']['runPhaseGates'];
  readGateRun?: IntegrateWorkflowPorts['gates']['readGateRun'];
  changedPaths?: (_from: string, _to: string) => ChangedPathsResult;
  lineageRoot?: string;
} = {}) {
  const recorded: Array<{ missionId: string; sha: string; hooks: string[]; failed?: boolean }> = [];
  const diffCalls: Array<{ rootDir: string; from: string; to: string }> = [];
  const step = createIntegrationGateStep(stubIntegrateWorkflowPorts({
    gates: {
      listChangedPathsBetween: (rootDir: string, from: string, to: string) => {
        diffCalls.push({ rootDir, from, to });
        return overrides.changedPaths ? overrides.changedPaths(from, to) : { ok: false, error: 'no diff seam configured' };
      },
      resolveIntegrationVerificationWorktree: () => '/fw',
      captureFinalIntegrationTree: () => ({ ok: true as const, rootDir: '/fw', commit: 'final', tree: 't' }),
      loadPhaseGates: () => [{ key: 'unit', command: 'u', order: 1 }, { key: 'integration-ci', command: 'i', order: 2 }],
      loadRequirePreIntegration: () => false,
      ...(overrides.readGateRun ? { readGateRun: overrides.readGateRun } : {}),
      runPhaseGates: overrides.runPhaseGates
        ? overrides.runPhaseGates
        : async () => phaseGateResult({ skipped: false, gates: [{ key: 'unit', command: 'u', order: 1 }, { key: 'integration-ci', command: 'i', order: 2 }], executed: 2 }),
      // The real completed-rebase owner reads the fixture checkout; the latest validation stays green.
      ...(overrides.lineageRoot ? { approvalEvidence: () => ({
        samePatch: async () => true, reconcileHumanFeedback: async () => true, now: () => new Date().toISOString(),
        validation: async () => ({ missionId: SLUG, sha: 'v', hooks: ['unit'], baseline: null, createdAt: '2026-10-01T00:00:00Z', reference: 'fixture' }),
        completedRebaseLineage: (from: string, to: string) => completedRebaseLineageForCheckout(overrides.lineageRoot!, from, to),
      }) } : {}),
    },
    landing: { createAbort: () => Object.assign(new Error('aborted'), { name: 'IntegrationAbort' }) },
    verification: { formatVerificationCommand: () => 'verify' },
  }));
  const operationalHistory: Pick<OperationalHistoryService, 'loadLatestByTypeForMission' | 'recordIntegrationValidation'> = {
    async loadLatestByTypeForMission(type: string, missionId: string) {
      assert.equal(type, EVENT);
      assert.equal(missionId, SLUG);
      return overrides.loadLatest ? overrides.loadLatest() : null;
    },
    async recordIntegrationValidation(marker: { missionId: string; sha: string; hooks: readonly string[]; failed?: boolean }) {
      recorded.push({ missionId: marker.missionId, sha: marker.sha, hooks: [...marker.hooks], failed: marker.failed });
    },
  };
  return { step, operationalHistory, recorded, diffCalls };
}

test('resolveSkippableGates runs the full set when no marker exists (SC3 fallback)', async () => {
  const { step, operationalHistory } = makeStep();
  const { gates, skippedAll } = await step.resolveSkippableGates({
    configured: [{ key: 'unit' }, { key: 'integration-ci' }],
    slug: SLUG,
    checkout: '/fw',
    finalizedCommit: 'validating-sha',
    operationalHistory,
    log: () => {},
  });
  assert.equal(skippedAll, false);
  assert.deepEqual(gates.map(gate => gate.key), ['unit', 'integration-ci']);
});

test('resolveSkippableGates runs the full set when the validating sha no longer covers the branch (SC3 fallback)', async () => {
  const { step, operationalHistory } = makeStep({
    loadLatest: () => markerEntry('old-sha', ['unit']),
  });
  const { gates, skippedAll } = await step.resolveSkippableGates({
    configured: [{ key: 'unit' }, { key: 'integration-ci' }],
    slug: SLUG,
    checkout: '/fw',
    finalizedCommit: 'current-sha',
    operationalHistory,
    log: () => {},
  });
  assert.equal(skippedAll, false);
  assert.deepEqual(gates.map(gate => gate.key), ['unit', 'integration-ci']);
});

// ── SC4 integration adapter: validated hooks skipped on integrate, fallback when absent ─

test('integrate skips validated hooks after a green bounce-verify and falls back when the marker is absent or the branch moved (SC4)', async () => {
  const configured = [{ key: 'unit' }, { key: 'integration-ci' }, { key: 'quality-gate' }];
  // (a) prior bounce-verify recorded a marker for the current validating sha -> skip the whitelisted hook
  const withMarker = makeStep({ loadLatest: () => markerEntry('validating-sha', ['unit', 'integration-ci']) });
  const skipped = await withMarker.step.resolveSkippableGates({
    configured, slug: SLUG, checkout: '/fw', finalizedCommit: 'validating-sha', operationalHistory: withMarker.operationalHistory, log: () => {},
  });
  assert.deepEqual(skipped.gates.map(gate => gate.key), ['quality-gate'], 'only the unvalidated hook runs');
  // (b) marker absent -> fall back to the full suite
  const noMarker = makeStep();
  const fallback = await noMarker.step.resolveSkippableGates({
    configured, slug: SLUG, checkout: '/fw', finalizedCommit: 'validating-sha', operationalHistory: noMarker.operationalHistory, log: () => {},
  });
  assert.deepEqual(fallback.gates.map(gate => gate.key), ['unit', 'integration-ci', 'quality-gate']);
  // (c) branch moved past the validating sha -> fall back to the full suite
  const moved = makeStep({ loadLatest: () => markerEntry('moved-past', ['unit']) });
  const movedResult = await moved.step.resolveSkippableGates({
    configured, slug: SLUG, checkout: '/fw', finalizedCommit: 'current-sha', operationalHistory: moved.operationalHistory, log: () => {},
  });
  assert.deepEqual(movedResult.gates.map(gate => gate.key), ['unit', 'integration-ci', 'quality-gate']);
});

test('resolveSkippableGates skips the whitelisted hook when the validating sha still covers the branch (SC2/SC4)', async () => {
  const { step, operationalHistory } = makeStep({
    loadLatest: () => markerEntry('validating-sha', ['unit']),
  });
  const { gates, skippedAll } = await step.resolveSkippableGates({
    configured: [{ key: 'unit' }, { key: 'integration-ci' }],
    slug: SLUG,
    checkout: '/fw',
    finalizedCommit: 'validating-sha',
    operationalHistory,
    log: () => {},
  });
  assert.equal(skippedAll, false);
  assert.deepEqual(gates.map(gate => gate.key), ['integration-ci'], 'only the unvalidated hook runs');
});

test('resolveSkippableGates marks skippedAll when every configured hook is whitelisted', async () => {
  const { step, operationalHistory } = makeStep({
    loadLatest: () => markerEntry('validating-sha', ['unit', 'integration-ci']),
  });
  const result = await step.resolveSkippableGates({
    configured: [{ key: 'unit' }, { key: 'integration-ci' }],
    slug: SLUG,
    checkout: '/fw',
    finalizedCommit: 'validating-sha',
    operationalHistory,
    log: () => {},
  });
  assert.equal(result.skippedAll, true);
  assert.deepEqual(result.gates, []);
});

test('resolveSkippableGates falls back to the full set when the history is unreadable', async () => {
  const { step, operationalHistory } = makeStep({
    loadLatest: async () => { throw new Error('db locked'); },
  });
  const { gates } = await step.resolveSkippableGates({
    configured: [{ key: 'unit' }, { key: 'integration-ci' }],
    slug: SLUG,
    checkout: '/fw',
    finalizedCommit: 'validating-sha',
    operationalHistory,
    log: () => {},
  });
  assert.deepEqual(gates.map(gate => gate.key), ['unit', 'integration-ci']);
});

// ── round-2 F2: the skip keys on the finalized (post-rebase) tree, not the pre-rebase HEAD ─

test('resolveSkippableGates skips only when the finalized tree commit matches the validating sha, else full suite (round-2 F2)', async () => {
  const { step, operationalHistory } = makeStep({
    loadLatest: () => markerEntry('fixsha', ['unit', 'integration-ci']),
  });
  // The gates run against the finalized (post-rebase) tree. When that tree is
  // exactly the validating commit, the whitelisted hooks skip.
  const sameTree = await step.resolveSkippableGates({
    configured: [{ key: 'unit' }, { key: 'integration-ci' }, { key: 'quality-gate' }],
    slug: SLUG, checkout: '/fw', finalizedCommit: 'fixsha', operationalHistory, log: () => {},
  });
  assert.deepEqual(sameTree.gates.map(gate => gate.key), ['quality-gate']);
  // A rebase that changes the integration tree yields a different finalized
  // commit. The skip must NOT apply: the whitelisted hooks ran against the old
  // tree, so the new tree runs the full suite (this is the round-2 F2 bypass).
  const rebasedTree = await step.resolveSkippableGates({
    configured: [{ key: 'unit' }, { key: 'integration-ci' }, { key: 'quality-gate' }],
    slug: SLUG, checkout: '/fw', finalizedCommit: 'rebased-fixsha', operationalHistory, log: () => {},
  });
  assert.deepEqual(rebasedTree.gates.map(gate => gate.key), ['unit', 'integration-ci', 'quality-gate'], 'rebase-changed tree runs the full suite');
});

// ── TASK-2646: bookkeeping-only movement past the validated sha ─────────────

const TASK_FILE = 'backlog/tasks/task-9001 - Example-task.md';
const VALIDATED_SHA = 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678';
const FINALIZED_SHA = 'f0e1d2c3b4a5968778695a4b3c2d1e0f98765432';

test('a finalized commit advanced only by a backlog task-file commit skips the validated hooks and logs the validated sha (TASK-2646 SC1/SC2)', async () => {
  const { step, operationalHistory, diffCalls } = makeStep({
    loadLatest: () => markerEntry(VALIDATED_SHA, ['unit', 'integration-ci']),
    changedPaths: () => ({ ok: true as const, paths: [TASK_FILE] }),
  });
  const logs: string[] = [];
  const result = await step.resolveSkippableGates({
    configured: [{ key: 'unit' }, { key: 'integration-ci' }, { key: 'quality-gate' }],
    slug: SLUG,
    checkout: '/fw',
    finalizedCommit: FINALIZED_SHA,
    operationalHistory,
    log: message => logs.push(message),
  });
  assert.deepEqual(result.gates.map(gate => gate.key), ['quality-gate'], 'only the unvalidated hook runs');
  assert.deepEqual(diffCalls, [{ rootDir: '/fw', from: VALIDATED_SHA, to: FINALIZED_SHA }]);
  assert.equal(logs.length, 1);
  assert.ok(logs[0].includes(`validated at ${VALIDATED_SHA.slice(0, 12)}`), 'names the validated sha');
  assert.match(logs[0], /unit, integration-ci/, 'names the skipped hooks');
});

test('isBookkeepingPath accepts only Backlog task records and validationSkipApplies rejects any other diff (TASK-2646 SC3)', () => {
  for (const bookkeeping of [TASK_FILE, 'backlog/completed/task-9001 - Example-task.md']) {
    assert.equal(isBookkeepingPath(bookkeeping), true, bookkeeping);
  }
  for (const substantive of ['src/a.ts', 'test/a.test.ts', 'config/integration-pipelines.json', 'workflow.config.json', 'package.json',
    'backlog/config.yml', 'backlog/docs/note.md', 'backlog/tasks/nested/task.md', 'backlog/tasks/task-1.txt', 'docs/backlog/tasks/x.md']) {
    assert.equal(isBookkeepingPath(substantive), false, substantive);
  }
  const marker = buildIntegrationValidationMarker(SLUG, VALIDATED_SHA, ['unit']);
  assert.equal(validationSkipApplies(marker, FINALIZED_SHA, { ok: true, paths: [TASK_FILE] }), true, 'bookkeeping only');
  assert.equal(validationSkipApplies(marker, FINALIZED_SHA, { ok: true, paths: [] }), true, 'identical tree');
  assert.equal(validationSkipApplies(marker, FINALIZED_SHA, { ok: true, paths: [TASK_FILE, 'src/a.ts'] }), false, 'mixed diff');
  assert.equal(validationSkipApplies(marker, FINALIZED_SHA, { ok: false, error: 'bad object' }), false, 'git failure');
  assert.equal(validationSkipApplies(marker, FINALIZED_SHA), false, 'no diff evidence');
});

test('any non-bookkeeping path in the validated-to-finalized diff selects the full configured suite (TASK-2646 SC3)', async () => {
  const configured = [{ key: 'unit' }, { key: 'integration-ci' }];
  for (const substantive of ['src/application/integrate/gates.ts', 'test/a.test.ts', 'config/integration-pipelines.json', 'workflow.config.json']) {
    const { step, operationalHistory } = makeStep({
      loadLatest: () => markerEntry(VALIDATED_SHA, ['unit', 'integration-ci']),
      changedPaths: () => ({ ok: true as const, paths: [TASK_FILE, substantive] }),
    });
    const logs: string[] = [];
    const result = await step.resolveSkippableGates({
      configured, slug: SLUG, checkout: '/fw', finalizedCommit: FINALIZED_SHA, operationalHistory, log: message => logs.push(message),
    });
    assert.deepEqual(result.gates.map(gate => gate.key), ['unit', 'integration-ci'], substantive);
    assert.deepEqual(logs, [], `${substantive}: nothing reported as skipped`);
  }
});

test('missing history, an unreachable marker sha, and every git-diff failure fall back to the full suite (TASK-2646 SC5)', async () => {
  const configured = [{ key: 'unit' }, { key: 'integration-ci' }];
  const marker = () => markerEntry(VALIDATED_SHA, ['unit', 'integration-ci']);
  const cases: Array<[string, Parameters<typeof makeStep>[0], boolean]> = [
    ['no marker row', { changedPaths: () => ({ ok: true as const, paths: [TASK_FILE] }) }, true],
    ['unreadable history', { loadLatest: async () => { throw new Error('db locked'); }, changedPaths: () => ({ ok: true as const, paths: [TASK_FILE] }) }, true],
    ['malformed marker row', { loadLatest: () => ({ createdAt: '2026-10-01T00:00:00Z', eventType: EVENT, eventData: '{' }), changedPaths: () => ({ ok: true as const, paths: [TASK_FILE] }) }, true],
    ['unreachable marker sha', { loadLatest: marker, changedPaths: () => ({ ok: false as const, error: `fatal: bad object ${VALIDATED_SHA}` }) }, true],
    ['git diff throws', { loadLatest: marker, changedPaths: () => { throw new Error('spawn git ENOENT'); } }, true],
  ];
  for (const [label, overrides] of cases) {
    const { step, operationalHistory } = makeStep(overrides);
    const result = await step.resolveSkippableGates({
      configured, slug: SLUG, checkout: '/fw', finalizedCommit: FINALIZED_SHA, operationalHistory, log: () => {},
    });
    assert.deepEqual(result.gates.map(gate => gate.key), ['unit', 'integration-ci'], label);
  }
  const { step } = makeStep({ loadLatest: marker, changedPaths: () => ({ ok: true as const, paths: [TASK_FILE] }) });
  const noStore = await step.resolveSkippableGates({
    configured, slug: SLUG, checkout: '/fw', finalizedCommit: FINALIZED_SHA, operationalHistory: null, log: () => {},
  });
  assert.deepEqual(noStore.gates.map(gate => gate.key), ['unit', 'integration-ci'], 'history store unavailable');
});

// ── TASK-2646: real git movement through the gates-port adapter ──────────────

/**
 * A throwaway repository with hermetic git config (no user/system config,
 * hooks, signing, or auto-gc) so each case spends its CPU budget only on the
 * git operations it asserts on.
 */
function openGitRepo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'px-validation-skip-'));
  const env = {
    ...process.env,
    GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: os.devNull,
    GIT_CONFIG_COUNT: '2', GIT_CONFIG_KEY_0: 'commit.gpgsign', GIT_CONFIG_VALUE_0: 'false', GIT_CONFIG_KEY_1: 'gc.auto', GIT_CONFIG_VALUE_1: '0',
    GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@example.invalid', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@example.invalid',
  };
  const git = (...args: string[]) => execFileSync('git', ['-C', root, ...args], { env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  const head = () => git('rev-parse', 'HEAD');
  const commit = (files: Record<string, string>, message: string) => {
    for (const [file, content] of Object.entries(files)) {
      fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
      fs.writeFileSync(path.join(root, file), content);
    }
    git('add', '-A');
    git('commit', '-q', '--no-verify', '-m', message);
  };
  git('init', '-q', '-b', 'main');
  commit({ 'src/a.ts': 'export const a = 1;\n', [TASK_FILE]: 'status: active\n',
    'package.json': '{\n  "version": "1.0.0"\n}\n' }, 'base');
  return { root, git, head, commit, close: () => fs.rmSync(root, { recursive: true, force: true }) };
}

/** Resolve the gates against the mission HEAD with the real diff and completed-rebase owners. */
async function resolveAtHead(repo: ReturnType<typeof openGitRepo>, validatedSha: string, logs: string[] = []) {
  const finalized = repo.head();
  const { step, operationalHistory } = makeStep({
    loadLatest: () => markerEntry(validatedSha, ['unit', 'integration-ci']),
    changedPaths: (from, to) => listChangedPathsBetween(repo.root, from, to),
    lineageRoot: repo.root,
  });
  const result = await step.resolveSkippableGates({
    configured: [{ key: 'unit' }, { key: 'integration-ci' }], slug: SLUG, checkout: repo.root, finalizedCommit: finalized, operationalHistory, log: line => logs.push(line),
  });
  return { finalized, keys: result.gates.map(gate => gate.key) };
}

/** Rebase the mission branch onto main and resolve the gates against the post-rebase HEAD. */
async function resolveAfterRebase(repo: ReturnType<typeof openGitRepo>, validatedSha: string, logs: string[] = []) {
  repo.git('rebase', '-q', 'main', 'mission');
  return resolveAtHead(repo, validatedSha, logs);
}

test('listChangedPathsBetween reports moved task records and fails open for unreachable or malformed commits (TASK-2646 SC2/SC5)', () => {
  const repo = openGitRepo();
  try {
    const validated = repo.head();
    fs.mkdirSync(path.join(repo.root, 'backlog/completed'), { recursive: true });
    repo.git('mv', TASK_FILE, 'backlog/completed/task-9001 - Example-task.md');
    repo.commit({}, 'backlog(task-9001): transition to done');
    const moved = repo.head();
    const diff = listChangedPathsBetween(repo.root, validated, moved);
    assert.equal(diff.ok, true);
    assert.deepEqual(diff.ok && [...diff.paths].sort(), ['backlog/completed/task-9001 - Example-task.md', TASK_FILE]);
    assert.equal(verificationEquivalentRevision(repo.root, validated, moved), true,
      'both sides of a Backlog lane transition remain verification bookkeeping');
    assert.equal(listChangedPathsBetween(repo.root, 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef', moved).ok, false, 'unreachable marker sha');
    assert.equal(listChangedPathsBetween(repo.root, '--output=/tmp/x', moved).ok, false, 'malformed id never reaches git');
  } finally { repo.close(); }
});

test('a post-rebase finalized commit reuses validation when main moved only by bookkeeping (TASK-2646 SC4)', async () => {
  const repo = openGitRepo();
  try {
    repo.git('checkout', '-q', '-b', 'mission');
    repo.commit({ 'src/a.ts': 'export const a = 2;\n' }, 'fix');
    const validated = repo.head();
    repo.git('checkout', '-q', 'main');
    repo.commit({ 'backlog/tasks/task-9002 - Other.md': 'status: review\n' }, 'backlog(task-9002): transition to review');
    const { finalized, keys } = await resolveAfterRebase(repo, validated);
    assert.notEqual(finalized, validated, 'rebase moved the commit');
    assert.deepEqual(keys, [], 'every validated hook is skipped');
  } finally { repo.close(); }
});

test('an unrecorded rebase that brought a non-bookkeeping change runs the full suite (TASK-2646 SC4, PX-0048)', async () => {
  const repo = openGitRepo();
  try {
    repo.git('checkout', '-q', '-b', 'mission');
    repo.commit({ 'src/a.ts': 'export const a = 2;\n' }, 'fix');
    const validated = repo.head();
    repo.git('checkout', '-q', 'main');
    repo.commit({ 'backlog/tasks/task-9002 - Other.md': 'status: review\n', 'src/b.ts': 'export const b = 1;\n' }, 'feat: other mission');
    const { finalized, keys } = await resolveAfterRebase(repo, validated);
    assert.notEqual(finalized, validated);
    assert.deepEqual(keys, ['unit', 'integration-ci'], 'no completed-rebase lineage: full configured suite');
  } finally { repo.close(); }
});

test('a recorded completed rebase carries validated hooks across upstream source, test, dependency and configuration changes; a later edit does not (PX-0048)', async () => {
  const repo = openGitRepo();
  try {
    repo.git('checkout', '-q', '-b', 'mission');
    repo.commit({ 'src/a.ts': 'export const a = 2;\n' }, 'fix');
    const validated = repo.head();
    ensureRebaseCompletionRecorder(repo.root, { writeJson });
    repo.git('checkout', '-q', 'main');
    repo.commit({ 'src/b.ts': 'export const b = 1;\n', 'test/b.test.ts': 'b\n', 'package.json': '{}\n', 'workflow.config.json': '{"maxConcurrentCustom":1}\n' }, 'upstream');
    const logs: string[] = [];
    const { finalized, keys } = await resolveAfterRebase(repo, validated, logs);
    assert.notEqual(finalized, validated);
    assert.deepEqual(keys, [], 'every validated hook is carried');
    assert.match(logs.join('\n'), new RegExp(`validated at ${validated.slice(0, 12)} \\(carried to finalized ${finalized.slice(0, 12)} by 1 completed rebase`));
    repo.commit({ 'src/a.ts': 'export const a = 3;\n' }, 'new implementation');
    assert.deepEqual((await resolveAtHead(repo, validated)).keys, ['unit', 'integration-ci'], 'an edit outside a completed rebase runs');
  } finally { repo.close(); }
});

test('a tagged manifest commit with dependency, script, or configuration changes is substantive (TASK-2867.09)', async () => {
  const repo = openGitRepo();
  try {
    repo.git('checkout', '-q', '-b', 'mission');
    const validated = repo.head();
    repo.commit({ 'package.json': '{\n  "version": "1.0.1",\n  "dependencies": {\n    "x": "2"\n  },\n  "scripts": {\n    "test": "false"\n  },\n  "config": {\n    "mode": "changed"\n  }\n}\n' },
      bookkeepingCommitMessage('chore(task-2867.09): integrate pre-commit hook', 'pre-commit-hook'));
    assert.equal(verificationEquivalentRevision(repo.root, validated, repo.head()), false,
      'a trailer cannot authorize dependency, script, or configuration changes');
    const receipt = { gateRunId: 'original-run', revision: validated, status: 'passed' as const, current: false, carried: null,
      gates: REBOUND_GATES, outcomes: REBOUND_GATES.map(gate => ({ ...gate, exitCode: 0 })) };
    const { step, operationalHistory } = makeStep({ loadLatest: () => null, readGateRun: () => receipt });
    const result = await step.resolveSkippableGates({ configured: REBOUND_GATES, slug: SLUG, checkout: repo.root,
      finalizedCommit: repo.head(), operationalHistory, log: () => {} });
    assert.deepEqual(result.gates, REBOUND_GATES, 'substantive manifest movement takes the existing gate path');
  } finally { repo.close(); }
});

test('moving a source file into Backlog is substantive and runs the full landing gate plan (TASK-2867.09)', async () => {
  const repo = openGitRepo();
  try {
    repo.git('checkout', '-q', '-b', 'mission');
    const evidence = createIntegrationVerificationEvidencePort();
    const run = await evidence.start(repo.root, REBOUND_GATES, { missionId: missionId(SLUG), operatorInvocation: false });
    assert.ok(run, 'the original source tree has a complete passing receipt');
    run.complete(REBOUND_GATES.map(({ key, command }) => ({ key, command, exitCode: 0 })), 'passed');

    fs.mkdirSync(path.join(repo.root, 'backlog/tasks'), { recursive: true });
    repo.git('mv', 'src/a.ts', 'backlog/tasks/a.md');
    repo.commit({}, 'move source into backlog');

    const receipt = readIntegrationGateRun(repo.root);
    assert.equal(receipt?.current, false, 'the deleted source path makes the landing tree substantive');
    assert.equal(receipt?.carried, null);
    const { step, operationalHistory } = makeStep({ loadLatest: () => null, readGateRun: () => receipt });
    const landing = await step.resolveSkippableGates({ configured: REBOUND_GATES, slug: SLUG,
      checkout: repo.root, finalizedCommit: repo.head(), operationalHistory, log: () => {} });
    assert.deepEqual(landing.gates, REBOUND_GATES, 'landing runs the complete configured gate plan');
  } finally { repo.close(); }
});

// ── TASK-2867.09: review-step tests evidence at the landing candidate ────
// One real Git approval-to-landing flow: the policy-selected tests action writes
// a green receipt, agent and human approval preserve it, then the tagged version
// hook moves the candidate. Landing reads currency through the production adapter.

test('a complete green policy tests receipt survives agent and human approval and the verified version hook (TASK-2867.09)', async () => {
  const repo = openGitRepo();
  const diagnostics: string[] = [];
  const previous = setLogger({ log: message => diagnostics.push(String(message)), error: message => diagnostics.push(String(message)) });
  try {
    repo.git('checkout', '-q', '-b', 'mission');
    let launches = 0;
    const evidence = createIntegrationVerificationEvidencePort();
    const runState: { receipt: IntegrationGateRunRecord | null } = { receipt: null };
    const readRun = () => runState.receipt;
    const ports = stubIntegrateWorkflowPorts({
      process: { cwd: () => repo.root, claimIntegration: async () => async () => {} },
      git: { getCurrentBranch: () => 'mission' },
      gates: {
        resolveIntegrationVerificationWorktree: () => repo.root,
        captureFinalIntegrationTree: root => captureFinalIntegrationTree(root),
        loadPhaseGates: () => REBOUND_GATES, loadRequirePreIntegration: () => true,
        runPhaseGates: async () => {
          launches++;
          const outcomes = REBOUND_GATES.map(({ key, command }) => ({ key, command, exitCode: 0 }));
          const run = await evidence.start(repo.root, REBOUND_GATES, { missionId: missionId(SLUG), operatorInvocation: false });
          assert.ok(run, 'the real receipt adapter starts the policy gate run');
          run.complete(outcomes, 'passed');
          // Cache the writer's persisted fields for the tests action; landing below deliberately rereads currency.
          const stored = JSON.parse(fs.readFileSync(path.join(repo.root, '.git', 'integration-verification-proof.json'), 'utf8')) as {
            run: { gateRunId: string }; revision: string; status: 'passed';
            gates: { key: string; command: string }[]; outcomes: { key: string; command: string; exitCode: number }[];
          };
          runState.receipt = { gateRunId: stored.run.gateRunId, revision: stored.revision, status: stored.status,
            current: true, carried: null, gates: stored.gates, outcomes: stored.outcomes };
          return phaseGateResult({ gates: REBOUND_GATES, executed: REBOUND_GATES.length,
            outcomes: outcomes.map(outcome => ({ ...outcome, stdout: '', stderr: '' })), proofReusable: true });
        },
        readGateRun: readRun,
      },
      verification: { formatVerificationCommand: () => 'verify' },
      landing: { createAbort: () => Object.assign(new Error('aborted'), { name: 'IntegrationAbort' }),
        isAbort: error => (error as Error)?.name === 'IntegrationAbort' },
    });
    const services = integrationServices({ operationalHistory: { loadLatestByTypeForMission: async () => null,
      recordIntegrationValidation: async () => {} } });
    const outcome = await createTestsActionExecutor(ports, {
      buildIntegrationContext: async (slug, options) => integrationContext({ slug, executionContext: options.executionContext,
        baseWorktree: repo.root, missionWorktree: repo.root, reviewState: { implementer: 'custom' } }),
      runIntegrationRebase: async () => {},
      runRequiredLocalGates: request => createIntegrationGateStep(ports).runRequiredLocalGates(request),
    }).runTestsAction({ slug: SLUG, policySelection: 'tests', missionServicesFn: async () => services,
      executionContext: { missionId: SLUG, missionWorktree: repo.root, missionBranch: 'mission', baseWorktree: repo.root, baseBranch: 'main' },
      seams: {
        routeIntegrationGateFailureFn: async () => { throw new Error('green tests must not enter repair'); },
        startAgentFn: async () => { throw new Error('green tests must not launch a repair agent'); },
        transitionTaskFn: async () => true,
        applyAgentFallbackFn: async () => 'custom',
      } });
    if (outcome.kind !== 'completed' || outcome.verdict !== 'passed') { assert.fail(JSON.stringify(outcome)); }
    const originalRunId = runState.receipt?.gateRunId;
    assert.ok(originalRunId);
    assert.equal(outcome.evidence.gateRunId, originalRunId);
    const validated = repo.head();
    assert.equal(launches, 1, 'the policy tests action launches one complete local gate batch');

    // The existing agent-review aggregate and human shortcut owner consume the
    // original receipt without replacing it.
    const review = approvedReview(SLUG);
    const round = review.rounds[0];
    const approved: Review = { ...review, rounds: [{ ...round,
      subject: { ...round.subject, revision: changeRevision(validated) },
      decision: round.decision?.kind === 'approved'
        ? { ...round.decision, revision: changeRevision(validated) }
        : round.decision,
    }] };
    const approvalMission = fixtureMission(SLUG, {
      status: 'review', assignee: agentFamily('codex'), review: approved,
    });
    const approvalStore = inMemoryTransitionStore(approvalMission);
    const approvalServices = integrationServices({
      store: approvalStore,
      lifecycle: new MissionLifecycleService(approvalStore),
    });
    const approvalContext = integrationContext({ slug: SLUG, missionStatus: 'review', missionReview: approved,
      baseWorktree: repo.root, missionWorktree: repo.root });
    const approvalPorts = stubIntegrateWorkflowPorts({
      productConfig: { resolveReviewActionLimit: () => 40 },
      gates: {
        resolveIntegrationVerificationWorktree: () => repo.root,
        captureFinalIntegrationTree: root => captureFinalIntegrationTree(root),
        loadPhaseGates: () => REBOUND_GATES,
        readGateRun: readRun,
      },
      landing: { createAbort: () => Object.assign(new Error(diagnostics.join('\n')), { name: 'IntegrationAbort' }) },
      review: { submitApproval: async (slug, _message, options) => {
        const result = await recordApproval(slug, { comment: 'Integrated by human', revision: options.reviewedRevision,
          decidedAt: '2026-11-22T10:00:00Z', source: { kind: 'local' } },
        { missionStore: options.missionServices.store, lifecycleService: options.missionServices.lifecycle });
        return result.outcome === 'failed' ? { ok: false, diagnostic: result.diagnostic } : { ok: true };
      } },
    });
    await approveEligibleIntegrationShortcut(approvalContext, await approvalStore.load(approvalMission.id),
      approvalServices, approvalPorts);
    assert.equal((await approvalStore.load(approvalMission.id)).mission.status, 'integration');
    assert.equal(runState.receipt?.gateRunId, originalRunId, 'approval preserves the original gate receipt');

    repo.commit({ 'package.json': '{\n  "version": "1.0.1"\n}\n' },
      bookkeepingCommitMessage('chore(task-2867.09): integrate pre-commit hook', 'pre-commit-hook'));

    const finalized = repo.head();
    assert.notEqual(finalized, validated, 'the verified hook moved the candidate');
    const landingState: { receipt: ReturnType<typeof readIntegrationGateRun> } = { receipt: null };
    const gateStep = makeStep({ loadLatest: () => null, readGateRun: checkout => {
      landingState.receipt = readIntegrationGateRun(checkout);
      return landingState.receipt;
    } });
    const landing = await gateStep.step.resolveSkippableGates({ configured: REBOUND_GATES, slug: SLUG,
      checkout: repo.root, finalizedCommit: finalized, operationalHistory: gateStep.operationalHistory, log: () => {} });
    assert.deepEqual(landing.gates, [], 'landing reuses the complete original receipt');
    assert.equal(launches, 1, 'landing launches no second local gate batch');
    assert.equal(landingState.receipt?.current, true, 'the production reader proves the hook-only revision equivalent');
    assert.equal(landingState.receipt?.gateRunId, originalRunId, 'the original run identity and verdict provenance survive');
  } finally { setLogger(previous); repo.close(); }
});

test('a recorded landing rebase carries the rebound marker past mission bookkeeping and upstream source (TASK-2859.14)', async () => {
  const repo = openGitRepo();
  try {
    repo.git('checkout', '-q', '-b', 'mission');
    repo.commit({ 'src/a.ts': 'export const a = 3;\n' }, 'repair');
    // The gate-run writer installs the recorder before every integration run.
    ensureRebaseCompletionRecorder(repo.root, { writeJson });
    const validated = repo.head();
    repo.commit({ [TASK_FILE]: 'status: review\n' }, 'backlog bookkeeping');
    repo.git('checkout', '-q', 'main');
    repo.commit({ 'src/c.ts': 'export const c = 1;\n' }, 'upstream before landing');
    const logs: string[] = [];
    const landing = await resolveAfterRebase(repo, validated, logs);
    assert.deepEqual(landing.keys, [], 'the recorded completed landing rebase carries every validated hook');
    assert.match(logs.join('\n'), /by 1 completed rebase/);
  } finally { repo.close(); }
});

// ── SC1: the rebound green-validation path persists the skip marker ──────────

const REBOUND_GATES = [
  { key: 'unit', command: 'u', order: 1 },
  { key: 'integration-ci', command: 'i', order: 2 },
];

function completeGreenReboundResult() {
  return phaseGateResult({
    gates: REBOUND_GATES,
    executed: REBOUND_GATES.length,
    outcomes: REBOUND_GATES.map(gate => ({ ...gate, exitCode: 0, stdout: '', stderr: '' })),
  });
}

test('rebound verify rerun green records the skip marker keyed on the fix commit (SC1)', async () => {
  let recorded: { value: { missionId: string; sha: string; hooks: string[] } | null } = { value: null };
  const route = await routeIntegrationGateFailure({
    slug: SLUG,
    missionWorktree: '/fw',
    failedGate: { key: 'integration-ci', command: 'int', exitCode: 1, stdout: '', stderr: '' },
    gates: REBOUND_GATES,
    implementer: 'custom',
    repositoryId: 'unknown',
    // The kernel bounces the mission active, the implementer fixes, and the
    // verify seam re-runs the identical gate set green. Replaying context.verify()
    // drives the real verify seam (my injected runPhaseGatesFn + captureFinalTreeFn)
    // so the marker is recorded, then report the bounce fixed.
    runPhaseGatesFn: async () => completeGreenReboundResult(),
    captureFinalTreeFn: () => ({ ok: true as const, rootDir: '/fw', commit: 'fixsha123', tree: 't' }),
    reboundFn: async (reason, ctx) => { await ctx.verify(1); return { attempts: 1, outcome: 'fixed', diagnostic: '', implementer: ctx.implementer, classification: classifyReboundReason(reason) }; },
    startAgentFn: async () => ({ agent: 'custom', result: { status: 0 } }),
    transitionTaskFn: async () => true,
    recordIntegrationValidationFn: async (input) => {
      recorded.value = { missionId: input.missionId, sha: input.sha, hooks: [...input.hooks] };
    },
  });
  assert.equal(route.route, 'fixed', 'routing reports the bounce fixed');
  assert.ok(recorded.value, 'the rebound green-validation path persisted the skip marker');
  assert.equal(recorded.value!.missionId, SLUG);
  assert.equal(recorded.value!.sha, 'fixsha123', 'keyed on the fix commit, not the pre-rebase head');
  assert.deepEqual(recorded.value!.hooks.sort(), ['integration-ci', 'unit'], 'every validated hook is whitelisted');
});

test('rebound verify rerun green with no recording store leaves the full suite to run next time', async () => {
  const route = await routeIntegrationGateFailure({
    slug: SLUG,
    missionWorktree: '/fw',
    failedGate: { key: 'integration-ci', command: 'int', exitCode: 1, stdout: '', stderr: '' },
    gates: REBOUND_GATES,
    implementer: 'custom',
    repositoryId: 'unknown',
    runPhaseGatesFn: async () => completeGreenReboundResult(),
    captureFinalTreeFn: () => ({ ok: true as const, rootDir: '/fw', commit: 'fixsha123', tree: 't' }),
    startAgentFn: async () => { throw new Error('Unexpected launch'); },
    transitionTaskFn: async () => { throw new Error('Unexpected transition'); },
    // Replaying verify drives the real seam; with no recordIntegrationValidationFn
    // injected the seam short-circuits the record, so an unavailable store is inert.
    reboundFn: async (reason, ctx) => { await ctx.verify(1); return { attempts: 1, outcome: 'fixed', diagnostic: '', implementer: ctx.implementer, classification: classifyReboundReason(reason) }; },
  });
  assert.equal(route.route, 'fixed');
});

// ── durable round-trip through the real operational_history table (SC1) ───────

test('the integration-validation marker persists and reads back through the real SQLite operational_history table', async () => {
  const fixture = await openRepairFixture({ slug: 'task-2625-durable' });
  try {
    const repo = new SqliteOperationalHistoryRepository(fixture.database);
    await repo.append({
      eventType: EVENT,
      eventData: JSON.stringify({ missionId: fixture.slug, sha: fixture.approvedRevision, hooks: ['unit', 'integration-ci'] }),
      createdAt: new Date().toISOString(),
    });
    const entries = await repo.findByTypeForMission!(EVENT, fixture.slug);
    assert.equal(entries.length, 1, 'exactly one marker row for the mission');
    const marker = parseIntegrationValidationMarker(entries[0]);
    assert.equal(marker?.sha, fixture.approvedRevision, 'marker reads back the validating sha');
    assert.deepEqual(marker?.hooks, ['unit', 'integration-ci']);
    assert.equal(validationSkipApplies(marker, fixture.approvedRevision), true, 'current branch covers the validating sha');
    assert.equal(validationSkipApplies(marker, 'unrelated-sha'), false, 'a moved branch falls back to the full suite');
  } finally {
    await fixture.close();
  }
});

test('runRequiredLocalGates records failure without green validation when the suite fails', async () => {
  const { step, operationalHistory, recorded } = makeStep({
    runPhaseGates: async () => (phaseGateResult({ ok: false as const, skipped: false, failedGate: { key: 'unit' }, error: 'red' })),
  });
  const previous = setLogger({ log: () => {}, error: () => {} });
  try {
    await assert.rejects(
      step.runRequiredLocalGates({
        slug: SLUG,
        context: integrationContext({ missionHeadSha: 'validating-sha', baseWorktree: '/fw', area: 'all', branch: `mission/${SLUG}` }),
        missionLoad: { kind: 'found', version: missionVersion(1), mission: fixtureMission(SLUG, { status: 'integration', review: null }) },
        missionServices: integrationServices({ operationalHistory }),
        dryRun: false,
        noIntegrationGates: false,
        realAgent: null,
        realAgentModel: null,
        seams: {
          transitionTaskFn: async () => true,
          startAgentFn: async () => { throw new Error('no launch'); },
          applyAgentFallbackFn: async () => 'custom',
          routeIntegrationGateFailureFn: async () => { throw Object.assign(new Error('red gate'), { name: 'IntegrationAbort' }); },
        },
      }),
      (error: Error) => error.name === 'IntegrationAbort',
    );
    assert.equal(recorded.filter(marker => !marker.failed).length, 0, 'no green marker recorded on a red suite');
    assert.deepEqual(recorded, [{ missionId: SLUG, sha: 'final', hooks: ['unit'], failed: true }],
      'the failed hook invalidates earlier green evidence');
  } finally { setLogger(previous); }
});
