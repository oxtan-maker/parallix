import { fixtureMission, approvedReview, inMemoryTransitionStore } from '../../../fixtures/mission-builders.js';
import { missionVersion } from '../../../../src/application/domain-ports.js';
import { agentFamily } from '../../../../src/domain/agents.js';
import type { Review, ReviewEventRecord } from '../../../../src/domain/review.js';
import { integrationServices } from '../../../helpers/stub-integration-services.js';
import { integrationContext } from '../../../fixtures/integration-context.js';
import { forgejoApiFixture } from '../../../fixtures/forgejo-api.js';
// TASK-2587: provider approval identity must be configured independently from authentication.
import test from 'node:test';
import assert from 'node:assert/strict';
import { getLatestReviewDecision } from '../../../../src/adapters/forgejo/forgejo.js';
import { approveEligibleIntegrationShortcut, evaluateTaskStatusForIntegration, recoveryEstablishesApproval } from '../../../../src/application/integrate/approval.js';
import { recoverMissionForIntegration } from '../../../../src/adapters/cli/commands/integrate.js';
import { changeRevision, reviewApprovalOwed } from '../../../../src/domain/review.js';
import { stubIntegrateWorkflowPorts } from '../../../helpers/stub-integrate-workflow-ports.js';
import { MissionLifecycleService } from '../../../../src/application/mission-lifecycle-service.js';
import { recordApproval } from '../../../../src/adapters/review/review-round.js';
import { reviewStatistics } from '../../../../src/application/services/review-statistics.js';

const startedAt = '2026-09-27T10:00:00Z';
const approvedAt = '2026-09-27T10:30:00Z';
function decision(reviews: readonly unknown[], sinceIso = startedAt) {
  return getLatestReviewDecision('mission/task-2587', {
    token: 'test-token', forgejoUser: 'magnus', reviewerUser: 'codex',
    authorizedApproverUser: 'magnus', sinceIso,
    apiCall: forgejoApiFixture((_method: string, apiPath: string) => apiPath.includes('/pulls?state=')
      ? { ok: true, data: [{ number: 2587, head: { ref: 'mission/task-2587' } }] }
      : apiPath === '/pulls/2587/reviews' ? { ok: true, data: reviews } : { ok: false }),
  });
}

test('task-2587: configured operator magnus approves despite default alias human and reviewer codex', () => {
  const approval = decision([{ state: 'APPROVED', submitted_at: approvedAt, user: { login: 'magnus' } }]);
  assert.equal(approval.defaultUserApproved, false);
  assert.equal(approval.reviewerApproved, false);
  assert.equal(approval.operatorApproved, true);
  assert.equal(approval.operatorApprovedAt, approvedAt);
  assert.deepEqual(recoveryEstablishesApproval(integrationContext({ missionStatus: 'active', approval })), {
    established: true, via: 'human-override', decidedAt: approvedAt, reason: '',
  });
});

test('task-2587: authentication alone, unauthorized, withdrawn, and stale approvals cannot recover', () => {
  const cases = [
    decision([]),
    decision([{ state: 'APPROVED', submitted_at: approvedAt, user: { login: 'gemini' } }]),
    decision([{ state: 'APPROVED', submitted_at: approvedAt, user: { login: 'magnus' } }, { state: 'REQUEST_CHANGES', submitted_at: '2026-09-27T11:00:00Z', user: { login: 'magnus' } }]),
    decision([{ state: 'APPROVED', submitted_at: approvedAt, user: { login: 'magnus' } }], '2026-09-27T11:00:00Z'),
  ];
  for (const approval of cases) {
    assert.notEqual(approval.operatorApproved, true);
    assert.equal(recoveryEstablishesApproval(integrationContext({ missionStatus: 'active', approval })).established, false);
  }
});

