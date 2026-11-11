import type { ReviewedRevision, Review } from '../../../../src/domain/review.js';
import { agentFamily as fixtureAgentFamily } from '../../../../src/domain/agents.js';
import { reviewLoopReporter } from '../../../../src/adapters/review/review-loop-presentation.js';
// reviewer independence contract.
// Related scenarios share imports; each contract keeps its own hooks and mutable fixtures.
import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  ConfiguredReviewerEligibility,
  applyReviewerCommand,
  beginNextReviewRound,
  changeRevision,
  currentReviewRound,
  reviewFindingId,
  startReview,
} from '../../../../src/domain/review.js';
import { AgentPoolExhaustedError } from '../../../../src/domain/agents.js';
import { resolveReviewPreparationReviewAssignment } from '../../../../src/adapters/cli/commands/review-preparation.js';
import { selectReviewer } from '../../../../src/application/review-loop/reviewer-selection.js';
import { postWorkflowReview } from '../../../../src/adapters/review/review-artifacts.js';
import { renderStatus } from '../../../../src/interfaces/cli/status.js';
import { fixtureMission, inMemoryTransitionStore } from '../../../fixtures/mission-builders.js';
import { MissionLifecycleService } from '../../../../src/application/mission-lifecycle-service.js';
import { ReviewState } from '../../../../src/adapters/review/review-state.js';
import { consumeReviewerArtifacts } from '../../../../src/adapters/review/review-artifacts.js';
import { runReviewLoop } from '../../../../src/application/review-loop/review-loop.js';
import { fakeReviewLoopPorts } from '../../../helpers/review-loop-ports.js';
import { applyReviewStateToReview } from '../../../../src/adapters/review/review-state-mapping.js';
import { projectMissionCard } from '../../../../src/application/projections/mission-board.js';

