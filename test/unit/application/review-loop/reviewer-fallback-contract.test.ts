import { renderReviewLoopEvent, reviewLoopReporter } from '../../../../src/adapters/review/review-loop-presentation.js';
// reviewer fallback contract.
// Reviewer routing policy lives in src/application/review-loop/reviewer-selection.ts;
// these cases drive it through a fake routing port (eligible families, launcher
// status, and the configured selector's nominee).
import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { selectReviewer, type ReviewerSelectionRequest } from '../../../../src/application/review-loop/reviewer-selection.js';
import { runReviewLoop } from '../../../../src/application/review-loop/review-loop.js';
import type { ReviewerRoutingPort } from '../../../../src/application/ports/review-round.js';
import { agentFamily, selectAgent, type AgentSelectionSnapshot } from '../../../../src/domain/agents.js';
import { createReviewObservationRecorder } from '../../../../src/adapters/review/review-observation-recording.js';
import { applyReviewStateToReview } from '../../../../src/adapters/review/review-state-mapping.js';
import { createReviewerPolicyStatePort, ReviewState } from '../../../../src/adapters/review/review-state.js';
import { fakeReviewLoopPorts } from '../../../helpers/review-loop-ports.js';
import { fixtureMission, inMemoryTransitionStore } from '../../../fixtures/mission-builders.js';
import { MissionLifecycleService } from '../../../../src/application/mission-lifecycle-service.js';
import { recordApproval, recordRequestedChanges } from '../../../../src/adapters/review/review-round.js';
import { reviewerResultAttribution } from '../../../../src/adapters/review/reviewer-result-attribution.js';
import { ConfiguredReviewerEligibility, changeRevision, currentReviewRound, reviewFindingId, reviewStatus, startReview } from '../../../../src/domain/review.js';
import { planReviewerPolicy } from '../../../../src/domain/reviewer-policy.js';
import { runReviewerPhase } from '../../../../src/application/review-loop/reviewer-phase.js';
import { ReviewRound } from '../../../../src/application/review-loop/round.js';
import { scenario as reviewClassificationScenario } from '../../../helpers/review-classification.js';

function routing(eligible: string[], supported: (_agent: string) => boolean, nominate: (_excluded: ReadonlySet<string>) => string): ReviewerRoutingPort {
  return { eligibleFamilies: () => eligible, launcherStatus: agent => ({ supported: supported(agent), detail: agent }), nominate, runtimeMatrix: () => [] };
}

function select(request: Partial<ReviewerSelectionRequest> & { implementer: string }, port: ReviewerRoutingPort) {
  const logs: string[] = [];
  const errors: string[] = [];
  const selected = selectReviewer({ isContinue: false, persisted: null, maxAttempts: 5, dryRun: true, providerEnabled: false, slug: 'task-test-fallback', ...request }, port, reviewLoopReporter({ log: line => logs.push(line), error: line => errors.push(line) }));
  return { selected, logs, errors };
}

test('reviewer presentation distinguishes initial selection from continued and later rounds (TASK-2708)', () => {
  for (const [round, isContinue] of [[1, false], [1, true], [2, false]] as const) {
    const lines: string[] = [];
    const events: unknown[] = [];
    const selected = selectReviewer({ implementer: 'codex', isContinue, persisted: { reviewer: 'claude', round, phase: 'reviewing' }, maxAttempts: 5, dryRun: false, providerEnabled: false, slug: 'task-test' },
      routing(['codex', 'claude'], () => true, () => { throw new Error('persisted reviewer must not be nominated again'); }),
      { emit: event => { events.push(event); renderReviewLoopEvent(event, { log: line => lines.push(line), error: line => lines.push(line) }); } });
    assert.deepEqual(selected, { reviewer: 'claude', reviewerSource: 'persisted' });
    assert.deepEqual(events, [
      { kind: 'reviewer-resumed', reviewer: 'claude', round, isContinue },
      { kind: 'reviewer-selected', reviewer: 'claude', source: 'persisted', round, isContinue },
    ]);
    if (round === 1 && !isContinue) {
      assert.deepEqual(lines, ['[INFO] Initial reviewer: claude (round 1)', '[INFO] Selected reviewer: claude (initial selection)']);
      assert.doesNotMatch(lines.join('\n'), /resuming|persisted/i);
    } else {
      assert.deepEqual(lines, [`[INFO] Resuming persisted reviewer: claude (round ${round})`, '[INFO] Selected reviewer: claude (persisted)']);
    }
  }
});