test('task-2587: active provider-approved Mission reaches integration through lifecycle recovery', async () => {
  const approval = decision([{ state: 'APPROVED', submitted_at: approvedAt, user: { login: 'magnus' } }]);
  let mission = fixtureMission('task-2587', { status: 'active', assignee: agentFamily('codex'), review: approvedReview('task-2587', { startedAt, decidedAt: approvedAt }) });
  let version = missionVersion(1);
  const store = { load: async () => ({ kind: 'found' as const, mission, version }), save: async () => { throw new Error('Unexpected recovery save'); } } satisfies import("../../../../src/application/domain-ports.js").MissionStore;
  const lifecycle = { transition: async (request) => {
    mission = { ...mission, status: request.command.type === 'submit-for-review' ? 'review' : 'integration', closedAt: null };
    version = missionVersion(version + 1);
    return { durableEvidence: [],  status: 'completed' as const };
  } } satisfies Pick<import("../../../../src/application/mission-lifecycle-service.js").MissionLifecycleService, "transition">;
  const result = await recoverMissionForIntegration(integrationContext({ slug: 'task-2587', approval }), { missionServices: integrationServices({ store, lifecycle }) });
  assert.deepEqual(result, { recovered: true, status: 'integration', occurredAt: approvedAt });
});

test('assigned-reviewer provider approval keeps the existing active-lane recovery path (TASK-2859.16 review)', async () => {
  const approval = decision([{ state: 'APPROVED', submitted_at: approvedAt, user: { login: 'codex' } }]);
  assert.equal(approval.reviewerApproved, true);
  const reviewed = shortcutMission('task-2859-reviewer-approved');
  const reviewedAt = reviewed.review?.rounds[0]?.decision?.decidedAt;
  assert.ok(reviewedAt);
  const initial = fixtureMission('task-2859-reviewer-approved', {
    status: 'active', assignee: agentFamily('codex'), review: reviewed.review,
  });
  const store = inMemoryTransitionStore(initial);
  const services = integrationServices({ store, lifecycle: new MissionLifecycleService(store) });
  let shortcutSubmissions = 0;
  const context = integrationContext({ slug: 'task-2859-reviewer-approved', missionStatus: 'active',
    missionReview: initial.review, approval });
  await approveEligibleIntegrationShortcut(context, await store.load(initial.id), services,
    shortcutPorts({ review: { submitApproval: async () => { shortcutSubmissions++; return { ok: true }; } } }));
  assert.equal(shortcutSubmissions, 0, 'standing provider authority must not be replaced by the shortcut');
  assert.equal((await store.load(initial.id)).mission.status, 'active');
  assert.deepEqual(await recoverMissionForIntegration(context, { missionServices: services }),
    { recovered: true, status: 'integration', occurredAt: reviewedAt });
});

test('task-2587: provider approval fulfils a historical approval-owed blocker without deleting it', () => {
  const base = approvedReview('task-2587', { startedAt, decidedAt: approvedAt });
  const event: ReviewEventRecord = { position: 0, eventType: 'implementer_disposition', roundNumber: 2, phase: 'fixing', actor: 'codex', content: '', disposition: 'PARKED', verdict: null, itemDispositions: null, blockedReason: 'external-formal-approval-owed', followUpReference: null, createdAt: startedAt };
  const review: Review = { ...base, rounds: [{ ...base.rounds[0], number: 2, decision: { kind: 'approved', comment: null, decidedAt: approvedAt, source: { kind: 'provider', provider: 'forgejo' } } }], reviewEvents: [event] };
  assert.equal(reviewApprovalOwed(review), false);
  assert.equal(review.reviewEvents.length, 1, 'the historical blocker event remains in the audit trail');
});

test('task-2587: dry-run prediction reports the same missing provider approval that recovery refuses', () => {
  const approval = decision([]);
  const missionReview = approvedReview('task-2587', { startedAt, decidedAt: approvedAt });
  assert.equal(recoveryEstablishesApproval(integrationContext({ missionStatus: 'active', missionReview, approval })).established, false);
  const check = evaluateTaskStatusForIntegration(integrationContext({ missionStatus: 'active', missionReview, approval }), {
    toVirtual: (value: string) => value,
    toActual: (value: string) => value,
  });
  assert.equal(check.ok, false);
  assert.match(check.message, /stored approval without the required qualifying provider approval/);
});

test('integration dry-run rejects active unapproved work and accepts integration without mutation (TASK-2673)', () => {
  const stateMap = { toVirtual: (value: string) => value, toActual: (value: string) => value };
  for (const status of ['active', 'integration'] as const) {
    const context = integrationContext({ missionStatus: status, missionReview: null, approval: decision([]) });
    const before = structuredClone(context);
    assert.equal(evaluateTaskStatusForIntegration(context, stateMap).ok, status === 'integration');
    assert.equal(recoveryEstablishesApproval(context).established, status === 'integration');
    assert.deepEqual(context, before, 'dry-run authority is read-only');
  }
});

