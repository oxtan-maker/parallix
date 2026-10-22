import type { ReviewedRevision, Review } from '../../../../src/domain/review.js';
import { agentFamily as fixtureAgentFamily } from '../../../../src/domain/agents.js';
import { reviewLoopReporter } from '../../../../src/adapters/review/review-loop-presentation.js';
// reviewer independence contract.
// Related scenarios share imports; each contract keeps its own hooks and mutable fixtures.
import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  ConfiguredReviewerEligibility,
  beginNextReviewRound,
  changeRevision,
  startReview,
} from '../../../../src/domain/review.js';
import { AgentPoolExhaustedError } from '../../../../src/domain/agents.js';
import { resolveHandoffReviewAssignment } from '../../../../src/adapters/cli/commands/handoff.js';
import { selectReviewer } from '../../../../src/application/review-loop/reviewer-selection.js';
import { postWorkflowReview } from '../../../../src/adapters/review/review-artifacts.js';
import { renderStatus } from '../../../../src/interfaces/cli/status.js';
import { fixtureMission, inMemoryTransitionStore } from '../../../fixtures/mission-builders.js';
import { MissionLifecycleService } from '../../../../src/application/mission-lifecycle-service.js';
import { ReviewState } from '../../../../src/adapters/review/review-state.js';
import { consumeReviewerArtifacts } from '../../../../src/adapters/review/review-artifacts.js';

// Regression provenance: TASK-2339.
describe("self review forbidden", { concurrency: false }, () => {
  const SUBJECT: ReviewedRevision = {
    change: { kind: 'local-branch', sourceBranch: 'mission/task-9001', targetBranch: 'main' },
    revision: changeRevision('handoff-1'),
  };
  const STARTED_AT = '2026-08-04T09:00:00.000Z';

  function eligibility(families: string[]) {
    return ConfiguredReviewerEligibility.fromReviewStep({ eligible: families.map(fixtureAgentFamily), strategy: 'random' });
  }

  // ---------------------------------------------------------------------------
  // Domain rule
  // ---------------------------------------------------------------------------

  test('startReview rejects a reviewer who is the implementer while other families are eligible', () => {
    assert.throws(
      () => startReview(SUBJECT, fixtureAgentFamily('claude'), fixtureAgentFamily('claude'), STARTED_AT, eligibility(['codex', 'claude', 'custom', 'vibe'])),
      /may not review its own work/,
    );
  });

  test('startReview allows self-review only when the implementer is the sole eligible family', () => {
    const review = startReview(SUBJECT, fixtureAgentFamily('claude'), fixtureAgentFamily('claude'), STARTED_AT, eligibility(['claude']));
    assert.equal(review.rounds[0].reviewer, 'claude');
    assert.equal(review.rounds[0].implementer, 'claude');
  });

  test('beginNextReviewRound rejects a self-reviewing round the same way', () => {
    const readyForNextRound: Review = {
      rounds: [{
        number: 1,
        subject: SUBJECT,
        reviewer: fixtureAgentFamily('codex'),
        implementer: fixtureAgentFamily('claude'),
        startedAt: STARTED_AT,
        decision: { kind: 'changes-requested', decidedAt: STARTED_AT, comment: null, findings: [] },
        response: { kind: 'resolved', resolutions: [], resultingRevision: changeRevision('handoff-2'), respondedAt: STARTED_AT },
        phase: 'fixing',
        disposition: 'CHANGES_MADE',
        reviewerRetryCount: 0,
        implementerRetryCount: 0,
      }],
      intervention: null,
      stageLaunches: [],
      reviewEvents: [],
    };

    assert.throws(
      () => beginNextReviewRound(readyForNextRound, fixtureAgentFamily('claude'), fixtureAgentFamily('claude'), STARTED_AT, eligibility(['codex', 'claude'])),
      /may not review its own work/,
    );
  });

  // ---------------------------------------------------------------------------
  // Handoff assignment
  // ---------------------------------------------------------------------------

  function assignment(overrides: Record<string, unknown> = {}) {
    const logged: string[] = [];
    const result = resolveHandoffReviewAssignment('claude', {
      worktree: '/does/not/matter',
      eligibleAgentsForStepFn: () => ['codex', 'claude', 'custom', 'vibe'],
      log: (msg: string) => logged.push(msg),
      ...overrides,
    });
    return { result, logged };
  }

  test('handoff assigns a reviewer from another family when one is available', () => {
    const { result, logged } = assignment({ selectAgentFn: () => 'custom' });
    assert.equal(result.reviewer, 'custom');
    assert.equal(result.implementer, 'claude');
    assert.deepEqual([...result.reviewerEligibility.reviewers], ['codex', 'claude', 'custom', 'vibe']);
    assert.deepEqual(logged, []);
  });

  test('handoff falls back to self-review only on typed reviewer-pool exhaustion regardless of diagnostic wording, and records that eligibility (TASK-2668.04)', () => {
    const { result, logged } = assignment({
      selectAgentFn: () => {
        throw new AgentPoolExhaustedError('review', 'routing diagnostics were revised');
      },
    });

    assert.equal(result.reviewer, 'claude');
    // The recorded eligibility is the one that actually applied. Keeping the
    // four-family policy here is what let a self-reviewed round look legitimate.
    assert.deepEqual([...result.reviewerEligibility.reviewers], ['claude']);
    assert.match(logged.join('\n'), /falling back to self-review/i);
    assert.doesNotThrow(() => startReview(SUBJECT, result.reviewer, result.implementer, STARTED_AT, result.reviewerEligibility));
  });

  test('handoff propagates a misconfigured selector instead of reviewing its own work', () => {
    assert.throws(
      () => assignment({
        selectAgentFn: () => {
          throw new Error('No eligible agents have a working launcher for step "review".');
        },
      }),
      /No eligible agents have a working launcher/,
    );
  });

  test('handoff propagates an unreadable agent policy instead of reviewing its own work', () => {
    assert.throws(
      () => assignment({
        selectAgentFn: () => { throw new Error('Invalid agent config: unexpected token'); },
      }),
      /Invalid agent config/,
    );
  });
});