test('explicit reviewer keeps its historical precedence when review resumes (TASK-2837)', () => {
  const persisted = { reviewer: 'claude', round: 2, phase: 'reviewing' as const };
  const supported = select({
    implementer: 'codex', preferredReviewer: 'qwen', isContinue: true, persisted, dryRun: false,
  }, routing(['codex', 'claude', 'qwen'], () => true, () => { throw new Error('the explicit reviewer needs no nomination'); }));
  assert.deepEqual(supported.selected, { reviewer: 'qwen', reviewerSource: 'explicit' });

  const unavailable = select({
    implementer: 'codex', preferredReviewer: 'qwen', isContinue: true, persisted, dryRun: false,
  }, routing(['codex', 'claude', 'qwen'], agent => agent !== 'qwen', () => { throw new Error('the persisted reviewer is the continuation fallback'); }));
  assert.deepEqual(unavailable.selected, { reviewer: 'claude', reviewerSource: 'persisted-continue-fallback' });
  assert.ok(unavailable.logs.some(line => line.includes('falling back to persisted reviewer "claude"')), unavailable.logs.join(' | '));
});

// Regression provenance: TASK-1079.
describe("review blocked fallback", { concurrency: false }, () => {
  // Original bug: a blocked auto-derived reviewer crashed the loop with
  // "Unsupported reviewer" even though other families were available. A blocked
  // nominee must be treated as needing a fallback, not as a hard failure.

  test('reviewer selection falls back when the auto-derived reviewer is blocked but a different-family agent is available', () => {
    const { selected, logs, errors } = select({ implementer: 'custom' }, routing(['claude', 'vibe', 'custom'], () => true, excluded => ['vibe', 'claude'].filter(a => !excluded.has(a))[0]));
    assert.ok(selected, `selection must not fail when a fallback is available; errors: ${errors.join(' | ')}`);
    assert.ok(logs.some(l => l.includes('Selected reviewer: vibe (auto-derived)')), `Expected selected-reviewer=vibe log; got: ${logs.join(' | ')}`);
  });

  test('reviewer selection iterates past a blocked deterministic fallback to a third unblocked agent (Mission SC #3 — "Mistral or Claude")', () => {
    const { selected, logs, errors } = select({ implementer: 'custom' }, routing(['claude', 'custom', 'codex', 'vibe'], agent => agent === 'claude' || agent === 'custom', excluded => {
      if (!excluded.has('codex')) { return 'codex'; }
      if (!excluded.has('vibe')) { return 'vibe'; }
      return 'claude';
    }));
    assert.ok(selected, `selection must walk past a blocked deterministic fallback; errors: ${errors.join(' | ')}`);
    assert.ok(logs.some(l => l.includes('Selected reviewer: claude (auto-derived-fallback)')), `Expected selected-reviewer=claude after multi-hop fallback; got: ${logs.join(' | ')}`);
  });

  test('explicit preferred reviewer falls back when its launcher is unavailable (TASK-2837)', () => {
    const { selected, logs, errors } = select({ implementer: 'custom', preferredReviewer: 'codex', dryRun: false }, routing(['claude', 'gemini', 'custom', 'codex'], agent => agent !== 'codex', excluded => excluded.has('claude') ? 'gemini' : 'claude'));
    assert.deepEqual(selected, { reviewer: 'claude', reviewerSource: 'explicit-fallback' });
    assert.equal(errors.length, 0, errors.join(' | '));
    assert.ok(logs.some(line => line.includes('trying fallback "claude"')), logs.join(' | '));
  });
});