const shortcutHead = 'a'.repeat(40);
const shortcutGate = { key: 'unit', command: 'npm test -- --unit', order: 1 };

function shortcutMission(slug = 'task-2859.16') {
  const base = approvedReview(slug);
  const round = base.rounds[0];
  return fixtureMission(slug, { status: 'review', assignee: agentFamily('codex'), review: { ...base, rounds: [{
    ...round, subject: { ...round.subject, revision: changeRevision(shortcutHead) },
    decision: round.decision?.kind === 'approved' ? { ...round.decision, revision: changeRevision(shortcutHead) } : round.decision,
  }] } });
}

function shortcutMissionAtDecision(slug: string, revision: string) {
  const initial = shortcutMission(slug);
  const round = initial.review!.rounds[0];
  return { ...initial, review: { ...initial.review!, rounds: [{ ...round,
    decision: round.decision?.kind === 'approved'
      ? { ...round.decision, revision: changeRevision(revision) }
      : round.decision,
  }] } } as typeof initial;
}

function shortcutPorts(overrides: Parameters<typeof stubIntegrateWorkflowPorts>[0] = {}) {
  return stubIntegrateWorkflowPorts({
    gates: {
      resolveIntegrationVerificationWorktree: () => '/fixture/mission',
      captureFinalIntegrationTree: () => ({ ok: true, commit: shortcutHead }),
      loadPhaseGates: () => [shortcutGate],
      readGateRun: () => ({ gateRunId: 'gate-run-1', revision: shortcutHead, status: 'passed', current: true,
        carried: null, gates: [shortcutGate], outcomes: [{ ...shortcutGate, exitCode: 0 }] }),
      ...overrides.gates,
    },
    landing: { createAbort: () => new Error('integration aborted'), ...overrides.landing },
    process: { ...overrides.process },
    review: { ...overrides.review },
  });
}

test('eligible integrate records one local human approval transition and preserves the agent statistics (TASK-2859.16)', async () => {
  const initial = shortcutMission();
  const store = inMemoryTransitionStore(initial);
  const lifecycle = new MissionLifecycleService(store);
  const services = integrationServices({ store, lifecycle });
  let submissions = 0;
  const ports = shortcutPorts({ review: { submitApproval: async (slug, _message, options) => {
    submissions++;
    const result = await recordApproval(slug, { comment: 'Integrated by human', revision: options.revision,
      decidedAt: '2026-11-19T11:00:00Z', source: { kind: 'local' } },
    { missionStore: options.missionServices.store, lifecycleService: options.missionServices.lifecycle });
    return result.outcome === 'failed' ? { ok: false, diagnostic: result.diagnostic } : { ok: true };
  } } });
  const context = integrationContext({ slug: 'task-2859.16', missionStatus: 'review', missionReview: initial.review,
    approval: { ok: false, error: 'forgejo-off' } });
  const before = reviewStatistics(initial.review!);
  const loaded = await store.load(initial.id);
  await approveEligibleIntegrationShortcut(context, loaded, services, ports);
  const integrated = await store.load(initial.id);
  assert.equal(integrated.mission.status, 'integration');
  assert.equal(context.missionStatus, 'integration');
  assert.equal(context.promoteBacklogOnCloseout, true,
    'the review-to-integration shortcut retains the delayed Backlog approval promotion');
  assert.equal(submissions, 1);
  assert.equal(store.events.length, 1, 'approval and lifecycle use the existing atomic transition writer once');
  assert.deepEqual(reviewStatistics(integrated.mission.review!), before,
    'the shortcut replays the standing agent decision instead of adding an approval statistic');
  await approveEligibleIntegrationShortcut(context, integrated, services, ports);
  assert.equal(submissions, 1, 'a replayed integrate cannot submit a second approval');
  assert.equal(store.events.length, 1, 'a replayed integrate cannot write a second lifecycle transition');
});

test('shortcut submits the exact tested revision and provider refusal leaves no local approval (TASK-2859.16)', async () => {
  const initial = shortcutMission('task-2859-provider');
  const store = inMemoryTransitionStore(initial);
  const services = integrationServices({ store, lifecycle: new MissionLifecycleService(store) });
  let submittedRevision: string | null = null;
  const ports = shortcutPorts({ review: { submitApproval: async (_slug, _message, options) => {
    submittedRevision = options.revision;
    return { ok: false, diagnostic: 'missing Forgejo token or pull request' };
  } } });
  const context = integrationContext({ slug: 'task-2859-provider', missionStatus: 'review', missionReview: initial.review,
    approval: { ok: true, reviewerApproved: false } });
  await assert.rejects(approveEligibleIntegrationShortcut(context, await store.load(initial.id), services, ports),
    /integration aborted/);
  assert.equal(submittedRevision, shortcutHead);
  assert.equal((await store.load(initial.id)).mission.status, 'review');
  assert.equal(store.events.length, 0, 'provider failure cannot leave local approval authority');
});

