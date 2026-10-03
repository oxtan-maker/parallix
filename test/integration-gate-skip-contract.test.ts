// TASK-2625: sha-keyed integration-validation marker.
//
// Covers the four success criteria:
//  1. the marker is recorded when the integration suite passes green (recorded by the validation path);
//  2. integrate skips the validated high-level hooks from the whitelist;
//  3. integrate falls back to the full suite when the marker is missing or the validating sha does not cover the current branch;
//  4. the bounce-from-integration-to-active-to-resolved-to-integrate flow skips validated hooks on integrate.
//
// No .only, no bare .skip.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildIntegrationValidationMarker,
  INTEGRATION_VALIDATION_EVENT_TYPE,
  partitionGatesForSkip,
  parseIntegrationValidationMarker,
  validationSkipApplies,
} from '../src/application/integrate/validation-marker.js';
import { createIntegrationGateStep } from '../src/application/integrate/gates.js';
import { routeIntegrationGateFailure } from '../src/adapters/cli/commands/integrate-gate-rebound.js';
import { setLogger } from '../src/application/presentation/cli-format.js';
import type { OperationalHistoryService } from '../src/application/services/operational-history-service.js';
import { openRepairFixture } from './lib/integration-repair-fixture.js';
import { SqliteOperationalHistoryRepository } from '../src/adapters/sqlite/operational-history-repository.js';

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
  assert.equal(validationSkipApplies({ missionId: SLUG, sha: 's', hooks: [] } as never, 's'), false, 'empty whitelist -> fallback');
});

// ── partitionGatesForSkip ─────────────────────────────────────────────────────

test('partitionGatesForSkip splits whitelisted (skip) from unvalidated (run) hooks', () => {
  const marker = buildIntegrationValidationMarker(SLUG, 's', ['unit']);
  const { skip, run } = partitionGatesForSkip(['unit', 'integration-ci', 'quality-gate'], marker);
  assert.deepEqual(skip, ['unit']);
  assert.deepEqual(run, ['integration-ci', 'quality-gate']);
});

// ── resolveSkippableGates (the wired skip decision) ───────────────────────────

function markerEntry(sha: string, hooks: string[]) {
  return { eventType: EVENT, eventData: JSON.stringify({ missionId: SLUG, sha, hooks }) };
}

function makeStep(overrides: { loadLatest?: () => Promise<unknown> | unknown; runPhaseGates?: () => Promise<unknown> } = {}) {
  const recorded: Array<{ missionId: string; sha: string; hooks: string[] }> = [];
  const step = createIntegrationGateStep({
    gates: {
      resolveIntegrationVerificationWorktree: () => '/fw',
      captureFinalIntegrationTree: () => ({ ok: true, rootDir: '/fw', commit: 'final', tree: 't' }),
      loadPhaseGates: () => [{ key: 'unit', command: 'u', order: 1 }, { key: 'integration-ci', command: 'i', order: 2 }],
      loadRequirePreIntegration: () => false,
      runPhaseGates: overrides.runPhaseGates
        ? overrides.runPhaseGates
        : async () => ({ ok: true, skipped: false, gates: [{ key: 'unit' }, { key: 'integration-ci' }], executed: 2 }),
    },
    landing: { createAbort: () => Object.assign(new Error('aborted'), { name: 'IntegrationAbort' }) },
    verification: { formatVerificationCommand: () => 'verify' },
  } as never);
  const operationalHistory = {
    async loadLatestByTypeForMission(type: string, missionId: string) {
      assert.equal(type, EVENT);
      assert.equal(missionId, SLUG);
      return overrides.loadLatest ? overrides.loadLatest() : null;
    },
    async recordIntegrationValidation(marker: { missionId: string; sha: string; hooks: string[] }) {
      recorded.push({ missionId: marker.missionId, sha: marker.sha, hooks: [...marker.hooks] });
    },
  } as unknown as OperationalHistoryService;
  return { step, operationalHistory, recorded };
}

test('resolveSkippableGates runs the full set when no marker exists (SC3 fallback)', async () => {
  const { step, operationalHistory } = makeStep();
  const { gates, skippedAll } = await step.resolveSkippableGates({
    configured: [{ key: 'unit' }, { key: 'integration-ci' }],
    slug: SLUG,
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
    finalizedCommit: 'current-sha',
    operationalHistory,
    log: () => {},
  });
  assert.equal(skippedAll, false);
  assert.deepEqual(gates.map(gate => gate.key), ['unit', 'integration-ci']);
});

// ── SC4 end-to-end: validated hooks skipped on integrate, fallback when absent ─