// Regression provenance: TASK-1135.
describe("review fallback", { concurrency: false }, () => {
  // 1. A blocked auto-derived reviewer falls back through the selector.
  // 2. A launch that hits a usage limit adopts the launcher's fallback family.
  // 3. A blocked persisted reviewer falls back to the next eligible family.
  // 4. Reviewer fallback never mutates the Backlog assignee (SC 5).

  test('CP-1: blocked auto-derived reviewer falls back via selectAgent without mutating Backlog assignee', () => {
    const { selected, logs, errors } = select({ implementer: 'vibe' }, routing(['codex', 'claude', 'custom', 'vibe'], agent => agent !== 'codex', excluded => {
      if (!excluded.has('codex')) { return 'codex'; }
      if (!excluded.has('claude')) { return 'claude'; }
      return 'custom';
    }));
    assert.ok(selected, `selection must not fail when fallback is available; errors: ${errors.join(' | ')}`);
    assert.ok(logs.some(l => l.includes('Unsupported reviewer: "codex"')), `Expected blocked-reviewer warning; got: ${logs.join(' | ')}`);
    assert.ok(logs.some(l => l.includes('trying fallback "claude"')), `Expected fallback-to-claude log; got: ${logs.join(' | ')}`);
    assert.equal(selected?.reviewerSource, 'auto-derived-fallback');
  });

  test('CP-1: usage-limit on auto-derived reviewer triggers fallback with blocklist write', async () => {
    // The launcher hit a usage limit for the nominated reviewer, recorded the
    // block, and launched another family. The loop adopts that family for the
    // poll and every later round, and never touches the Backlog assignee.
    const blocklistWrites: string[] = [];
    const fake = fakeReviewLoopPorts({
      slug: 'task-test-cp1-fallback',
      routing: { eligibleFamilies: () => ['codex', 'claude', 'vibe', 'custom'], nominate: excluded => (!excluded.has('custom') ? 'custom' : 'vibe') },
      agents: {
        launch: async launch => {
          if (launch.agent === 'custom') { blocklistWrites.push('custom'); return { agent: 'vibe', result: { status: 0 } }; }
          return { agent: launch.agent, result: { status: 0 } };
        },
      },
      artifacts: { consumeReviewer: async () => ({ consumed: true, ok: true as const, reviewState: 'APPROVED' }) },
    });
    await runReviewLoop({ slug: 'task-test-cp1-fallback', implementer: 'claude', maxAttempts: 1, skipReviewPreparation: true }, fake.ports);
    assert.deepEqual(fake.exits, [], `the loop must not exit on usage-limit; errors: ${fake.errors.join(' | ')}`);
    assert.ok(fake.logs.some(l => l.includes('Selected reviewer: custom')), `Expected selected-reviewer=custom; got: ${fake.logs.join(' | ')}`);
    assert.deepEqual(blocklistWrites, ['custom']);
    assert.ok(fake.logs.some(l => l.includes('reviewer fell back from custom to vibe')), fake.logs.join(' | '));
    assert.equal(fake.current()?.reviewer, 'vibe', 'the fallback family is persisted as the reviewer');
    assert.ok(!fake.mirrors.some(effect => effect.startsWith('assign:')), 'a reviewer fallback never mutates the Backlog assignee');
  });

  test('CP-1: persisted blocked reviewer falls back via selectAgent without mutating Backlog assignee', () => {
    const { selected, logs, errors } = select({
      implementer: 'custom',
      persisted: { reviewer: 'codex', round: 1, phase: 'reviewing' },
    }, routing(['codex', 'claude', 'vibe', 'custom'], agent => agent !== 'codex', excluded => (!excluded.has('vibe') ? 'vibe' : 'claude')));
    assert.ok(selected, `selection must not fail on a persisted blocked reviewer; errors: ${errors.join(' | ')}`);
    assert.ok(logs.some(l => l.includes('Unsupported reviewer: "codex"')), `Expected blocked-persisted-reviewer warning; got: ${logs.join(' | ')}`);
    assert.ok(logs.some(l => l.includes('trying fallback "vibe"')), `Expected fallback-to-vibe log; got: ${logs.join(' | ')}`);
    assert.equal(selected?.reviewerSource, 'persisted-fallback');
  });

  test('CP-1: explicit preferred reviewer is attempted first and then bounded to remaining families (TASK-2837)', () => {
    const nominations: ReadonlySet<string>[] = [];
    const { selected, errors } = select({ implementer: 'custom', preferredReviewer: 'codex', dryRun: false }, routing(['claude', 'vibe', 'custom', 'codex'], agent => agent !== 'codex', excluded => {
      nominations.push(new Set(excluded));
      return !excluded.has('claude') ? 'claude' : 'vibe';
    }));
    assert.deepEqual(selected, { reviewer: 'claude', reviewerSource: 'explicit-fallback' });
    assert.equal(errors.length, 0, errors.join(' | '));
    assert.deepEqual([...nominations[0]].sort(), ['codex', 'custom']);
  });

  test('CP-1: a dry run validates an explicit reviewer by eligibility only', () => {
    const { selected } = select({ implementer: 'custom', preferredReviewer: 'codex' }, routing(['claude', 'custom', 'codex'], () => false, () => 'claude'));
    assert.equal(selected?.reviewer, 'codex', 'a dry run launches nothing, so an eligible explicit reviewer is accepted');
    const blocked = select({ implementer: 'custom', preferredReviewer: 'codex' }, routing(['claude', 'custom'], () => true, () => 'claude'));
    assert.equal(blocked.selected, null, 'an ineligible explicit reviewer is still rejected in a dry run');
    assert.ok(blocked.errors.some(e => e.includes('Unsupported reviewer: "codex" (blocked or unsupported)')), blocked.errors.join(' | '));
  });

  test('CP-1: multi-hop fallback scans remaining eligible agents when deterministic fallback is also blocked', () => {
    const { selected, logs, errors } = select({ implementer: 'custom' }, routing(['claude', 'custom', 'codex', 'vibe'], agent => agent === 'claude' || agent === 'custom', excluded => {
      if (!excluded.has('codex')) { return 'codex'; }
      if (!excluded.has('vibe')) { return 'vibe'; }
      return 'claude';
    }));
    assert.ok(selected, `selection must scan remaining eligible agents; errors: ${errors.join(' | ')}`);
    assert.ok(logs.some(l => l.includes('Selected reviewer: claude')), `Expected selected-reviewer=claude after multi-hop; got: ${logs.join(' | ')}`);
  });

  test('CP-1: no runnable reviewer exits with error and does not mutate Backlog assignee', async () => {
    const fake = fakeReviewLoopPorts({
      routing: {
        eligibleFamilies: () => ['codex', 'claude', 'vibe'],
        launcherStatus: () => ({ supported: false, detail: 'blocked' }),
        nominate: excluded => {
          const available = ['codex', 'claude'].filter(a => !excluded.has(a));
          if (available.length === 0) { throw new Error('No agents available'); }
          return available[0];
        },
      },
    });
    await runReviewLoop({ slug: 'task-test-cp1-fallback', implementer: 'vibe', dryRun: true }, fake.ports);
    assert.deepEqual(fake.exits, [1], `Expected exit(1) when no reviewer is runnable; errors: ${fake.errors.join(' | ')}`);
    assert.ok(fake.errors.some(e => e.includes('No runnable reviewer route')), `Expected no-runnable-reviewer error; got: ${fake.errors.join(' | ')}`);
    assert.deepEqual(fake.mirrors, [], 'no Backlog mutation before a reviewer exists');
  });

  test('CP-1: single-family fallback when no different-family reviewer is runnable (unchanged)', () => {
    const { selected, logs, errors } = select({ implementer: 'claude' }, routing(['codex', 'claude', 'vibe'], agent => agent === 'claude', excluded => {
      const available = ['codex', 'vibe'].filter(a => !excluded.has(a));
      if (available.length === 0) { throw new Error('No agents available'); }
      return available[0];
    }));
    assert.ok(selected, `selection must succeed with single-family fallback; errors: ${errors.join(' | ')}`);
    assert.ok(logs.some(l => l.includes('Selected reviewer: claude')), `Expected selected-reviewer=claude (single-family); got: ${logs.join(' | ')}`);
    assert.equal(selected?.reviewerSource, 'single-family-fallback');
  });
});

