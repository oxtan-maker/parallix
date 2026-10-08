// review loop retry contract.
// Related scenarios share imports; each contract keeps its own fixtures.
import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { runReviewLoop } from '../../../../src/application/review-loop/review-loop.js';
import { POLL_TIMEOUT, isPollTimeout, type ImplementerArtifactFacts, type ProviderPoll } from '../../../../src/application/ports/review-round.js';
import { ReviewState } from '../../../../src/adapters/review/review-state.js';
import { fakeReviewLoopPorts } from '../../../helpers/review-loop-ports.js';

// Regression provenance: TASK-1221.
describe("stale blocked relaunch", { concurrency: false }, () => {
  /**
   * A `--continue` into a round already in fixing: the provider reports the
   * existing disposition, the implementer launch reports no exit status, and
   * the implementer's artifacts answer the round.
   */
  function continueFixing(slug: string, options: {
    pollDisposition: (_implementer: string, _sinceIso: string) => Promise<ProviderPoll> | ProviderPoll;
    consumeImplementer?: () => Promise<ImplementerArtifactFacts>;
    reviewer?: () => Promise<{ consumed: boolean; ok?: boolean; reviewState?: string }>;
  }) {
    const state = new ReviewState(slug, { reviewer: 'codex', implementer: 'custom', phase: 'fixing', round: 1 });
    const fake = fakeReviewLoopPorts({
      slug,
      state,
      routing: { eligibleFamilies: () => ['codex', 'custom'], nominate: () => 'codex' },
      provider: {
        latestReview: async () => 'REQUEST_CHANGES',
        pollReview: async () => 'REQUEST_CHANGES',
        pollDisposition: async (implementer, sinceIso) => await options.pollDisposition(implementer, sinceIso),
      },
      agents: { launch: async () => ({ agent: 'custom' }) },
      artifacts: {
        consumeImplementer: options.consumeImplementer ?? (async () => ({ consumed: true, ok: true, disposition: 'CHANGES_MADE' })),
        ...(options.reviewer ? { consumeReviewer: options.reviewer } : {}),
      },
      // No revision is observable, so a reported change is taken at its word.
      preReview: { head: () => null },
    });
    return { fake, state };
  }
  const actOnReview = (fake: ReturnType<typeof fakeReviewLoopPorts>) => fake.launches.filter(launch => launch.role === 'implementer');

  test('--continue on a round already fixing treats a current human correction as the fixing round (TASK-2675)', async () => {
    const { fake } = continueFixing('task-2675-human-correction', { pollDisposition: () => 'BLOCKED' });
    fake.ports.humanFeedback.reconcile = async () => ({ source: 'forgejo:review:7', author: 'human', state: 'current', disposition: 'REQUEST_CHANGES', approval: false, reason: 'operator correction', findings: [] });
    await runReviewLoop({ slug: 'task-2675-human-correction', isContinue: true, maxAttempts: 1 }, fake.ports);

    assert.ok(actOnReview(fake).length > 0, `Expected the implementer to act on the correction; got errors: ${fake.errors.join(' | ')}`);
    assert.ok(!fake.errors.some(m => m.includes('Cannot transition')), fake.errors.join(' | '));
  });

  test('SC1: --continue skip-check BLOCKED re-launches implementer instead of skipping', async () => {
    const { fake } = continueFixing('task-1221-sc1', { pollDisposition: () => 'BLOCKED' });
    await runReviewLoop({ slug: 'task-1221-sc1', isContinue: true, maxAttempts: 1 }, fake.ports);

    assert.ok(actOnReview(fake).length > 0, `Expected implementer re-launch (act-on-review) after stale BLOCKED; got launches: ${JSON.stringify(fake.launches)}`);
    assert.ok(fake.logs.some(m => m.includes('Re-launching implementer')), `Expected re-launch log message; got: ${fake.logs.join(' | ')}`);
    assert.ok(!fake.logs.some(m => m.includes('Skipping implementer launch') && m.includes('BLOCKED')), `Should NOT log "Skipping implementer launch" for BLOCKED; got: ${fake.logs.join(' | ')}`);
  });

  test('SC2: Re-launched implementer posts CHANGES_MADE → loop continues to next round', async () => {
    const { fake } = continueFixing('task-1221-sc2', {
      pollDisposition: () => 'BLOCKED', // skip-check always finds stale BLOCKED
      reviewer: async () => ({ consumed: true, ok: true, reviewState: 'REQUEST_CHANGES' }),
    });
    await runReviewLoop({ slug: 'task-1221-sc2', isContinue: true, maxAttempts: 2 }, fake.ports);

    assert.equal(actOnReview(fake).length, 2, `Expected 2 act-on-review launches (re-launch + round 2); got: ${JSON.stringify(fake.launches)}`);
    assert.ok(fake.logs.some(m => m.includes('Re-launching implementer')), `Expected re-launch log in: ${fake.logs.join(' | ')}`);
    assert.ok(fake.logs.some(m => m.includes('implementer made changes') && m.includes('Continuing to round')), `Expected continue-to-next-round message; got: ${fake.logs.join(' | ')}`);
  });

  test('SC3: Re-launched implementer still BLOCKED → loop stops with handoff', async () => {
    const { fake } = continueFixing('task-1221-sc3', {
      pollDisposition: () => 'BLOCKED',
      consumeImplementer: async () => ({ consumed: true, ok: true, disposition: 'BLOCKED' }),
    });
    await runReviewLoop({ slug: 'task-1221-sc3', isContinue: true, maxAttempts: 1 }, fake.ports);

    assert.equal(actOnReview(fake).length, 1, `Expected 1 act-on-review re-launch; got: ${JSON.stringify(fake.launches)}`);
    assert.ok(fake.logs.some(m => m.includes('Autonomous review stopped') && m.includes('BLOCKED') && m.includes('Hand off')), `Expected stop/handoff message; got: ${fake.logs.join(' | ')}`);
    assert.equal(fake.current()?.disposition, 'BLOCKED', 'Disposition should be BLOCKED');
    assert.deepEqual(fake.stops, ['implementer reported BLOCKED'], 'the human escalation is published');
  });

  test('SC4: Non-continue (fresh start) path is unaffected', async () => {
    const fake = fakeReviewLoopPorts({ slug: 'task-1221-sc4', routing: { eligibleFamilies: () => ['codex', 'custom'], nominate: () => 'codex' }, provider: {} });
    await runReviewLoop({ slug: 'task-1221-sc4', maxAttempts: 1, dryRun: true }, fake.ports);
    assert.ok(fake.logs.some(m => m.includes('DRY-RUN')), 'Expected DRY-RUN marker in logs');
  });

  test('SC5: PARKED disposition also triggers re-launch (not just BLOCKED)', async () => {
    const { fake } = continueFixing('task-1221-sc5', { pollDisposition: () => 'PARKED' });
    await runReviewLoop({ slug: 'task-1221-sc5', isContinue: true, maxAttempts: 1 }, fake.ports);

    assert.ok(actOnReview(fake).length > 0, `Expected implementer re-launch after stale PARKED; got launches: ${JSON.stringify(fake.launches)}`);
    assert.ok(fake.logs.some(m => m.includes('Re-launching implementer')), `Expected re-launch log message for PARKED; got: ${fake.logs.join(' | ')}`);
  });

  test('Skip-check non-BLOCKED/PARKED disposition still skips (existing behaviour preserved)', async () => {
    const { fake } = continueFixing('task-1221-skip-normal', { pollDisposition: () => 'CHANGES_MADE' });
    await runReviewLoop({ slug: 'task-1221-skip-normal', isContinue: true, maxAttempts: 1 }, fake.ports);
    assert.ok(fake.logs.some(m => m.includes('Skipping implementer launch')), `Expected "Skipping implementer launch" for non-blocking disposition; got: ${fake.logs.join(' | ')}`);
    assert.equal(actOnReview(fake).length, 0);
  });

  test('SC1-Fix: Post-relaunch poll uses updated sinceIso, not stale state.startedAt', async () => {
    const pollCalls: string[] = [];
    let consumeCall = 0;
    const { fake, state } = continueFixing('task-1221-sc1-forge-race', {
      pollDisposition: (_implementer, sinceIso) => { pollCalls.push(sinceIso); return 'BLOCKED'; },
      consumeImplementer: async () => (++consumeCall === 1 ? { consumed: false } : { consumed: true, ok: true, disposition: 'BLOCKED' }),
    });
    await runReviewLoop({ slug: 'task-1221-sc1-forge-race', isContinue: true, maxAttempts: 1 }, fake.ports);

    assert.equal(actOnReview(fake).length, 1, `Expected 1 act-on-review re-launch; got: ${JSON.stringify(fake.launches)}`);
    assert.ok(fake.logs.some(m => m.includes('Re-launching implementer')), `Expected re-launch log; got: ${fake.logs.join(' | ')}`);
    // The skip-check polls since state.startedAt; the post-relaunch poll since a later instant.
    assert.ok(pollCalls.length >= 2, `Expected >=2 poll calls; got ${pollCalls.length}`);
    assert.ok(new Date(pollCalls.at(-1)!).getTime() > new Date(state.startedAt).getTime(), 'Post-relaunch poll must use a newer sinceIso than state.startedAt');
    assert.ok(fake.logs.some(m => m.includes('Autonomous review stopped') && m.includes('BLOCKED') && m.includes('Hand off')), `Expected stop/handoff message; got: ${fake.logs.join(' | ')}`);
  });
});