// Regression provenance: TASK-2384.
describe("reviewer self review approval owed", { concurrency: false }, () => {
  test('exhausted reviewer pool launches the PR author, retains its verdict, and marks formal approval owed', async () => {
    const selectionLogs: string[] = [];
    const selected = selectReviewer({
      implementer: 'custom',
      isContinue: false,
      persisted: null,
      maxAttempts: 1,
      dryRun: false,
      providerEnabled: true,
      slug: 'task-2384',
    }, {
      eligibleFamilies: () => ['custom', 'claude', 'codex'],
      nominate: () => { throw new Error('No agents available'); },
      launcherStatus: (agent: string) => ({
        supported: agent === 'custom',
        detail: agent === 'claude' ? 'blocked: stale session' : 'launcher unavailable: review sandbox',
      }),
      runtimeMatrix: () => [],
    }, reviewLoopReporter({ log: (message: string) => selectionLogs.push(message), error: () => {} }));

    assert.equal(selected?.reviewer, 'custom', 'the single-family escape hatch must still select the author');
    assert.ok(
      selectionLogs.some((message) => /PR author|external formal approval/i.test(message)),
      `selection must announce the approval requirement before launch: ${selectionLogs.join(' | ')}`,
    );
    assert.ok(
      selectionLogs.some((message) => /claude: blocked: stale session.*codex: launcher unavailable: review sandbox/i.test(message)),
      `fallback diagnostics must name every unavailable family and reason: ${selectionLogs.join(' | ')}`,
    );

    let writtenState: { value: import('../../../../src/application/ports/review-persistence.js').ReviewStateData | null } = { value: null };
    const events: { type: string; params: unknown; }[] = [];
    const outcome = await postWorkflowReview('task-2384', 'approve', 'looks good', {
      reviewIdentity: 'custom',
      readTokenFn: () => 'token',
      getPrAuthorFn: () => 'custom',
      postReviewFn: () => { throw new Error('self approval must not reach Forgejo'); },
      readReviewStateFn: () => ({ mission: 'task-2384', reviewer: 'custom', implementer: 'custom' }),
      writeReviewStateFn: async (_slug: string, state) => {
        writtenState.value = state;
        return { outcome: 'committed' as const };
      },
      createEventFn: (_slug: string, type: string, params: unknown) => {
        events.push({ type, params });
        return { ok: true as const, path: '/mock' };
      },
      buildMetadataFooterFn: () => '',
      log: () => {},
      error: () => {},
    });

    assert.equal(outcome.skipped, true);
    assert.ok(writtenState.value);
    assert.equal(outcome.ok, true);
    assert.equal(writtenState.value.disposition, 'APPROVED', 'single-family local approval is allowed by corrected SC9 (TASK-2778)');
    assert.equal(writtenState.value.metadata?.approvalOwed, true, 'self-review must persist that external formal approval is owed');
    assert.deepEqual(events, [{
      type: 'reviewer_outcome',
      params: { verdict: 'approve', content: 'Single-family self-author verdict: approve', blockedReason: 'external-formal-approval-owed' },
    }], 'the local aggregate event must durably identify the approval-owed outcome');

    const statusLines: string[] = [];
    renderStatus({
      branch: 'mission/task-2384', worktree: '/tmp/task-2384', rebaseInfo: null, slug: 'task-2384',
      missionData: {
        backlogStatus: 'review', reviewPhase: 'approved', reviewRound: 1, reviewDisposition: 'APPROVED',
        approvalOwed: true,
        reviewHistory: [],
      },
      prInfo: { exists: true, number: 2384, state: 'open' }, staleWorktrees: [], staleWorktreeRebase: {},
      agents: [], lastThreeCommits: [], uncommittedCount: 0,
    }, (message) => statusLines.push(message));
    assert.ok(
      statusLines.some((message) => /approval owed|external formal approval/i.test(message)),
      `px status must expose the approval requirement: ${statusLines.join(' | ')}`,
    );
  });
});