// Regression provenance: TASK-2351.
describe("review loop selection", { concurrency: false }, () => {
  test('review-loop snapshot selection skips SQLite-blocked reviewer before any launch (TASK-2351)', async () => {
    const codex = agentFamily('codex');
    const claude = agentFamily('claude');
    let launchCalls = 0;
    const snapshot: AgentSelectionSnapshot = {
      capturedAtMs: 1_000,
      defaultPolicy: { eligible: [codex, claude], strategy: 'random' },
      steps: { review: { eligible: [codex, claude], strategy: 'random' } },
      agents: [
        { family: codex, launcherAvailable: true, block: { kind: 'until', untilMs: 2_000, reason: 'SQLite limit' } },
        { family: claude, launcherAvailable: true, block: { kind: 'none' } },
      ],
    };
    const reviewer = selectAgent(snapshot, 'review', { excluded: new Set() });
    if (reviewer === 'codex') { launchCalls += 1; }
    assert.equal(reviewer, 'claude');
    assert.equal(launchCalls, 0, 'blocked codex receives zero launch calls');
  });
});


test('weighted exclusion exhaustion retains single-family review recovery (TASK-2788 F1)', () => {
  const codex = agentFamily('codex');
  const claude = agentFamily('claude');
  const snapshot: AgentSelectionSnapshot = {
    capturedAtMs: 0, defaultPolicy: { eligible: [], strategy: 'random' },
    steps: { review: { eligible: [codex, claude], strategy: 'weighted', weights: { [codex]: 1, [claude]: 0 } } },
    agents: [
      { family: codex, launcherAvailable: true, block: { kind: 'none' } },
      { family: claude, launcherAvailable: false, block: { kind: 'none' } },
    ],
  };
  const port = routing(['codex', 'claude'], family => family === 'codex', excluded =>
    selectAgent(snapshot, 'review', { excluded: new Set([...excluded].map(agentFamily)) }));
  for (const persisted of [null, { reviewer: 'claude', round: 1, phase: 'reviewing' as const }]) {
    const result = select({ implementer: 'codex', dryRun: false, persisted }, port);
    assert.equal(result.selected?.reviewer, 'codex');
    assert.equal(result.selected?.reviewerSource, 'single-family-fallback');
  }
});