// Regression provenance: TASK-2233.
describe("reviewer non submission bounce", { concurrency: false }, () => {
  // task-2233: a reviewer that produces no outcome must be relaunched through
  // the bounded recovery (ADR 0048) before escalation: one first launch plus
  // the two recovery relaunches = 3 reviewer launches. A null poll result is
  // not a usable outcome and must not end recovery early.

  function silentReviewer(provider: { pollReview: () => Promise<ProviderPoll> } | null) {
    const fake = fakeReviewLoopPorts({
      slug: 'task-9001',
      state: new ReviewState('task-9001', { reviewer: 'custom', implementer: 'custom', round: 1, phase: 'reviewing' }),
      routing: { eligibleFamilies: () => ['custom'], nominate: () => 'custom' },
      handoff: { handoff: async () => ({ ok: true }) },
      provider,
      artifacts: { consumeReviewer: async () => ({ consumed: false }) },
      output: { exit: (code: number) => { throw new Error(`exit(${code})`); } },
    });
    return fake;
  }
  const reviewerLaunches = (fake: ReturnType<typeof fakeReviewLoopPorts>) => fake.launches.filter(launch => launch.role === 'reviewer').length;

  test('reviewer-non-submission: error fires without completing recovery retries (forgejoEnabled=true, poll returns POLL_TIMEOUT)', async () => {
    const fake = silentReviewer({ pollReview: async () => POLL_TIMEOUT });
    await runReviewLoop({ slug: 'task-9001', maxAttempts: 1 }, fake.ports);

    assert.equal(reviewerLaunches(fake), 3, `recovery loop should complete 2 retries before escalation (got ${reviewerLaunches(fake)} reviewer launches)`);
    assert.ok(fake.errors.some(e => e.includes('Recovery dossier for task-9001') && e.includes('No usable review outcome')),
      `should escalate with the recovery dossier and root timeout evidence. Errors: ${fake.errors.join(' | ')}`);
    assert.ok(fake.logs.some(l => l.includes('human review required') && l.includes('REVIEWER_NON_APPROVAL')),
      `should log human review escalation with REVIEWER_NON_APPROVAL. Logs: ${fake.logs.join(' | ')}`);
  });

  test('reviewer-non-submission: null poll result breaks recovery loop prematurely (forgejoEnabled=true, poll returns null)', async () => {
    const fake = silentReviewer({ pollReview: async () => null });
    await runReviewLoop({ slug: 'task-9001', maxAttempts: 1 }, fake.ports);

    assert.equal(reviewerLaunches(fake), 3, `recovery loop should complete 2 retries even when poll returns null (got ${reviewerLaunches(fake)} reviewer launches)`);
    assert.ok(fake.errors.some(e => e.includes('Recovery dossier for task-9001') && e.includes('No usable review outcome')),
      `should escalate with the recovery dossier, not a bare non-submission error. Errors: ${fake.errors.join(' | ')}`);
  });

  test('reviewer-non-submission: forgejoEnabled=false — recovery loop breaks on null reviewState', async () => {
    const fake = silentReviewer(null);
    await runReviewLoop({ slug: 'task-9001', maxAttempts: 1 }, fake.ports);

    assert.equal(reviewerLaunches(fake), 3, `recovery loop should complete 2 retries with forgejoEnabled=false (got ${reviewerLaunches(fake)} reviewer launches)`);
    assert.ok(fake.errors.some(e => e.includes('Recovery dossier for task-9001') && e.includes('No usable review outcome')),
      `should escalate with the recovery dossier. Errors: ${fake.errors.join(' | ')}`);
  });

  // ── ADR 0048 mapping: verify isPollTimeout behavior ─────────────────────────

  test('isPollTimeout correctly distinguishes POLL_TIMEOUT from null and undefined', () => {
    assert.equal(isPollTimeout(POLL_TIMEOUT), true, 'POLL_TIMEOUT sentinel should return true');
    assert.equal(isPollTimeout(null), false, 'null should NOT be treated as POLL_TIMEOUT');
    assert.equal(isPollTimeout(undefined), false, 'undefined should NOT be treated as POLL_TIMEOUT');
    assert.equal(isPollTimeout('APPROVED'), false, 'string state should NOT be treated as POLL_TIMEOUT');
  });
});