test('integrate skips validated hooks after a green bounce-verify and falls back when the marker is absent or the branch moved (SC4)', async () => {
  const configured = [{ key: 'unit' }, { key: 'integration-ci' }, { key: 'quality-gate' }];
  // (a) prior bounce-verify recorded a marker for the current validating sha -> skip the whitelisted hook
  const withMarker = makeStep({ loadLatest: () => markerEntry('validating-sha', ['unit', 'integration-ci']) });
  const skipped = await withMarker.step.resolveSkippableGates({
    configured, slug: SLUG, finalizedCommit: 'validating-sha', operationalHistory: withMarker.operationalHistory, log: () => {},
  });
  assert.deepEqual(skipped.gates.map(gate => gate.key), ['quality-gate'], 'only the unvalidated hook runs');
  // (b) marker absent -> fall back to the full suite
  const noMarker = makeStep();
  const fallback = await noMarker.step.resolveSkippableGates({
    configured, slug: SLUG, finalizedCommit: 'validating-sha', operationalHistory: noMarker.operationalHistory, log: () => {},
  });
  assert.deepEqual(fallback.gates.map(gate => gate.key), ['unit', 'integration-ci', 'quality-gate']);
  // (c) branch moved past the validating sha -> fall back to the full suite
  const moved = makeStep({ loadLatest: () => markerEntry('moved-past', ['unit']) });
  const movedResult = await moved.step.resolveSkippableGates({
    configured, slug: SLUG, finalizedCommit: 'current-sha', operationalHistory: moved.operationalHistory, log: () => {},
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
    slug: SLUG, finalizedCommit: 'fixsha', operationalHistory, log: () => {},
  });
  assert.deepEqual(sameTree.gates.map(gate => gate.key), ['quality-gate']);
  // A rebase that changes the integration tree yields a different finalized
  // commit. The skip must NOT apply: the whitelisted hooks ran against the old
  // tree, so the new tree runs the full suite (this is the round-2 F2 bypass).
  const rebasedTree = await step.resolveSkippableGates({
    configured: [{ key: 'unit' }, { key: 'integration-ci' }, { key: 'quality-gate' }],
    slug: SLUG, finalizedCommit: 'rebased-fixsha', operationalHistory, log: () => {},
  });
  assert.deepEqual(rebasedTree.gates.map(gate => gate.key), ['unit', 'integration-ci', 'quality-gate'], 'rebase-changed tree runs the full suite');
});

// ── SC1: the rebound green-validation path persists the skip marker ──────────

test('rebound verify rerun green records the skip marker keyed on the fix commit (SC1)', async () => {
  let recorded: { missionId: string; sha: string; hooks: string[] } | null = null;
  const route = await routeIntegrationGateFailure({
    slug: SLUG,
    missionWorktree: '/fw',
    failedGate: { key: 'integration-ci', command: 'int', exitCode: 1, stdout: '', stderr: '' },
    gates: [{ key: 'unit', command: 'u' }, { key: 'integration-ci', command: 'i' }],
    implementer: 'custom',
    repositoryId: 'unknown',
    // The kernel bounces the mission active, the implementer fixes, and the
    // verify seam re-runs the identical gate set green. Replaying context.verify()
    // drives the real verify seam (my injected runPhaseGatesFn + captureFinalTreeFn)
    // so the marker is recorded, then report the bounce fixed.
    runPhaseGatesFn: async () => ({ ok: true }),
    captureFinalTreeFn: () => ({ ok: true, rootDir: '/fw', commit: 'fixsha123', tree: 't' }),
    reboundFn: async (_reason, ctx) => { await (ctx as { verify: () => Promise<unknown> }).verify(); return { attempts: 1, outcome: 'fixed' }; },
    startAgent: async () => ({ status: 'completed' }),
    transitionTaskFn: async () => true,
    recordIntegrationValidationFn: async (input) => {
      recorded = { missionId: input.missionId, sha: input.sha, hooks: [...input.hooks] };
    },
  } as never);
  assert.equal(route.route, 'fixed', 'routing reports the bounce fixed');
  assert.ok(recorded, 'the rebound green-validation path persisted the skip marker');
  assert.equal(recorded!.missionId, SLUG);
  assert.equal(recorded!.sha, 'fixsha123', 'keyed on the fix commit, not the pre-rebase head');
  assert.deepEqual(recorded!.hooks.sort(), ['integration-ci', 'unit'], 'every validated hook is whitelisted');
});

test('rebound verify rerun green with no recording store leaves the full suite to run next time', async () => {
  const route = await routeIntegrationGateFailure({
    slug: SLUG,
    missionWorktree: '/fw',
    failedGate: { key: 'integration-ci', command: 'int', exitCode: 1, stdout: '', stderr: '' },
    gates: [{ key: 'unit', command: 'u' }, { key: 'integration-ci', command: 'i' }],
    implementer: 'custom',
    repositoryId: 'unknown',
    runPhaseGatesFn: async () => ({ ok: true }),
    captureFinalTreeFn: () => ({ ok: true, rootDir: '/fw', commit: 'fixsha123', tree: 't' }),
    // Replaying verify drives the real seam; with no recordIntegrationValidationFn
    // injected the seam short-circuits the record, so an unavailable store is inert.
    reboundFn: async (_reason, ctx) => { await (ctx as { verify: () => Promise<unknown> }).verify(); return { attempts: 1, outcome: 'fixed' }; },
  } as never);
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

test('runRequiredLocalGates does not record when the suite fails', async () => {
  const { step, operationalHistory, recorded } = makeStep({
    runPhaseGates: async () => ({ ok: false, skipped: false, failedGate: { key: 'unit' }, error: 'red' }),
  });
  const previous = setLogger({ log: () => {}, error: () => {} });
  try {
    await assert.rejects(
      step.runRequiredLocalGates({
        slug: SLUG,
        context: { missionHeadSha: 'validating-sha', baseWorktree: '/fw', area: 'all', branch: `mission/${SLUG}` },
        missionLoad: { kind: 'found', mission: { status: 'integration', review: null } },
        missionServices: { operationalHistory },
        dryRun: false,
        noIntegrationGates: false,
        realAgent: null,
        realAgentModel: null,
        seams: {
          transitionTaskFn: async () => true,
          startAgentFn: async () => { throw new Error('no launch'); },
          applyAgentFallbackFn: async () => 'custom',
          routeIntegrationGateFailureFn: async () => Object.assign(new Error('red gate'), { name: 'IntegrationAbort' }),
        } as never,
      }),
      (error: Error) => error.name === 'IntegrationAbort',
    );
    assert.equal(recorded.length, 0, 'no marker recorded on a red suite');
  } finally { setLogger(previous); }
});