// PX-0046.03: availability-aware 2/1/0 reviewer policy through the existing selection and loop owners.
describe('availability-aware reviewer policy (PX-0046.03)', { concurrency: false }, () => {
  const implementer = agentFamily('codex');
  const probe = (eligible: string[], unsupported: ReadonlySet<string>, detail = (family: string) => `${family} unavailable`) => {
    const port = routing(eligible, family => !unsupported.has(family), excluded => {
      const nominee = eligible.find(family => !excluded.has(family));
      if (!nominee) { throw new Error('no eligible reviewer'); }
      return nominee;
    });
    return { eligible: () => eligible, nominate: (excluded: ReadonlySet<string>) => { try { return port.nominate(excluded); } catch { return null; } },
      runnable: (family: string) => ({ supported: port.launcherStatus(family).supported, detail: detail(family) }) };
  };

  test('2/1/0 policy table: required approvals follow actual independent availability', () => {
    const two = planReviewerPolicy({ revision: changeRevision('head-1'), implementer, primary: agentFamily('claude'), probe: probe(['codex', 'claude', 'vibe', 'qwen'], new Set()) });
    assert.deepEqual([two.mode, two.requiredApprovals, two.selected, two.independentAvailable, two.fallbackReason], ['two-independent', 2, ['claude', 'vibe'], 2, null]);
    assert.equal(two.revision, 'head-1');

    const one = planReviewerPolicy({ revision: changeRevision('head-1'), implementer, primary: agentFamily('claude'), probe: probe(['codex', 'claude', 'vibe'], new Set(['vibe'])) });
    assert.deepEqual([one.mode, one.requiredApprovals, one.selected, one.independentAvailable], ['one-independent', 1, ['claude'], 1]);
    assert.match(one.fallbackReason ?? '', /only one independent reviewer is available.*vibe: vibe unavailable/);

    const zero = planReviewerPolicy({ revision: changeRevision('head-1'), implementer, primary: implementer, probe: probe(['codex', 'claude', 'vibe'], new Set(['claude', 'vibe'])) });
    assert.deepEqual([zero.mode, zero.requiredApprovals, zero.selected, zero.independentAvailable], ['same-agent', 1, ['codex'], 0]);
    assert.match(zero.fallbackReason ?? '', /same agent reviews in a fresh context/);
    assert.doesNotMatch(JSON.stringify(zero), /human/i, 'no human verdict or waiting state is part of the policy');
  });

  test('an unavailable nominee is replaced by the next eligible family before the requirement is lowered', () => {
    const replaced = planReviewerPolicy({ revision: changeRevision('head-1'), implementer, primary: agentFamily('claude'), probe: probe(['codex', 'claude', 'vibe', 'qwen'], new Set(['vibe'])) });
    assert.deepEqual([replaced.mode, replaced.selected, replaced.unavailable.map(entry => entry.family)], ['two-independent', ['claude', 'qwen'], ['vibe']]);
  });

  test('queued capacity, unknown liveness and telemetry failure details are never read as unavailable', () => {
    for (const detail of ['queued: custom at capacity', 'probe-timeout', 'quota telemetry unreadable', 'silent for 600s']) {
      const policy = planReviewerPolicy({ revision: changeRevision('head-1'), implementer, primary: agentFamily('claude'), probe: probe(['codex', 'claude', 'vibe'], new Set(), () => detail) });
      assert.equal(policy.mode, 'two-independent', detail);
      assert.equal(policy.requiredApprovals, 2, detail);
    }
  });

  /** The real Review authority behind the serialized runner; only agent processes are faked. */
  function serializedRun(options: { eligible: string[]; unsupported?: string[]; launchFails?: string[]; verdicts?: Record<string, 'approve' | 'request-changes'>; operatorApproves?: boolean; reroute?: Record<string, string>; polled?: boolean; verdictDuringLaunch?: boolean }) {
    const slug = 'task-px-0046-03';
    const review = startReview({ change: { kind: 'local-branch', sourceBranch: `mission/${slug}`, targetBranch: 'main' }, revision: changeRevision('head-1') },
      agentFamily('claude'), implementer, '2026-11-09T10:00:00.000Z', ConfiguredReviewerEligibility.fromReviewStep({ eligible: options.eligible.map(agentFamily), strategy: 'random' }));
    const store = inMemoryTransitionStore(fixtureMission(slug, { status: 'review', assignee: implementer, review }));
    const ports = { missionStore: store, lifecycleService: new MissionLifecycleService(store) };
    const unsupported = new Set(options.unsupported ?? []);
    const reviewers: string[] = [];
    const fake = fakeReviewLoopPorts({
      slug,
      missionStore: store, lifecycle: ports.lifecycleService,
      routing: { eligibleFamilies: () => options.eligible, launcherStatus: family => ({ supported: !unsupported.has(family), detail: `${family} launcher` }),
        nominate: excluded => { const nominee = options.eligible.find(family => !excluded.has(family) && !unsupported.has(family)); if (!nominee) { throw new Error('none'); } return nominee; } },
      stateport: { ...createReviewerPolicyStatePort(slug, store),
        // The loop state mirrors the Review authority: an approved aggregate reads back as an approved round.
        read: async () => new ReviewState(slug, { round: 1, startedAt: '2026-11-09T10:00:00.000Z', reviewer: currentReviewRound(store.mission().review!).reviewer, implementer: 'codex',
          ...(reviewStatus(store.mission().review!) === 'approved' ? { phase: 'approved' as const, disposition: 'APPROVED' } : { phase: 'reviewing' as const }) }),
        ...(options.polled
          ? createReviewObservationRecorder(slug, () => 'head-1', true, ports)
          : { recordApproval: async (_state: unknown, observation?: { revision: string | null }) => { await recordApproval(slug, { comment: null, decidedAt: new Date().toISOString(), revision: observation?.revision ?? 'head-1', source: { kind: 'local' } }, ports); } }),
        persist: async next => {
          const mission = store.mission(); const round = currentReviewRound(mission.review!);
          await store.save({ ...mission, review: applyReviewStateToReview(mission.review!, { ...(next as ReviewState).toJSON(), round: round.number }) }, (await store.load()).version);
        } },
      agents: { launch: async launch => {
        if (options.launchFails?.includes(launch.agent)) { throw new Error(`${launch.agent} cannot start`); }
        const actual = options.reroute?.[launch.agent] ?? launch.agent;
        // The child's `px verdict` lands while the launch is still running, attributed to the pre-reroute round reviewer.
        if (options.verdictDuringLaunch) { await recordApproval(slug, { comment: null, decidedAt: new Date().toISOString(), revision: 'head-1', source: { kind: 'local' }, result: reviewerResultAttribution(launch.agent, { status: 0, sessionId: `${actual}-native-1` }) }, ports); }
        reviewers.push(actual); return { agent: actual, result: { status: 0, sessionId: `${actual}-native-1` } };
      } },
      ...(options.polled ? { provider: { pollReview: async () => ({ disposition: 'APPROVED' as const, revision: 'head-1', decidedAt: new Date().toISOString(), comment: null }) } } : {}),
      artifacts: { consumeReviewer: async (reviewer, _state, launch) => {
        if (options.polled) { return { consumed: true, ok: true as const, reviewState: null }; }
        if (options.verdictDuringLaunch) { return { consumed: false }; }
        if (options.operatorApproves) { await recordApproval(slug, { comment: 'operator inspected', decidedAt: new Date().toISOString(), source: { kind: 'local' } }, ports); return { consumed: true, ok: true as const, reviewState: 'APPROVED' }; }
        const verdict = options.verdicts?.[reviewer] ?? 'approve';
        const input = { comment: null, decidedAt: new Date().toISOString(), revision: 'head-1', source: { kind: 'local' as const }, result: reviewerResultAttribution(reviewer, launch?.result) };
        if (verdict === 'approve') { await recordApproval(slug, input, ports); return { consumed: true, ok: true as const, reviewState: 'APPROVED' }; }
        await recordRequestedChanges(slug, { comment: null, decidedAt: input.decidedAt, revision: input.revision, result: input.result, findings: [{ id: reviewFindingId('F1'), summary: 'counterexample', location: null }] }, ports);
        return { consumed: true, ok: true as const, reviewState: 'REQUEST_CHANGES', reviewFindings: [{ id: 'F1', summary: 'counterexample' }] };
      } },
    });
    return { fake, store, reviewers, slug, run: async (isContinue = false) => await runReviewLoop({ slug, implementer: 'codex', maxAttempts: 1, skipReviewPreparation: true, isContinue }, fake.ports) };
  }

  test('two available independent reviewers run serially and both must approve the same revision', async () => {
    const harness = serializedRun({ eligible: ['codex', 'claude', 'vibe'] });
    await harness.run();
    assert.deepEqual(harness.reviewers, ['claude', 'vibe']);
    const round = currentReviewRound(harness.store.mission().review!);
    assert.equal(round.reviewerPolicy?.requiredApprovals, 2);
    assert.equal(reviewStatus(harness.store.mission().review!), 'approved');
    assert.deepEqual(round.reviewerResults?.map(result => [result.agentFamily, result.decision, result.revision]), [['claude', 'approved', 'head-1'], ['vibe', 'approved', 'head-1']]);
    assert.ok(harness.fake.launches.every(launch => launch.sessionPolicy === 'fresh-ephemeral'));
  });

  test('one genuinely available independent reviewer requires one approval and records why', async () => {
    const harness = serializedRun({ eligible: ['codex', 'claude', 'vibe'], unsupported: ['vibe'] });
    await harness.run();
    assert.deepEqual(harness.reviewers, ['claude']);
    const policy = currentReviewRound(harness.store.mission().review!).reviewerPolicy;
    assert.deepEqual([policy?.mode, policy?.requiredApprovals, policy?.independentAvailable], ['one-independent', 1, 1]);
    assert.match(policy?.fallbackReason ?? '', /vibe/);
    assert.equal(reviewStatus(harness.store.mission().review!), 'approved');
    assert.ok(harness.fake.logs.some(line => /Reviewer policy: one-independent; 1 approval required/.test(line)), harness.fake.logs.join(' | '));
  });

  test('zero independent reviewers run the same agent in a fresh context with no human gate', async () => {
    const harness = serializedRun({ eligible: ['codex', 'claude', 'vibe'], unsupported: ['claude', 'vibe'] });
    await harness.run();
    assert.deepEqual(harness.reviewers, ['codex']);
    assert.equal(harness.fake.launches[0].sessionPolicy, 'fresh-ephemeral');
    const policy = currentReviewRound(harness.store.mission().review!).reviewerPolicy;
    assert.deepEqual([policy?.mode, policy?.requiredApprovals], ['same-agent', 1]);
    assert.equal(reviewStatus(harness.store.mission().review!), 'approved');
    assert.deepEqual(harness.fake.stops, [], 'no waiting-for-human escalation is raised');
  });

  test('a reviewer that cannot launch is replaced by an eligible family before the requirement drops', async () => {
    const harness = serializedRun({ eligible: ['codex', 'claude', 'vibe', 'qwen'], launchFails: ['claude'] });
    await harness.run();
    assert.deepEqual(harness.reviewers, ['vibe', 'qwen']);
    const round = currentReviewRound(harness.store.mission().review!);
    assert.equal(round.reviewerPolicy?.requiredApprovals, 2, 'a replacement keeps the two-approval requirement');
    assert.equal(reviewStatus(harness.store.mission().review!), 'approved');
  });

  test('with no replacement the requirement drops to one only after the lost reviewer was attempted', async () => {
    const harness = serializedRun({ eligible: ['codex', 'claude', 'vibe'], launchFails: ['vibe'] });
    await harness.run();
    assert.deepEqual(harness.reviewers, ['claude']);
    const policy = currentReviewRound(harness.store.mission().review!).reviewerPolicy;
    assert.deepEqual([policy?.mode, policy?.requiredApprovals], ['one-independent', 1]);
    assert.match(policy?.fallbackReason ?? '', /vibe: vibe cannot start/);
    assert.equal(reviewStatus(harness.store.mission().review!), 'approved');
  });

  test('when both independent launchers fail the fresh same-agent fallback runs instead of escalating (PX-0046.03 H65)', async () => {
    const harness = serializedRun({ eligible: ['codex', 'claude', 'vibe'], launchFails: ['claude', 'vibe'] });
    await harness.run();
    assert.deepEqual(harness.reviewers, ['codex']);
    const policy = currentReviewRound(harness.store.mission().review!).reviewerPolicy;
    assert.deepEqual([policy?.mode, policy?.requiredApprovals, policy?.selected], ['same-agent', 1, ['codex']]);
    assert.match(policy?.fallbackReason ?? '', /claude: claude cannot start.*vibe: vibe cannot start/);
    assert.equal(reviewStatus(harness.store.mission().review!), 'approved');
    assert.deepEqual(harness.fake.stops, []);
  });

  test('classifier clear cannot bypass the recorded two-reviewer authority (PX-0046.03 H65)', async () => {
    const s = reviewClassificationScenario();
    s.context.state.startedAt = currentReviewRound(s.store.mission().review!).startedAt;
    const policyState = createReviewerPolicyStatePort(s.context.slug, s.store);
    const context = { ...s.context, ports: { ...s.context.ports, state: { ...s.context.ports.state, ...policyState },
      routing: routing(['codex', 'claude', 'vibe'], () => true, excluded => excluded.has('claude') ? 'vibe' : 'claude'),
      artifacts: { ...s.context.ports.artifacts,
        consumeReviewer: async () => ({ consumed: true, ok: true as const, reviewState: 'REQUEST_CHANGES' }) } } };
    const outcome = await runReviewerPhase(context, new ReviewRound(2, context));
    const policy = currentReviewRound(s.store.mission().review!).reviewerPolicy;
    assert.deepEqual([policy?.mode, policy?.requiredApprovals, policy?.selected], ['two-independent', 2, ['claude', 'vibe']]);
    assert.deepEqual(s.published, [], 'the classifier cannot publish an approval while reviewer approvals are outstanding');
    assert.equal(s.attempts.at(-1)?.reason, 'reviewer-requirement-unmet');
    assert.deepEqual(outcome, { reviewState: 'REQUEST_CHANGES' }, 'the normal reviewer path still runs');
  });

  test('a negative verdict from the first reviewer is decisive and never triggers the second reviewer', async () => {
    const harness = serializedRun({ eligible: ['codex', 'claude', 'vibe'], verdicts: { claude: 'request-changes' } });
    await harness.run();
    assert.deepEqual(harness.reviewers.slice(0, 1), ['claude']);
    assert.ok(!harness.reviewers.includes('vibe'));
    assert.equal(currentReviewRound(harness.store.mission().review!).decision?.kind, 'changes-requested');
  });

  test('an operator-directed approval decides the round and owes no further reviewer launch', async () => {
    const harness = serializedRun({ eligible: ['codex', 'claude', 'vibe'], operatorApproves: true });
    await harness.run();
    assert.deepEqual(harness.reviewers, ['claude']);
    assert.equal(reviewStatus(harness.store.mission().review!), 'approved');
  });

  test('a provider-polled approval is attributed and cannot decide a round that still owes a second approval (PX-0046.03)', async () => {
    const harness = serializedRun({ eligible: ['codex', 'claude', 'vibe'], polled: true });
    await harness.run();
    assert.deepEqual(harness.reviewers, ['claude', 'vibe']);
    const round = currentReviewRound(harness.store.mission().review!);
    assert.equal(round.reviewerPolicy?.requiredApprovals, 2);
    assert.deepEqual(round.reviewerResults?.map(result => [result.agentFamily, result.decision]), [['claude', 'approved'], ['vibe', 'approved']]);
    assert.equal(reviewStatus(harness.store.mission().review!), 'approved');
    assert.deepEqual(harness.fake.stops, []);
  });

  test('a continued provider approval launches the outstanding reviewer before mirroring approval (PX-0046.03 F10)', async () => {
    const harness = serializedRun({ eligible: ['codex', 'claude', 'vibe'], polled: true });
    const state = await harness.fake.ports.state.read();
    assert.ok(state);
    await harness.fake.ports.state.recordReviewerPolicy(state, planReviewerPolicy({
      revision: changeRevision('head-1'), implementer, primary: agentFamily('claude'),
      probe: probe(['codex', 'claude', 'vibe'], new Set()),
    }));
    await recordApproval(harness.slug, {
      comment: null, decidedAt: new Date().toISOString(), revision: 'head-1', source: { kind: 'local' },
      result: reviewerResultAttribution('claude', { status: 0, sessionId: 'claude-native-1' }),
    }, { missionStore: harness.store, lifecycleService: new MissionLifecycleService(harness.store) });

    await harness.run(true);

    assert.deepEqual(harness.reviewers, ['vibe'], 'the already-approved reviewer is not relaunched');
    const round = currentReviewRound(harness.store.mission().review!);
    assert.equal(reviewStatus(harness.store.mission().review!), 'approved');
    assert.deepEqual([...new Set(round.reviewerResults?.map(result => result.agentFamily))].sort(), ['claude', 'vibe']);
    assert.equal(harness.fake.mirrors.filter(lane => lane === 'approved').length, 1, 'approval is mirrored only after the Review authority decides');
  });

  test('a launcher reroute to another independent family updates the recorded policy instead of escalating (PX-0046.03)', async () => {
    const harness = serializedRun({ eligible: ['codex', 'claude', 'vibe', 'qwen'], reroute: { claude: 'qwen' } });
    await harness.run();
    assert.deepEqual(harness.reviewers, ['qwen', 'vibe']);
    const policy = currentReviewRound(harness.store.mission().review!).reviewerPolicy;
    assert.deepEqual([policy?.mode, policy?.requiredApprovals, policy?.selected], ['two-independent', 2, ['qwen', 'vibe']]);
    assert.match(policy?.rerouted?.map(entry => entry.reason).join(' ') ?? '', /rerouted claude to qwen/);
    assert.deepEqual(policy?.unavailable, [], 'capacity rerouting is not unavailability evidence');
    assert.equal(reviewStatus(harness.store.mission().review!), 'approved');
    assert.deepEqual(harness.fake.stops, []);
  });

  test('a reroute onto an already selected family cannot lower the two-reviewer requirement (PX-0046.03 H65)', async () => {
    const harness = serializedRun({ eligible: ['codex', 'claude', 'vibe'], reroute: { claude: 'vibe' } });
    await harness.run();
    const policy = currentReviewRound(harness.store.mission().review!).reviewerPolicy;
    assert.deepEqual([policy?.mode, policy?.requiredApprovals, policy?.selected], ['two-independent', 2, ['claude', 'vibe']]);
    assert.deepEqual(policy?.unavailable, [], 'busy capacity was never established as unavailable');
    assert.deepEqual(policy?.rerouted?.map(entry => [entry.family, entry.replacedBy]), [['claude', 'vibe']]);
    assert.notEqual(reviewStatus(harness.store.mission().review!), 'approved', 'two runs of vibe cannot fabricate two approvals');
  });

  test('a verdict submitted before a reroute settles is re-attributed to the family that ran, so a replaced family never counts (PX-0046.03 F4)', async () => {
    const harness = serializedRun({ eligible: ['codex', 'claude', 'vibe', 'qwen'], reroute: { claude: 'qwen' }, verdictDuringLaunch: true });
    await harness.run();
    assert.deepEqual(harness.reviewers, ['qwen', 'vibe']);
    const round = currentReviewRound(harness.store.mission().review!);
    assert.deepEqual([...new Set(round.reviewerResults?.map(result => result.agentFamily))].sort(), ['qwen', 'vibe']);
    assert.equal(reviewStatus(harness.store.mission().review!), 'approved');
  });
});