test('recognised post-review bookkeeping preserves shortcut approval coverage (TASK-2859.16 repair)', async () => {
  const initial = shortcutMissionAtDecision('task-2859-bookkeeping', 'b'.repeat(40));
  const store = inMemoryTransitionStore(initial);
  const services = integrationServices({ store, lifecycle: new MissionLifecycleService(store) });
  let submissions = 0;
  let submittedRevision: string | null = null;
  let replayedRevision: string | null = null;
  const ports = shortcutPorts({
    gates: { approvalCoverage: () => ({ kind: 'covers', round: 1, approvedRevision: changeRevision('b'.repeat(40)) }) },
    review: { submitApproval: async (slug, _message, options) => {
      submissions++;
      submittedRevision = options.revision;
      replayedRevision = options.reviewedRevision;
      const result = await recordApproval(slug, { comment: 'Covered bookkeeping', revision: options.reviewedRevision,
        decidedAt: '2026-11-19T11:00:00Z', source: { kind: 'local' } },
      { missionStore: options.missionServices.store, lifecycleService: options.missionServices.lifecycle });
      return result.outcome === 'failed' ? { ok: false, diagnostic: result.diagnostic } : { ok: true };
    } },
  });
  const context = integrationContext({ slug: 'task-2859-bookkeeping', missionStatus: 'review', missionReview: initial.review });
  await approveEligibleIntegrationShortcut(context, await store.load(initial.id), services, ports);
  assert.equal(submissions, 1);
  assert.equal(submittedRevision, shortcutHead, 'external providers receive the current tested head');
  assert.equal(replayedRevision, 'b'.repeat(40), 'local state replays the revision already covered by review');
  assert.equal((await store.load(initial.id)).mission.status, 'integration');
});

test('shortcut refuses stale agent or test evidence before approval submission (TASK-2859.16)', async () => {
  for (const [name, gates, expected] of [
    ['stale agent', {}, /agent review does not approve the current revision/],
    ['stale tests', { readGateRun: () => ({ gateRunId: 'old', revision: shortcutHead, status: 'passed' as const,
      current: false, carried: null, gates: [shortcutGate], outcomes: [{ ...shortcutGate, exitCode: 0 }] }) },
    /no complete current passing integration-test action/],
  ] as const) {
    const slug = `task-2859-${name.replace(' ', '-')}`;
    const initial = name === 'stale agent' ? shortcutMissionAtDecision(slug, 'b'.repeat(40)) : shortcutMission(slug);
    const store = inMemoryTransitionStore(initial);
    let submissions = 0;
    const errors: string[] = [], original = console.error;
    console.error = (...values: unknown[]) => { errors.push(values.join(' ')); };
    try {
      await assert.rejects(approveEligibleIntegrationShortcut(
        integrationContext({ slug: String(initial.id), missionStatus: 'review', missionReview: initial.review }),
        await store.load(initial.id), integrationServices({ store, lifecycle: new MissionLifecycleService(store) }),
        shortcutPorts({ gates, review: { submitApproval: async () => { submissions++; return { ok: true }; } } }),
      ), /integration aborted/);
    } finally { console.error = original; }
    assert.match(errors.join('\n'), expected);
    assert.equal(submissions, 0);
    assert.equal(store.events.length, 0);
  }
});