// Regression provenance: TASK-2679.
describe("human correction on an approved round", { concurrency: false }, () => {
  const correction = { source: 'forgejo:review:9', author: 'human', state: 'current' as const, disposition: 'REQUEST_CHANGES' as const, approval: false, reason: 'corr', findings: [] };

  /** The adapter leaves a correction on an approved round unconsumed; a round that can act consumes it. */
  function approvedRound(slug: string, phase: 'approved' | 'fixing', feedback: Awaited<ReturnType<ReviewLoopPortsFake['ports']['humanFeedback']['reconcile']>>) {
    const state = new ReviewState(slug, { reviewer: 'codex', implementer: 'custom', phase, round: 1 });
    const fake = fakeReviewLoopPorts({
      slug, state,
      routing: { eligibleFamilies: () => ['codex', 'custom'], nominate: () => 'codex' },
      provider: { pollDisposition: async () => 'BLOCKED' },
      agents: { launch: async () => ({ agent: 'custom' }) },
      preReview: { head: () => null },
    });
    fake.ports.humanFeedback.reconcile = async reconciled => {
      if (feedback?.source && reconciled.phase !== 'approved') { reconciled.metadata.humanFeedbackSources = [...new Set([...(reconciled.metadata.humanFeedbackSources as string[] ?? []), feedback.source])]; }
      return feedback;
    };
    return fake;
  }
  type ReviewLoopPortsFake = ReturnType<typeof fakeReviewLoopPorts>;
  const implementerLaunches = (fake: ReviewLoopPortsFake) => fake.launches.filter(launch => launch.role === 'implementer');

  test('a current REQUEST_CHANGES on an approved round stops with revoke guidance and retains the correction (TASK-2679)', async () => {
    const fake = approvedRound('task-2679-approved', 'approved', correction);
    await runReviewLoop({ slug: 'task-2679-approved', isContinue: true, maxAttempts: 1 }, fake.ports);

    assert.ok(!fake.errors.some(m => m.includes('Cannot transition')), fake.errors.join(' | '));
    assert.equal(implementerLaunches(fake).length, 0, 'no implementer may launch under an effective approval');
    assert.equal(fake.current()?.phase, 'approved');
    assert.ok(fake.logs.some(m => m.includes('px revoke-review') && m.includes('task-2679-approved')), fake.logs.join(' | '));
    assert.deepEqual(fake.current()?.metadata.humanFeedbackSources ?? [], [], 'the correction source stays unconsumed for retry');
    assert.deepEqual(fake.stops, ['APPROVED_ROUND_HUMAN_CORRECTION']);
  });

  test('a second continuation re-observes the retained correction without double consuming it (TASK-2679)', async () => {
    const fake = approvedRound('task-2679-retry', 'approved', correction);
    await runReviewLoop({ slug: 'task-2679-retry', isContinue: true, maxAttempts: 1 }, fake.ports);
    await runReviewLoop({ slug: 'task-2679-retry', isContinue: true, maxAttempts: 1 }, fake.ports);

    assert.equal(fake.stops.length, 2, 'each continuation stops on the same retained correction');
    assert.equal(implementerLaunches(fake).length, 0);
    assert.deepEqual(fake.current()?.metadata.humanFeedbackSources ?? [], []);
  });

  test('a human correction revokes the approval on their authority and continues into fixing (TASK-2679)', async () => {
    const fake = approvedRound('task-2679-revoke', 'approved', correction);
    const requests: unknown[] = [];
    const approvalRevocation = {
      revoke: async (request: { round: number; operator: string; reason: string }) => {
        requests.push(request);
        fake.current()!.phase = 'fixing';
        return { ok: true as const };
      },
    };
    await runReviewLoop({ slug: 'task-2679-revoke', isContinue: true, maxAttempts: 1 }, { ...fake.ports, approvalRevocation });

    assert.equal(requests.length, 1);
    assert.deepEqual(requests[0], { round: 1, operator: 'human', reason: 'Human change request forgejo:review:9: corr' });
    assert.ok(implementerLaunches(fake).length > 0, fake.errors.join(' | '));
    assert.deepEqual(fake.stops.filter(reason => reason === 'APPROVED_ROUND_HUMAN_CORRECTION'), []);
    assert.ok(fake.logs.some(m => m.includes('approval revoked')), fake.logs.join(' | '));
  });

  test('a failed revocation stops with guidance and the diagnostic, keeping the correction (TASK-2679)', async () => {
    const fake = approvedRound('task-2679-revoke-fail', 'approved', correction);
    const approvalRevocation = { revoke: async () => ({ ok: false as const, diagnostic: 'version conflict' }) };
    await runReviewLoop({ slug: 'task-2679-revoke-fail', isContinue: true, maxAttempts: 1 }, { ...fake.ports, approvalRevocation });

    assert.equal(implementerLaunches(fake).length, 0);
    assert.equal(fake.current()?.phase, 'approved');
    assert.ok(fake.logs.some(m => m.includes('version conflict')) && fake.logs.some(m => m.includes('px revoke-review')), fake.logs.join(' | '));
    assert.deepEqual(fake.current()?.metadata.humanFeedbackSources ?? [], []);
    assert.deepEqual(fake.stops, ['APPROVED_ROUND_HUMAN_CORRECTION']);
  });

  test('a revocation that leaves the round approved restarts only once, then escalates (TASK-2679)', async () => {
    const fake = approvedRound('task-2679-revoke-loop', 'approved', correction);
    let calls = 0;
    const approvalRevocation = { revoke: async () => { calls++; return { ok: true as const }; } };
    await runReviewLoop({ slug: 'task-2679-revoke-loop', isContinue: true, maxAttempts: 1 }, { ...fake.ports, approvalRevocation });

    assert.equal(calls, 2);
    assert.equal(implementerLaunches(fake).length, 0);
    assert.deepEqual(fake.stops, ['APPROVED_ROUND_HUMAN_CORRECTION']);
  });

  test('a round already fixing continues without a phase transition (TASK-2679)', async () => {
    const fake = approvedRound('task-2679-fixing', 'fixing', correction);
    await runReviewLoop({ slug: 'task-2679-fixing', isContinue: true, maxAttempts: 1 }, fake.ports);

    assert.ok(implementerLaunches(fake).length > 0, fake.errors.join(' | '));
    assert.deepEqual(fake.stops.filter(reason => reason === 'APPROVED_ROUND_HUMAN_CORRECTION'), []);
  });

  test('dismissed or historical feedback is not a current correction on an approved round (TASK-2679)', async () => {
    const dismissed = approvedRound('task-2679-dismissed', 'approved', { ...correction, state: 'dismissed' });
    await runReviewLoop({ slug: 'task-2679-dismissed', isContinue: true, maxAttempts: 1 }, dismissed.ports);
    assert.ok(!dismissed.stops.includes('APPROVED_ROUND_HUMAN_CORRECTION'));
    assert.ok(!dismissed.logs.some(m => m.includes('px revoke-review')));

    const historical = approvedRound('task-2679-historical', 'approved', null);
    await runReviewLoop({ slug: 'task-2679-historical', isContinue: true, maxAttempts: 1 }, historical.ports);
    assert.ok(!historical.stops.includes('APPROVED_ROUND_HUMAN_CORRECTION'));
  });

  test('a persistence failure while stopping keeps the correction retryable (TASK-2679)', async () => {
    const fake = approvedRound('task-2679-persist', 'approved', correction);
    let attempts = 0;
    const persist = fake.ports.state.persist;
    fake.ports.state.persist = async next => {
      if (attempts++ === 0) { throw new Error('disk full'); }
      await persist(next);
    };
    await assert.rejects(runReviewLoop({ slug: 'task-2679-persist', isContinue: true, maxAttempts: 1 }, fake.ports), /disk full/);
    assert.equal(implementerLaunches(fake).length, 0);
    assert.deepEqual(fake.current()?.metadata.humanFeedbackSources ?? [], [], 'nothing consumed the correction before the failed write');
  });
});