test('PR 739 drift cannot grant a self-author local Mission approval (TASK-2778 F2)', async () => {
  const slug = 'task-2778';
  const review = startReview({ change: { kind: 'pull-request', provider: 'forgejo', id: '739', url: null,
    sourceBranch: `mission/${slug}`, targetBranch: 'main' }, revision: changeRevision('head') },
  fixtureAgentFamily('claude'), fixtureAgentFamily('codex'), '2026-10-19T10:00:00Z',
  ConfiguredReviewerEligibility.fromReviewStep({ eligible: [fixtureAgentFamily('claude')], strategy: 'random' }));
  const store = inMemoryTransitionStore(fixtureMission(slug, { status: 'review', assignee: fixtureAgentFamily('claude'), review }));
  const lifecycle = new MissionLifecycleService(store);
  const result = await postWorkflowReview(slug, 'approve', 'looks good', {
    worktree: '/fixture', revision: 'head', reviewIdentity: 'claude', missionStore: store, lifecycleService: lifecycle,
    readTokenFn: () => 'claude-token', getPrAuthorFn: () => 'claude',
    postReviewFn: () => assert.fail('self approval must not reach provider'),
    readReviewStateFn: async () => ReviewState.from(slug, { reviewer: 'claude', implementer: 'codex', round: 1, phase: 'reviewing' }),
    writeReviewStateFn: async (_slug, state) => new ReviewState(_slug, state).save('/fixture', { missionStore: store, lifecycleService: lifecycle }),
    createEventFn: () => ({ ok: true, path: null }), log: () => {}, error: () => {},
  });
  assert.equal(result.skipped, true);
  assert.equal(store.mission().status, 'review');
  assert.equal(store.mission().review!.rounds.at(-1)!.decision, null);
  assert.equal(store.events.length, 0, 'no integration transition');
});

for (const { author, reviewer, implementer } of [
  { author: 'claude', reviewer: 'claude', implementer: 'codex' },
  { author: 'codex', reviewer: 'claude', implementer: 'codex' },
  // TASK-2804: original author is advisory after reassignment; a third reviewer can approve.
  { author: 'codex', reviewer: 'codex', implementer: 'claude' },
  { author: 'codex', reviewer: 'custom', implementer: 'claude' },
]) {
  test(`provider verdict by ${reviewer} for ${implementer} with PR author ${author} requires independent approval before local authority (TASK-2778 F2)`, async () => {
    const slug = 'task-2778';
    const review = startReview({ change: { kind: 'local-branch', sourceBranch: `mission/${slug}`, targetBranch: 'main' }, revision: changeRevision('head') },
      fixtureAgentFamily(reviewer), fixtureAgentFamily(implementer), '2026-10-19T10:00:00Z',
      ConfiguredReviewerEligibility.fromReviewStep({ eligible: [fixtureAgentFamily(reviewer)], strategy: 'random' }));
    const store = inMemoryTransitionStore(fixtureMission(slug, { status: 'review', assignee: fixtureAgentFamily(implementer), review }));
    const lifecycle = new MissionLifecycleService(store);
    let posts = 0;
    const result = await consumeReviewerArtifacts(slug, reviewer, {
      worktree: '/fixture', revision: 'head', expectedVersion: 1, providerEnabled: true,
      output: { verdict: 'approve', findings: [], comment: 'looks good' }, missionStore: store, lifecycleService: lifecycle,
      readTokenFn: () => `${reviewer}-token`, getPrAuthorFn: () => author, getCommentsFn: async () => [],
      postCommentFn: () => ({ ok: true, status: 0, statusCode: 200, stderr: null, data: null, error: null }), postReviewFn: () => {
        assert.equal(store.mission().review!.rounds.at(-1)!.decision, null, 'POST precedes approval');
        posts++; return { ok: true, status: 0, statusCode: 200, stderr: null, data: null, error: null };
      },
      readReviewStateFn: async () => new ReviewState(slug, { reviewer, implementer, round: 1, phase: 'reviewing' }),
      writeReviewStateFn: async (_slug, state) => new ReviewState(_slug, state).save('/fixture', { missionStore: store, lifecycleService: lifecycle }),
      createEventFn: () => ({ ok: true, path: null }), buildMetadataFooterFn: () => '', log: () => {}, error: () => {},
    });
    assert.equal(result.ok, author !== reviewer, result.diagnostic ?? '');
    assert.equal(posts, author === reviewer ? 0 : 1);
    assert.equal(store.mission().status, author === reviewer ? 'review' : 'integration');
    assert.equal(store.mission().review!.rounds.at(-1)!.decision?.kind ?? null, author === reviewer ? null : 'approved');
    assert.equal(store.mission().assignee, implementer);
    assert.equal(store.mission().review!.rounds.at(-1)!.implementer, implementer);
    if (author === reviewer) assert.equal(store.events.length, 0, 'original author cannot authorize integration');
    if (author !== reviewer) {
      const decision = store.mission().review!.rounds.at(-1)!.decision;
      assert.ok(decision?.kind === 'approved');
      assert.equal(decision.source.kind, 'provider');
    }
  });
}