test('shortcut preserves the finalized-tree failure instead of requesting another review (TASK-2859.16)', async () => {
  const initial = shortcutMission('task-2859-dirty-tree');
  const store = inMemoryTransitionStore(initial);
  let submissions = 0;
  const errors: string[] = [], original = console.error;
  console.error = (...values: unknown[]) => { errors.push(values.join(' ')); };
  try {
    await assert.rejects(approveEligibleIntegrationShortcut(
      integrationContext({ slug: 'task-2859-dirty-tree', missionStatus: 'review', missionReview: initial.review }),
      await store.load(initial.id),
      integrationServices({ store, lifecycle: new MissionLifecycleService(store) }),
      shortcutPorts({
        gates: { captureFinalIntegrationTree: () => ({ ok: false,
          error: 'selected execution root is not finalized (dirty tree): /fixture/mission' }) },
        review: { submitApproval: async () => { submissions++; return { ok: true }; } },
      }),
    ), /integration aborted/);
  } finally { console.error = original; }
  assert.match(errors.join('\n'), /selected execution root is not finalized \(dirty tree\): \/fixture\/mission/);
  assert.doesNotMatch(errors.join('\n'), /Run px review/);
  assert.equal(submissions, 0);
  assert.equal(store.events.length, 0);
});

test('provider-disabled dry-run reports shortcut validation instead of claiming recovery parity (TASK-2859.16 review)', () => {
  const initial = shortcutMission('task-2859-dry-run');
  const result = evaluateTaskStatusForIntegration(integrationContext({
    slug: 'task-2859-dry-run', missionStatus: 'review', missionReview: initial.review,
    approval: { ok: true, reviewState: 'APPROVED', source: 'mission-store', providerDisabled: true },
  }), { toVirtual: value => value, toActual: value => value });
  assert.equal(result.ok, true);
  assert.match(result.message, /verify.*agent approval.*integration-test action/i);
  assert.doesNotMatch(result.message, /recovery would move the Mission to integration/);
});

test('shortcut refusal names gate configuration when no test action can be recorded (TASK-2859.16 review)', async () => {
  const initial = shortcutMission('task-2859-no-gates');
  const store = inMemoryTransitionStore(initial);
  const errors: string[] = [], original = console.error;
  console.error = (...values: unknown[]) => { errors.push(values.join(' ')); };
  try {
    await assert.rejects(approveEligibleIntegrationShortcut(
      integrationContext({ slug: 'task-2859-no-gates', missionStatus: 'review', missionReview: initial.review }),
      await store.load(initial.id), integrationServices({ store, lifecycle: new MissionLifecycleService(store) }),
      shortcutPorts({ gates: { loadPhaseGates: () => [] } }),
    ), /integration aborted/);
  } finally { console.error = original; }
  assert.match(errors.join('\n'), /no preIntegration gates are configured/);
  assert.match(errors.join('\n'), /configure at least one preIntegration gate/i);
  assert.doesNotMatch(errors.join('\n'), /--dry-run to produce current test evidence/);
  assert.equal(store.events.length, 0);
});

test('the existing integration claim serializes concurrent shortcut approval writes (TASK-2859.16)', { timeout: 400 }, async () => {
  const initial = shortcutMission('task-2859-concurrent');
  const store = inMemoryTransitionStore(initial);
  const lifecycle = new MissionLifecycleService(store);
  const services = integrationServices({ store, lifecycle });
  let held = false, submissions = 0, unblock!: () => void, entered!: () => void;
  const blocked = new Promise<void>(resolve => { unblock = resolve; });
  const submissionEntered = new Promise<void>(resolve => { entered = resolve; });
  const ports = shortcutPorts({
    process: { claimIntegration: async () => {
      if (held) { return null; }
      held = true;
      return async () => { held = false; };
    } },
    review: { submitApproval: async (slug, _message, options) => {
      submissions++;
      entered();
      await blocked;
      const result = await recordApproval(slug, { comment: 'Integrated once', revision: options.revision,
        decidedAt: '2026-11-19T11:00:00Z', source: { kind: 'local' } },
      { missionStore: options.missionServices.store, lifecycleService: options.missionServices.lifecycle });
      return result.outcome === 'failed' ? { ok: false, diagnostic: result.diagnostic } : { ok: true };
    } },
  });
  const run = async () => {
    const release = await ports.process.claimIntegration('task-2859-concurrent');
    if (!release) { return 'owned'; }
    try {
      const loaded = await store.load(initial.id);
      await approveEligibleIntegrationShortcut(
        integrationContext({ slug: 'task-2859-concurrent', missionStatus: loaded.mission.status,
          missionReview: loaded.mission.review }), loaded, services, ports);
      return 'completed';
    } finally { await release(); }
  };
  const first = run();
  await submissionEntered;
  assert.equal(await run(), 'owned');
  unblock();
  assert.equal(await first, 'completed');
  assert.equal(submissions, 1);
  assert.equal(store.events.length, 1);
});