// Regression provenance: TASK-2339.
describe("self review forbidden", { concurrency: false }, () => {
  const SUBJECT: ReviewedRevision = {
    change: { kind: 'local-branch', sourceBranch: 'mission/task-9001', targetBranch: 'main' },
    revision: changeRevision("review-preparation-1"),
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
        response: { kind: 'resolved', resolutions: [], resultingRevision: changeRevision("review-preparation-2"), respondedAt: STARTED_AT },
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
    const result = resolveReviewPreparationReviewAssignment('claude', {
      worktree: '/does/not/matter',
      eligibleAgentsForStepFn: () => ['codex', 'claude', 'custom', 'vibe'],
      log: (msg: string) => logged.push(msg),
      ...overrides,
    });
    return { result, logged };
  }

  test("review preparation assigns a reviewer from another family when one is available", () => {
    const { result, logged } = assignment({ selectAgentFn: () => 'custom' });
    assert.equal(result.reviewer, 'custom');
    assert.equal(result.implementer, 'claude');
    assert.deepEqual([...result.reviewerEligibility.reviewers], ['codex', 'claude', 'custom', 'vibe']);
    assert.deepEqual(logged, []);
  });

  test("review preparation falls back to self-review only on typed reviewer-pool exhaustion regardless of diagnostic wording, and records that eligibility (TASK-2668.04)", () => {
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

  test("review preparation propagates a misconfigured selector instead of reviewing its own work", () => {
    assert.throws(
      () => assignment({
        selectAgentFn: () => {
          throw new Error('No eligible agents have a working launcher for step "review".');
        },
      }),
      /No eligible agents have a working launcher/,
    );
  });

  test("review preparation propagates an unreadable agent policy instead of reviewing its own work", () => {
    assert.throws(
      () => assignment({
        selectAgentFn: () => { throw new Error('Invalid agent config: unexpected token'); },
      }),
      /Invalid agent config/,
    );
  });
});

describe('current-role reviewer independence', { concurrency: false }, () => {
  test('keeps a non-colliding explicit reviewer and an approved historical reviewer unchanged (px-0054.01)', () => {
    const routing = {
      eligibleFamilies: () => ['claude', 'codex', 'custom'],
      nominate: () => assert.fail('an already valid reviewer must not be reselected'),
      launcherStatus: () => ({ supported: true, detail: '' }),
      runtimeMatrix: () => [],
    };
    const common = { maxAttempts: 2, dryRun: false, providerEnabled: true, slug: 'px-0054-stable' };

    const explicit = selectReviewer({
      ...common,
      preferredReviewer: 'custom',
      implementer: 'claude',
      isContinue: false,
      persisted: null,
    }, routing, { emit: () => {} });
    const historical = selectReviewer({
      ...common,
      implementer: 'claude',
      isContinue: true,
      persisted: { reviewer: 'claude', round: 1, phase: 'approved' },
    }, routing, { emit: () => {} });

    assert.equal(explicit?.reviewer, 'custom');
    assert.equal(historical?.reviewer, 'claude');
  });

  test('reroutes a persisted reviewer that now matches the reassigned implementer (px-0054.01)', () => {
    const nominations: string[][] = [];
    const selected = selectReviewer({
      implementer: 'claude',
      isContinue: true,
      persisted: { reviewer: 'claude', round: 2, phase: 'reviewing' },
      maxAttempts: 2,
      dryRun: false,
      providerEnabled: true,
      slug: 'px-0054-restart',
    }, {
      eligibleFamilies: () => ['claude', 'codex'],
      nominate: excluded => {
        nominations.push([...excluded]);
        return 'codex';
      },
      launcherStatus: () => ({ supported: true, detail: '' }),
      runtimeMatrix: () => [],
    }, { emit: () => {} });

    assert.equal(selected?.reviewer, 'codex');
    assert.ok(nominations.some(excluded => excluded.includes('claude')));
  });

  test('reroutes the next-round reviewer after implementer fallback creates a collision (px-0054.01)', async () => {
    let head = 'revision-1';
    let reviewNumber = 0;
    const fake = fakeReviewLoopPorts({
      slug: 'px-0054-fallback',
      agents: {
        launch: async launch => {
          if (launch.role === 'implementer') {
            head = 'revision-2';
            return { agent: 'claude', result: { status: 0 } };
          }
          return { agent: launch.agent, result: { status: 0 } };
        },
      },
      artifacts: {
        consumeReviewer: async () => {
          reviewNumber += 1;
          return reviewNumber === 1
            ? { consumed: true, ok: true, reviewState: 'REQUEST_CHANGES', reviewFindings: [{ id: 'F1', summary: 'exercise the fixing phase' }] }
            : { consumed: true, ok: true, reviewState: 'APPROVED', reviewFindings: [] };
        },
        consumeImplementer: async () => ({ consumed: true, ok: true, disposition: 'CHANGES_MADE', changedRevision: true }),
      },
      preReview: { head: () => head },
    });

    await runReviewLoop({
      slug: 'px-0054-fallback',
      implementer: 'codex',
      maxAttempts: 2,
      skipReviewPreparation: true,
    }, fake.ports);

    const reviewerLaunches = fake.launches.filter(launch => launch.role === 'reviewer');
    assert.deepEqual(reviewerLaunches.map(launch => launch.agent), ['claude', 'codex']);
    assert.ok(reviewerLaunches.every(launch => !launch.exclude.includes(launch.agent)));
    assert.equal(fake.current()?.phase, 'approved');
  });

  test('later implementer adoption does not rewrite an earlier judgment identity, revision, or time (px-0054.01)', () => {
    const startedAt = '2026-11-10T09:00:00Z';
    const decidedAt = '2026-11-10T09:05:00Z';
    const review = applyReviewerCommand(startReview(
      {
        change: { kind: 'local-branch', sourceBranch: 'mission/px-0054-history', targetBranch: 'main' },
        revision: changeRevision('review-preparation-1'),
      },
      fixtureAgentFamily('claude'),
      fixtureAgentFamily('codex'),
      startedAt,
      ConfiguredReviewerEligibility.fromReviewStep({
        eligible: [fixtureAgentFamily('claude'), fixtureAgentFamily('codex')],
        strategy: 'random',
      }),
    ), {
      type: 'request-changes',
      decidedAt,
      revision: changeRevision('review-preparation-1'),
      comment: 'Fix the collision.',
      findings: [{ id: reviewFindingId('F1'), summary: 'Keep roles independent.', location: null }],
    });
    const original = currentReviewRound(review);

    const updated = applyReviewStateToReview(review, {
      round: 1,
      phase: 'fixing',
      disposition: 'REQUEST_CHANGES',
      reviewer: 'claude',
      implementer: 'claude',
    });
    const historical = currentReviewRound(updated);

    assert.equal(historical.reviewer, 'claude');
    assert.equal(historical.implementer, 'codex');
    assert.equal(historical.decision?.revision, 'review-preparation-1');
    assert.equal(historical.decision?.decidedAt, decidedAt);
    assert.deepEqual(historical.decision, original.decision);
  });
});

// Regression provenance: TASK-2384.
describe("reviewer self review approval owed", { concurrency: false }, () => {
  test('exhausted reviewer pool launches the PR author, retains its verdict, and records no approval debt (PX-0046.03)', async () => {
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
      selectionLogs.some((message) => /PR author/i.test(message) && /optional/i.test(message) && !/will be required/i.test(message)),
      `selection must announce the same-agent fallback with optional human inspection before launch: ${selectionLogs.join(' | ')}`,
    );
    assert.ok(
      selectionLogs.some((message) => /claude: blocked: stale session.*codex: launcher unavailable: review sandbox/i.test(message)),
      `fallback diagnostics must name every unavailable family and reason: ${selectionLogs.join(' | ')}`,
    );

    let writtenState: { value: import('../../../../src/application/ports/review-persistence.js').ReviewStateData | null } = { value: null };
    const events: { type: string; params: unknown; }[] = [];
    const singleReviewer = fixtureAgentFamily('custom');
    const singleStartedAt = '2026-10-25T00:00:00Z';
    const singleReview = startReview({ change: { kind: 'local-branch', sourceBranch: 'mission/task-2384', targetBranch: 'main' }, revision: changeRevision('head') }, singleReviewer, singleReviewer, singleStartedAt, ConfiguredReviewerEligibility.fromReviewStep({ eligible: [singleReviewer], strategy: 'random' }));
    const singleStore = inMemoryTransitionStore(fixtureMission('task-2384', { status: 'review', assignee: singleReviewer, review: singleReview }));
    const outcome = await postWorkflowReview('task-2384', 'approve', 'looks good', {
      missionStore: singleStore, lifecycleService: new MissionLifecycleService(singleStore),
      reviewIdentity: 'custom',
      readTokenFn: () => 'token',
      getPrAuthorFn: () => 'custom',
      postReviewFn: () => { throw new Error('self approval must not reach Forgejo'); },
      readReviewStateFn: () => ({ reviewer: 'custom', implementer: 'custom', round: 1, startedAt: singleStartedAt, phase: 'reviewing' }),
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
    assert.equal(writtenState.value.metadata?.approvalOwed, false, 'a same-agent review leaves no approval debt (PX-0046.03)');
    assert.deepEqual(events, [{
      type: 'reviewer_outcome',
      params: { verdict: 'approve', content: 'Single-family self-author verdict: approve' },
    }], 'the same-agent verdict records no approval-owed marker');

    const card = projectMissionCard(singleStore.mission(), {
      latestGate: 'not-run', reviewApproval: null, currentWork: null, blockingReason: null, flags: [],
    });
    assert.equal(card.approvalOwed, false);
    assert.equal(card.sameAgentReview, true, 'the board projects the actual current-round identity relationship');

    const statusLines: string[] = [];
    renderStatus({
      branch: 'mission/task-2384', worktree: '/tmp/task-2384', rebaseInfo: null, slug: 'task-2384',
      missionData: {
        backlogStatus: card.rawStatus, reviewPhase: card.reviewPhase, reviewRound: card.reviewRound,
        reviewDisposition: card.reviewDisposition, approvalOwed: card.approvalOwed,
        sameAgentReview: card.sameAgentReview, awaitingApprovals: card.awaitingApprovals,
        reviewHistory: [],
      },
      prInfo: { exists: true, number: 2384, state: 'open' }, staleWorktrees: [], staleWorktreeRebase: {},
      agents: [], lastThreeCommits: [], uncommittedCount: 0,
    }, (message) => statusLines.push(message));
    assert.ok(
      statusLines.some((message) => /optional human inspection/i.test(message) && !/required|owed/i.test(message)),
      `px status must present human inspection as optional, never as a requirement: ${statusLines.join(' | ')}`,
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
    writeReviewStateFn: async (_slug, state) => new ReviewState(_slug, state).save('/fixture', { missionStore: store }),
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
      writeReviewStateFn: async (_slug, state) => new ReviewState(_slug, state).save('/fixture', { missionStore: store }),
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

test('self-author approval cannot leave fixing without a decision (TASK-2821 review P1)', async () => {
  const slug = 'task-2821-illegal-approval';
  const family = fixtureAgentFamily('custom');
  const review = startReview({ change: { kind: 'local-branch', sourceBranch: `mission/${slug}`, targetBranch: 'main' }, revision: changeRevision('head') },
    family, family, '2026-10-25T00:00:00Z', ConfiguredReviewerEligibility.fromReviewStep({ eligible: [family], strategy: 'random' }));
  const broken = { ...review, rounds: [{ ...review.rounds[0], phase: 'fixing' as const }] as const };
  const store = inMemoryTransitionStore(fixtureMission(slug, { status: 'review', assignee: family, review: broken }));
  const before = structuredClone(store.mission());
  const { readReviewState, writeReviewState } = await import('../../../../src/adapters/review/review-state.js');
  await assert.rejects(() => postWorkflowReview(slug, 'approve', 'looks good', {
    missionStore: store, lifecycleService: new MissionLifecycleService(store), worktree: '/fixture',
    reviewIdentity: 'custom', readTokenFn: () => 'fake', getPrAuthorFn: () => 'custom',
    readReviewStateFn: () => readReviewState(slug, '/fixture', store),
    writeReviewStateFn: (_slug, state) => writeReviewState(_slug, state, '/fixture', { missionStore: store }),
    createEventFn: () => assert.fail('an illegal approval must not write an event'),
    postReviewFn: () => assert.fail('self-author must not POST approval'), log: () => {}, error: () => {},
  }), /phase|cannot move/);
  const { recordApproval } = await import('../../../../src/adapters/review/review-round.js');
  const direct = await recordApproval(slug, { comment: null, decidedAt: '2026-10-25T01:00:00Z' }, { missionStore: store, lifecycleService: new MissionLifecycleService(store) });
  assert.equal(direct.outcome, 'failed');
  if (direct.outcome === 'failed') { assert.match(direct.diagnostic, /phase|cannot move/); }
  assert.deepEqual(store.mission(), before);
  assert.equal(store.events.length, 0);
});
