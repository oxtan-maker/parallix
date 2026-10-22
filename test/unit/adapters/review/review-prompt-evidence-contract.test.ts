import './review-prompt-rendering.cases.js';
import { promptArtifacts } from '../../../../src/adapters/agents/prompt-artifacts.js';
import { readAgentLaunchContext } from '../../../../src/application/agent-launch-context.js';
import { promptSectionBytes } from '../../../helpers/prompt-section-metrics.js';
import { buildFreshDiagnosticRepairPrompt } from '../../../../src/application/rebound-prompts.js';
import { fixtureMission, approvedReview } from '../../../fixtures/mission-builders.js';
import { createHash } from 'node:crypto';
import type { getComments } from '../../../../src/adapters/forgejo/forgejo.js';
import type { MissionStore, MissionTransitionStore } from '../../../../src/application/domain-ports.js';
import { missionVersion } from '../../../../src/application/domain-ports.js';
import { MissionLifecycleService } from '../../../../src/application/mission-lifecycle-service.js';
import { fixtureMission as completeMissionFixture } from '../../../fixtures/mission-builders.js';
import { agentFamily as fixtureAgentFamily } from '../../../../src/domain/agents.js';
import { changeRevision as fixtureRevision } from '../../../../src/domain/review.js';
// review prompt evidence contract.
// Related scenarios share imports; each contract keeps its own hooks and mutable fixtures.
import { assembleStagePrompt } from '../../../../src/adapters/assets/runtime-assets.js';
import { buildExecutePrompt } from '../../../../src/adapters/cli/commands/active.js';
import { resolvePromptConfiguration } from '../../../../src/adapters/config/product-config.js';
import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  buildCompactReviewPrompt,
  buildCompactActOnReviewPrompt,
  buildReviewPrompt,
  buildCompletedControlsBlock,
  COMPLETED_CONTROLS_MAX_CHARS,
  COMPLETED_CONTROLS_MAX_LINES,
} from '../../../../src/adapters/review/review-prompts.js';
import { gateFailureReason } from '../../../../src/adapters/review/review-gate-handling.js';
import { runReviewLoop } from '../../../../src/application/review-loop/review-loop.js';
import { createReviewLoopPorts } from '../../../../src/adapters/review/review-loop.js';
import { ReviewState } from '../../../../src/adapters/review/review-state.js';
import { reviewStateDataFrom } from '../../../../src/adapters/review/review-state-mapping.js';
import { fakeReviewLoopPorts } from '../../../helpers/review-loop-ports.js';
import { rebound } from '../../../../src/application/rebound-kernel.js';
import { agentFamily } from '../../../../src/domain/agents.js';
import { missionId, missionLabels, type Mission } from '../../../../src/domain/mission.js';
import { repositoryId } from '../../../../src/domain/repository.js';
import { applyReviewerCommand, changeRevision, ConfiguredReviewerEligibility, startReview } from '../../../../src/domain/review.js';
import { mkdtemp as registeredMkdtemp } from '../../../helpers/temp-dir.js';

// Regression provenance: TASK-2317.
describe("context compaction", { concurrency: false }, () => {
  const repoRoot = path.resolve(import.meta.dirname, '..', '..', '..', '..');

  // TASK-2700 supersedes aborted-context compaction for automatic repairs.
  // Retain the durable reload and retry contract in the fresh conversation.
  function assertFreshRepairAuthority(prompt: string): void {
    assert.match(prompt, /You have a fresh context/);
    assert.match(prompt, /Recovery strategy: fresh-diagnostic \(1\/2\)/);
    assert.match(prompt, /Before repair, reload .*status .* --json/);
    assert.match(prompt, /locked goal, scope, success criteria, gates, review disposition and authorized repair\/checkpoint obligations/);
    assert.match(prompt, /Read applicable AGENTS\.md repository rules/);
    assert.match(prompt, /inspect the current branch revision and working-tree edits/);
    assert.match(prompt, /do not inherit prior execute\/review conversation instructions or review-approval authority/);
    assert.match(prompt, /preserve valid commits and working-tree edits/);
    assert.doesNotMatch(prompt, /compact the aborted working context/);
  }

  test('task-2317: successful declared-gate instruction compacts only after success and retains failed-gate diagnostics', () => {
    // The compaction requirement is a lifecycle mechanic, so it lives in the
    // mandatory core half of the split execute prompt (task-2465).
    const executePrompt = assembleStagePrompt('execute', { contextCompaction: true });

    assert.match(executePrompt, /Immediately after \*\*each successful mission-declared Gate\*\*, compact/i);
    assert.match(executePrompt, /Retain a failed gate's failure diagnostic/i);
    assert.match(executePrompt, /locked mission goal and scope plus committed checkpoint or successful-gate evidence/i);
  });

  function withEnabledPolicy(run: (root: string) => void): void {
    const root = registeredMkdtemp('context-policy-');
    try {
      fs.writeFileSync(path.join(root, 'workflow.config.json'), JSON.stringify({ adapters: { prompts: { contextCompaction: true } } }));
      run(root);
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  }

  test('task-2317: no-declared-gates implementation-to-act-on-review prompt compacts and reloads durable state', () => withEnabledPolicy(repoRoot => {
    const prompt = buildCompactActOnReviewPrompt({
      implementer: 'codex',
      branch: 'mission/task-2317-no-gates',
      attempt: 1,
      reviewOutcome: 'REQUEST_CHANGES',
      repoRoot,
    });

    assert.match(prompt, /Before acting on findings, compact the implementation context/i);
    assert.match(prompt, /applies even when the mission declares no gates/i);
    assert.match(prompt, /current review round and disposition; unresolved findings and implementer resolutions; and the exact revision under review/i);
  }));

  test('task-2317: reviewer round-2 prompt compacts after rebase and reloads the rewritten baseline', () => withEnabledPolicy(repoRoot => {
    const prompt = buildCompactReviewPrompt({
      reviewer: 'claude',
      implementer: 'codex',
      branch: 'mission/task-2317-rebase',
      attempt: 2,
      reviewBaseline: 'post-rebase-baseline-sha',
      repoRoot,
    });

    assert.match(prompt, /When `2` is 2 or later, before beginning this review round compact/i);
    assert.match(prompt, /exact post-rebase revision and review baseline shown by `git diff post-rebase-baseline-sha\.\.HEAD`/i);
    assert.match(prompt, /independent of the mission.s declared gates/i);
  }));

  test('repairable gate-error bounce reloads fresh authority and retains diagnostic plus retry state (TASK-2700)', async () => {
    let repairPrompt = '';
    const result = await rebound(gateFailureReason({
      ok: false,
      area: 'workflow',
      command: './scripts/verify-local.sh all',
      exitCode: 1,
      stdout: 'failing test: preserves diagnostic',
      stderr: 'assertion failed',
      error: 'verification gate failed with exit code 1',
    }), {
      slug: 'task-2317-bounce', worktree: repoRoot, implementer: 'codex',
      verify: () => ({ ok: true as const }),
      startAgent: async (_step, options) => {
        assert.equal(options.sessionPolicy, 'fresh-ephemeral');
        repairPrompt = (options.prompt as (agent: string) => string)('codex');
        return { agent: 'codex', result: { status: 0 } };
      },
      log: () => {}, error: () => {},
    });

    // TASK-2377.03: the bounce is reported fixed only after the kernel's verify
    // callback re-runs the failing check and passes.
    assert.equal(result.outcome, 'fixed');
    assertFreshRepairAuthority(repairPrompt);
    assert.match(repairPrompt, /failing test: preserves diagnostic/);
    assert.match(repairPrompt, /Retry attempt: 1\/2/);
    assert.match(repairPrompt, /Original failure evidence/);
    assert.match(repairPrompt, /Latest failure evidence/);
  });

  test('reviewer and implementer recovery relaunches reload fresh authority with retry state (TASK-2700)', async () => {
    for (const [role, expectedOutput] of [
      ['reviewer', 'a formal review outcome'],
      ['implementer', 'a disposition'],
    ] as const) {
      let repairPrompt = '';
      await rebound({ kind: 'agent-timeout', role, diagnostic: `${role} timed out`, expectedOutput }, {
        slug: 'task-2317-timeout', worktree: repoRoot, implementer: 'codex',
        startAgent: async (_step, options) => {
          assert.equal(options.sessionPolicy, 'fresh-ephemeral');
          repairPrompt = (options.prompt as (agent: string) => string)('codex');
          return { result: { status: 0 } };
        },
        verify: () => ({ ok: true as const }), log: () => {}, error: () => {},
      });

      if (role === 'implementer') { assertFreshRepairAuthority(repairPrompt); }
      else {
        assert.match(repairPrompt, /You have a fresh context/);
        assert.match(repairPrompt, /Read px status .* --json/);
        assert.match(repairPrompt, /Read applicable AGENTS.md/);
        assert.match(repairPrompt, /authority to approve/);
      }
      assert.match(repairPrompt, new RegExp(`Required output: ${expectedOutput}`));
      assert.match(repairPrompt, /Retry attempt: 1\/2/);
    }
  });

  test('task-2317: reviewer compaction follows successful rebase and baseline recapture before launch', async () => {
    const order: string[] = [];
    let baseline = 'pre-rebase-baseline-sha';
    const fake = fakeReviewLoopPorts({
      preReview: {
        rebase: async () => { order.push('rebase'); baseline = 'post-rebase-baseline-sha'; return { ok: true as const }; },
        reviewBaseline: () => { order.push('baseline'); return baseline; },
      },
      agents: { launch: async launch => { order.push(`launch:${launch.role}`); return { agent: launch.agent, result: { status: 0 } }; } },
      artifacts: { consumeReviewer: async () => ({ consumed: true, ok: true as const, reviewState: 'APPROVED' }) },
    });
    await runReviewLoop({ slug: 'task-2317-baseline', implementer: 'claude', reviewer: 'codex', maxAttempts: 1, skipHandoff: true }, fake.ports);

    const rebaseIndex = order.indexOf('rebase');
    const recaptureIndex = order.indexOf('baseline', rebaseIndex);
    const launchIndex = order.indexOf('launch:reviewer');
    assert.ok(rebaseIndex >= 0, 'review loop must rebase before reviewer launch');
    assert.ok(recaptureIndex > rebaseIndex, 'review baseline must be recaptured after successful rebase');
    assert.ok(launchIndex > recaptureIndex, 'reviewer prompt must receive the post-rebase baseline');
    assert.equal(fake.launches[0].prompt?.reviewBaseline, 'post-rebase-baseline-sha');
  });
});

// Regression provenance: TASK-2641.
describe('human review reconciliation', { concurrency: false }, () => {
  const repoRoot = path.resolve(import.meta.dirname, '..', '..', '..', '..');

  test('task-2641: an operator request for changes after agent approval launches actionable repair instead of preserving no-findings approval', async () => {
    const fake = fakeReviewLoopPorts({
      provider: {
        latestReview: async () => 'APPROVED',
      },
      artifacts: {
        consumeReviewer: async () => ({ consumed: true, ok: true as const, reviewState: 'APPROVED' }),
        consumeImplementer: async () => ({ consumed: true, ok: true as const, disposition: 'CHANGES_MADE', changedRevision: true }),
      },
      // The application seam is deliberately injected at the port boundary:
      // Forgejo retrieval belongs to the adapter, but the loop must reconcile
      // the returned operator decision before selecting or launching an agent.
      humanFeedback: { reconcile: async () => ({
        source: 'forgejo-review:91', author: 'operator', state: 'current',
        disposition: 'REQUEST_CHANGES', approval: false, reason: 'Please retain the correction.' as const,
        findings: [{ id: 'human-91', summary: 'Please retain the correction.' }],
      }) },
    });

    await runReviewLoop({
      slug: 'task-2641-human-correction', implementer: 'claude', reviewer: 'codex',
      maxAttempts: 1, skipHandoff: true,
    }, fake.ports);

    const implementerLaunch = fake.launches.find(launch => launch.role === 'implementer');
    assert.ok(implementerLaunch, 'the human request must enter an actionable repair launch');
    assert.equal(implementerLaunch.prompt?.reviewOutcome, 'REQUEST_CHANGES');
    assert.ok(fake.logs.some(line => /human-91|Please retain the correction/.test(line)),
      'the repair context must expose the operator correction rather than no findings');
    assert.ok(!fake.mirrors.includes('approved'), 'stale agent approval must not authorize continuation');
    assert.equal(fake.launches.filter(launch => launch.role === 'reviewer').length, 0,
      'a human correction must not launch a no-findings reviewer before the repair');
  });

  test('dismissed approval relaunches review on continue instead of stopping (TASK-2761)', async () => {
    let probes = 0;
    const fake = fakeReviewLoopPorts({
      slug: 'task-2641-dismissed',
      state: new ReviewState('task-2641-dismissed', { reviewer: 'codex', implementer: 'claude' }),
      provider: { pollReview: async () => { probes++; return 'APPROVED'; } },
      humanFeedback: { reconcile: async () => ({
        source: 'forgejo-review:92', author: 'operator', state: 'dismissed',
        disposition: null, approval: true, reason: 'Withdrawn approval.' as const, findings: [],
      }) },
      artifacts: { consumeReviewer: async () => ({ consumed: true, ok: true as const, reviewState: 'APPROVED' }) },
    });
    await runReviewLoop({ slug: 'task-2641-dismissed', implementer: 'claude', reviewer: 'codex', maxAttempts: 1, skipHandoff: true, isContinue: true }, fake.ports);
    assert.equal(fake.launches.filter(launch => launch.role === 'reviewer').length, 1);
    assert.equal(probes, 0, 'continuation must not reuse an existing provider decision');
    assert.ok(fake.mirrors.includes('approved'), 'only the newly launched reviewer supplies approval');
    assert.deepEqual(fake.stops, []);
  });

  test('task-2641: adapter reconciles only new human review decisions and preserves edited provider feedback', async () => {
    const events: Array<{ actor?: string; content?: string; reference?: string }> = [];
    const comments: NonNullable<Awaited<ReturnType<typeof getComments>>> = [
      { kind: 'review', id: 'agent-request', user: 'codex', isBot: false, created: '2026-10-05T10:00:00Z', updated: '2026-10-05T10:00:00Z', state: 'REQUEST_CHANGES', body: 'request changes' },
      { kind: 'review', id: 'bot-request', user: 'forgejo[bot]', isBot: true, created: '2026-10-05T10:01:00Z', updated: '2026-10-05T10:01:00Z', state: 'REQUEST_CHANGES', body: 'request changes' },
      { kind: 'issue-comment', id: 'issue-request', user: 'operator', isBot: false, created: '2026-10-05T10:02:00Z', updated: '2026-10-05T10:02:00Z', body: 'please change this' },
      { kind: 'review', id: 'human-review', user: 'operator', isBot: false, created: '2026-10-05T10:03:00Z', updated: '2026-10-05T10:03:00Z', state: 'REQUEST_CHANGES', body: 'Preserve the correction.' },
      { kind: 'inline-comment', id: 'human-inline', reviewId: 'human-review', user: 'operator', isBot: false, created: '2026-10-05T10:03:01Z', updated: '2026-10-05T10:03:01Z', state: 'REQUEST_CHANGES', location: 'src/a.ts:4', body: 'Keep this branch.' },
    ];
    const ports = createReviewLoopPorts('task-2641', { worktree: repoRoot }, {
      isProviderEnabled: () => true,
      readToken: () => 'test-token',
      getComments: async () => comments,
      createEvent: async (_slug, _type, event) => {
        events.push({ actor: event.actor, content: event.content, reference: event.followUpReference });
        return { ok: true as const, path: null };
      },
      log: () => {}, error: () => {},
    });
    const state = new ReviewState('task-2641', { reviewer: 'claude', implementer: 'codex' });

    const first = await ports.humanFeedback.reconcile(state);
    assert.equal(first?.author, 'operator');
    assert.equal(first?.disposition, 'REQUEST_CHANGES');
    assert.deepEqual(first?.findings.map(finding => finding.summary), ['Preserve the correction.', 'Keep this branch.']);
    assert.equal(events.length, 2, 'only the human review body and inline comment become audit events');
    assert.match(events[0]?.reference ?? '', /forgejo:review:human-review:2026-10-05T10:03:00Z:/);
    assert.ok(Array.isArray(state.metadata.humanFeedbackHistory));
    assert.equal(state.metadata.humanFeedbackHistory.length, 2);
    assert.equal(await ports.humanFeedback.reconcile(state), null, 'a current request is consumed instead of re-launching repair every round');

    const reloaded = ReviewState.from('task-2641', reviewStateDataFrom({
      rounds: [{ number: 1, reviewer: fixtureAgentFamily('claude'), implementer: fixtureAgentFamily('codex'), startedAt: '2026-10-05T10:00:00Z', phase: 'reviewing', disposition: null, subject: { change: { kind: 'local-branch', sourceBranch: 'mission/task-2641', targetBranch: 'main' }, revision: fixtureRevision('head') }, decision: null, response: null, reviewerRetryCount: 0, implementerRetryCount: 0 }],
      intervention: null, stageLaunches: [],
      reviewEvents: events.map((event, position) => ({ position, eventType: 'human_note', roundNumber: 1, phase: 'reviewing' as const, actor: event.actor ?? null, content: event.content ?? '', disposition: null, verdict: null, itemDispositions: null, blockedReason: null, followUpReference: event.reference ?? null, createdAt: '2026-10-05T10:00:00Z' })),
    }));
    assert.equal(await ports.humanFeedback.reconcile(reloaded), null, 'consumed sources survive a Review aggregate state reload');

    // Forgejo invalidates inline comments after a push and updates their
    // timestamps without editing their content (TASK-2750).
    comments[4] = { ...comments[4], updated: '2026-10-05T10:04:00Z' };
    assert.equal(await ports.humanFeedback.reconcile(state), null, 'timestamp-only updates do not replay human corrections');
    assert.equal(await ports.humanFeedback.reconcile(reloaded), null, 'historical source identities also suppress timestamp-only updates after reload');
    assert.equal(events.length, 2);

    comments[3] = { ...comments[3], updated: '2026-10-05T10:05:00Z', body: 'Preserve the corrected implementation.' };
    const edited = await ports.humanFeedback.reconcile(state);
    assert.equal(edited?.reason, 'Preserve the corrected implementation.');
    assert.equal(events.length, 3, 'an edited review has a new provider revision identity and is retained');
  });

  test('a current human correction on an approved round stays unrecorded and unconsumed until handled (TASK-2679)', async () => {
    const events: Array<{ reference?: string }> = [];
    const comments: NonNullable<Awaited<ReturnType<typeof getComments>>> = [{ kind: 'review', id: 'late-request', user: 'operator', isBot: false, created: '2026-10-05T10:03:00Z', updated: '2026-10-05T10:03:00Z', state: 'REQUEST_CHANGES', body: 'Late correction.' }];
    const ports = createReviewLoopPorts('task-2679', { worktree: repoRoot }, {
      isProviderEnabled: () => true,
      readToken: () => 'test-token',
      getComments: async () => comments,
      createEvent: async (_slug, _type, event) => { events.push({ reference: event.followUpReference }); return { ok: true as const, path: null }; },
      log: () => {}, error: () => {},
    });
    const approved = new ReviewState('task-2679', { reviewer: 'claude', implementer: 'codex', phase: 'approved', round: 1 });

    assert.equal((await ports.humanFeedback.reconcile(approved))?.reason, 'Late correction.');
    assert.equal((await ports.humanFeedback.reconcile(approved))?.reason, 'Late correction.', 'a retry re-observes the same correction');
    assert.equal(events.length, 0, 'no durable audit event may consume the source while the approval is effective');
    assert.deepEqual(approved.metadata.humanFeedbackSources ?? [], []);

    const revoked = new ReviewState('task-2679', { reviewer: 'claude', implementer: 'codex', phase: 'reviewing', round: 2 });
    assert.equal((await ports.humanFeedback.reconcile(revoked))?.reason, 'Late correction.');
    assert.equal(events.length, 1, 'once the approval no longer covers the round the correction is recorded');
    assert.equal(await ports.humanFeedback.reconcile(revoked), null);
  });

  // Regression provenance: TASK-2679.
  describe('approval revocation binding', () => {
    const approvedReview = applyReviewerCommand(startReview(
      { change: { kind: 'local-branch', sourceBranch: 'mission/task-2679', targetBranch: 'main' }, revision: changeRevision('abc') },
      agentFamily('custom'), agentFamily('codex'), '2026-01-01T00:00:00Z',
      ConfiguredReviewerEligibility.fromReviewStep({ eligible: [agentFamily('custom')], strategy: 'random' }),
    ), { type: 'approve', decidedAt: '2026-01-01T00:01:00Z', comment: null, source: { kind: 'local' } });
    const mission: Mission = completeMissionFixture(String(missionId('task-2679')), { id: missionId('task-2679'), repositoryId: repositoryId('repo'), title: 'revoke', labels: missionLabels([]), assignee: null, checkpoints: [], review: approvedReview, netEngineeringLines: null, status: 'integration', closedAt: null });
    const bind = (store: Partial<MissionStore>, lifecycle: Partial<Pick<MissionLifecycleService, 'transition'>>) => {
      const fullStore: MissionTransitionStore = { saveWithTransition: async () => { throw new Error('Unexpected transition save'); }, load: async () => ({ kind: 'missing' }), save: async () => { throw new Error('Unexpected review fixture save'); }, ...store };
      const service = Object.assign(new MissionLifecycleService(fullStore), lifecycle);
      return createReviewLoopPorts('task-2679', { worktree: repoRoot }, {
      missionStore: fullStore, lifecycleService: service, isProviderEnabled: () => false, log: () => {}, error: () => {},
    }).approvalRevocation!;
    };

    test('revokes the recorded approval through the operator use case and tolerates an unreachable provider', async () => {
      const commands: unknown[] = [];
      const revocation = bind(
        { async load() { return { kind: 'found' as const, mission, version: missionVersion(3) }; } },
        { async transition(request: Parameters<MissionLifecycleService['transition']>[0]) { commands.push(request.command.type); assert.equal(request.command.type, 'revoke-approval'); if (request.command.type !== 'revoke-approval') { throw new Error('Unexpected command'); } return { durableEvidence: [],  status: 'completed' as const, value: { mission: { ...mission, status: 'review', closedAt: null, review: request.command.review }, version: missionVersion(4), previousAssignee: null, from: 'integration', to: 'review', laneChanged: true } }; } },
      );
      const outcome = await revocation.revoke({ round: 1, operator: 'operator', reason: 'human change request' });
      assert.deepEqual(outcome, { ok: true });
      assert.deepEqual(commands, ['revoke-approval']);
    });

    test('reports a diagnostic when no review is recorded or the revocation is refused', async () => {
      const missing = bind({ async load() { return { kind: 'missing' as const }; } }, {});
      assert.deepEqual(await missing.revoke({ round: 1, operator: 'operator', reason: 'r' }), { ok: false, diagnostic: 'mission task-2679 has no recorded review' });
      const refused = bind(
        { async load() { return { kind: 'found' as const, mission, version: missionVersion(3) }; } },
        { async transition() { return { durableEvidence: [],  status: 'failed' as const, error: { kind: 'conflict', message: 'stale version' } }; } },
      );
      assert.deepEqual(await refused.revoke({ round: 1, operator: 'operator', reason: 'r' }), { ok: false, diagnostic: 'stale version' });
    });

    test('is unbound without a mission store, so the loop stops with guidance', () => {
      const ports = createReviewLoopPorts('task-2679', { worktree: repoRoot }, { isProviderEnabled: () => false, log: () => {}, error: () => {} });
      assert.equal(ports.approvalRevocation, null);
    });
  });

  test('task-2641: a consumed dismissed human approval still requests fresh review through the adapter', async () => {
    const events: unknown[] = [];
    const comments: NonNullable<Awaited<ReturnType<typeof getComments>>> = [{
      kind: 'review', id: 'dismissed-approval', user: 'operator', isBot: false,
      created: '2026-10-05T10:00:00Z', updated: '2026-10-05T10:00:00Z',
      state: 'APPROVED', dismissed: true, body: 'Withdrawn approval.',
    }];
    const ports = createReviewLoopPorts('task-2641', { worktree: repoRoot }, {
      isProviderEnabled: () => true,
      readToken: () => 'test-token',
      getComments: async () => comments,
      createEvent: async () => { events.push({}); return { ok: true as const, path: null }; },
      log: () => {}, error: () => {},
    });
    const state = new ReviewState('task-2641', { reviewer: 'claude', implementer: 'codex' });

    const first = await ports.humanFeedback.reconcile(state);
    assert.equal(first?.state, 'dismissed');
    assert.equal(first?.approval, true);
    assert.equal(events.length, 1, 'the human review is recorded once as an audit note');

    const repeated = await ports.humanFeedback.reconcile(state);
    assert.equal(repeated?.state, 'dismissed', 'consuming the audit note must not hide the need for fresh review');
    assert.equal(events.length, 1, 'the repeated reconciliation does not duplicate its audit note');
  });

  test('task-2641: dismissed change requests are historical, while only the newest dismissed approval stops the loop', async () => {
    const dismissedChange = fakeReviewLoopPorts({
      humanFeedback: { reconcile: async () => ({ source: 'forgejo:review:31', author: 'operator', state: 'dismissed', disposition: 'REQUEST_CHANGES', approval: false, reason: 'withdrawn' as const, findings: [] }) },
      artifacts: { consumeReviewer: async () => ({ consumed: true, ok: true as const, reviewState: 'APPROVED' }) },
    });
    await runReviewLoop({ slug: 'task-2641-dismissed-change', implementer: 'claude', reviewer: 'codex', maxAttempts: 1, skipHandoff: true }, dismissedChange.ports);
    assert.equal(dismissedChange.launches.filter(launch => launch.role === 'reviewer').length, 1);
    assert.deepEqual(dismissedChange.stops, []);
  });
});

// Regression provenance: TASK-2359.
describe("repro", { concurrency: false }, () => {
  const reviewArgs = {
    reviewer: 'codex',
    branch: 'mission/task-2359',
    implementer: 'claude',
    focus: 'all',
    attempt: 1,
    reviewBaseline: 'review-baseline-sha',
  };

  function renderedReviewPrompts(): Array<[string, string]> {
    return [
      ['buildReviewPrompt', buildReviewPrompt(reviewArgs)],
      ['buildCompactReviewPrompt', buildCompactReviewPrompt(reviewArgs)],
    ];
  }

  test('task-2359: rendered review prompts treat unrelated PR history as context only (buildReviewPrompt + buildCompactReviewPrompt)', () => {
    for (const [builder, prompt] of renderedReviewPrompts()) {
      assert.match(prompt, /PR metadata, commit ancestry, and historical commits outside `git diff review-baseline-sha\.\.HEAD` are context only/i, builder);
      assert.match(prompt, /must not produce a mission finding, request-changes verdict, or workflow block/i, builder);
    }
  });

  test('task-2359: rendered review prompts ground findings in the mission diff, checkpoint evidence, or unidentified reviewed revision', () => {
    for (const [builder, prompt] of renderedReviewPrompts()) {
      // TASK-2521.03 made `px status` the single Mission reporting surface; the
      // grounding rule itself is unchanged.
      assert.match(prompt, /findings.*grounded in `git diff review-baseline-sha\.\.HEAD`, the Mission context and checkpoint evidence reported by `px status [^`]+`, or inability to identify the reviewed revision/i, builder);
    }
  });

  test('task-2359: rendered review prompts require a finding when the mission materially worsened the inconsistency', () => {
    for (const [builder, prompt] of renderedReviewPrompts()) {
      assert.match(prompt, /mission.*introduced or materially worsened the inconsistency/i, builder);
    }
  });

  test('task-2359: rendered review prompts require a finding for materially false checkpoint evidence', () => {
    for (const [builder, prompt] of renderedReviewPrompts()) {
      assert.match(prompt, /checkpoint evidence.*materially false/i, builder);
    }
  });

  test('task-2359: rendered review prompts require a finding when the review surface cannot identify the reviewed revision', () => {
    for (const [builder, prompt] of renderedReviewPrompts()) {
      assert.match(prompt, /review surface cannot identify the (exact )?reviewed revision/i, builder);
    }
  });

  test('task-2359: rendered review prompts retain rebasing-artifact guidance', () => {
    for (const [builder, prompt] of renderedReviewPrompts()) {
      assert.match(prompt, /Rebasing Artifacts:/, builder);
      assert.match(prompt, /stale-baseline noise as rebasing artifacts, not mission changes/i, builder);
    }
  });
});

// Regression provenance: TASK-2483.
describe("completed controls", { concurrency: false }, () => {
  // task-2483: the review prompt carries a machine-derived "already-executed
  // controls" block so a reviewer does not re-run gates the workflow already ran.
  // Every assertion here pins a mission success criterion (SC2-SC7).

  type Fixture = { repoRoot: string; missionPath: string };

  function makeFixture(options: {
    gateResult?: unknown;
    gates?: unknown;
    missionBody?: string;
  } = {}): Fixture {
    const repoRoot = registeredMkdtemp('task-2483-');
    const missionDir = path.join(repoRoot, 'missions', 'task-2483');
    fs.mkdirSync(missionDir, { recursive: true });
    const missionPath = path.join(missionDir, 'MISSION.md');
    fs.writeFileSync(missionPath, options.missionBody ?? '# Mission\n');
    if (options.gateResult !== undefined) {
      fs.mkdirSync(path.join(missionDir, '.workflow'), { recursive: true });
      fs.writeFileSync(path.join(missionDir, '.workflow', 'gate-result.json'), JSON.stringify(options.gateResult));
    }
    if (options.gates !== undefined) {
      fs.writeFileSync(path.join(repoRoot, 'workflow.config.json'), JSON.stringify({ adapters: { gates: options.gates } }));
    }
    return { repoRoot, missionPath };
  }

  function nonBlankLines(block: string): string[] {
    return block.split('\n').filter(l => l.trim().length > 0);
  }

  function assertWithinBudget(block: string): void {
    assert.ok(nonBlankLines(block).length <= COMPLETED_CONTROLS_MAX_LINES,
      `block exceeded ${COMPLETED_CONTROLS_MAX_LINES} non-blank lines: ${nonBlankLines(block).length}`);
    assert.ok(block.length <= COMPLETED_CONTROLS_MAX_CHARS,
      `block exceeded ${COMPLETED_CONTROLS_MAX_CHARS} characters: ${block.length}`);
  }

  const PASSING_RECORD = {
    area: 'all',
    command: './scripts/verify-local.sh all',
    exitCode: 0,
    status: 'passed',
    recordedAt: '2026-09-11T08:15:00.000Z',
  };

  const MISSION_WITH_GATES = [
    '# Mission: example',
    '',
    '## Gates',
    '- [ ] ./scripts/verify-local.sh all',
    '- [x] `npm run typecheck`',
    '',
    '## Stop Rules',
    '- none',
    '',
  ].join('\n');

  test('task-2483: a recorded passing gate renders its command, status, exit code and timestamp (SC2)', () => {
    const { repoRoot, missionPath } = makeFixture({ gateResult: PASSING_RECORD });
    try {
      const block = buildCompletedControlsBlock(missionPath, repoRoot);
      assert.match(block, /\.\/scripts\/verify-local\.sh all/);
      assert.match(block, /status passed/);
      assert.match(block, /exitCode 0/);
      assert.match(block, /recordedAt 2026-09-11T08:15:00\.000Z/);
      assertWithinBudget(block);
    } finally {
      fs.rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  test('task-2483: a recorded failing gate is never reported as passed (ADR 0048)', () => {
    // The record deliberately lies: status says "passed" while exitCode is 2. The
    // block must trust the exit code, because only an exit code proves a run.
    const { repoRoot, missionPath } = makeFixture({
      gateResult: { ...PASSING_RECORD, exitCode: 2, status: 'passed' },
    });
    try {
      const block = buildCompletedControlsBlock(missionPath, repoRoot);
      assert.match(block, /status failed/);
      assert.match(block, /exitCode 2/);
      assert.doesNotMatch(block, /status passed/);
      assertWithinBudget(block);
    } finally {
      fs.rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  test('task-2483: no gate record, no configured gates and no mission gates degrade to one line (SC5)', () => {
    const { repoRoot, missionPath } = makeFixture();
    try {
      const block = buildCompletedControlsBlock(missionPath, repoRoot);
      assert.equal(nonBlankLines(block).length, 1);
      assert.match(block, /No verification gate result is recorded/);
      assert.match(block, /permitted/);
      assertWithinBudget(block);
    } finally {
      fs.rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  test('task-2483: an unreadable gate-result artifact degrades instead of throwing', () => {
    const { repoRoot, missionPath } = makeFixture({ gateResult: '{ not json', missionBody: MISSION_WITH_GATES });
    try {
      fs.writeFileSync(path.join(path.dirname(missionPath), '.workflow', 'gate-result.json'), '{ not json');
      const block = buildCompletedControlsBlock(missionPath, repoRoot);
      assert.match(block, /No verification gate result is recorded/);
      assert.match(block, /npm run typecheck/);
      assertWithinBudget(block);
    } finally {
      fs.rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  test('task-2483: configured preHandoff and preReview gates render with their phase key (SC3)', () => {
    const { repoRoot, missionPath } = makeFixture({
      gateResult: PASSING_RECORD,
      gates: {
        preHandoff: [{ key: 'unit', command: 'npm test', order: 1 }],
        preReview: [{ key: 'lint', command: 'npm run lint', order: 1 }],
        preIntegration: [{ key: 'e2e', command: 'npm run e2e', order: 1 }],
      },
    });
    try {
      const block = buildCompletedControlsBlock(missionPath, repoRoot);
      assert.match(block, /preHandoff gates executed by handoff: unit `npm test`/);
      assert.match(block, /preReview gates NOT yet run[^\n]*lint `npm run lint`/);
      // preIntegration has not run at review time; claiming it would be a lie.
      assert.doesNotMatch(block, /npm run e2e/);
      assertWithinBudget(block);
    } finally {
      fs.rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  test('the controls block reports handoff checked every recorded checkpoint (TASK-2662)', () => {
    const { repoRoot, missionPath } = makeFixture({ missionBody: MISSION_WITH_GATES });
    try {
      const block = buildCompletedControlsBlock(missionPath, repoRoot);
      assert.match(block, /Handoff checked every recorded checkpoint/);
      assert.match(block, /name each completed success criterion by its `criterion` text/);
      assertWithinBudget(block);
    } finally {
      fs.rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  test('task-2483: every mission `## Gates` command line appears in the block (SC4)', () => {
    const { repoRoot, missionPath } = makeFixture({ missionBody: MISSION_WITH_GATES });
    try {
      const block = buildCompletedControlsBlock(missionPath, repoRoot);
      assert.match(block, /\.\/scripts\/verify-local\.sh all/);
      assert.match(block, /npm run typecheck/);
      // Lines from a later section must not be scraped in as gates.
      assert.doesNotMatch(block, /none/);
      assertWithinBudget(block);
    } finally {
      fs.rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  test('task-2483: a declared reproduction test is never reported as an executed gate (SC7)', () => {
    // TASK-2521.03: the block used to tell the reviewer "the red-to-green
    // reproduction gate ... already ran" whenever a `Reproduction-Test:` line was
    // present in the mission document. Nothing ran it — `verifyRedGreenProof` has
    // no production caller — so this block, which is explicitly the set of
    // controls the workflow executed, was asserting a control that never ran on
    // the strength of a string an agent wrote into a file.
    const withRepro = makeFixture({
      missionBody: `${MISSION_WITH_GATES}\nReproduction-Test: test/task-2483-repro.test.ts\n`,
    });
    const withoutRepro = makeFixture({ missionBody: MISSION_WITH_GATES });
    try {
      const present = buildCompletedControlsBlock(withRepro.missionPath, withRepro.repoRoot);
      const absent = buildCompletedControlsBlock(withoutRepro.missionPath, withoutRepro.repoRoot);
      assert.doesNotMatch(present, /reproduction gate/i, 'a declared test is not an executed gate');
      assert.doesNotMatch(absent, /reproduction gate/i);
      assertWithinBudget(present);
      assertWithinBudget(absent);
    } finally {
      fs.rmSync(withRepro.repoRoot, { recursive: true, force: true });
      fs.rmSync(withoutRepro.repoRoot, { recursive: true, force: true });
    }
  });

  test('task-2483: a configured preReview gate is never reported as executed (round 1 F1)', () => {
    // submitReview runs the 'review' phase gates only for an approve outcome
    // (src/adapters/review/review-commands.ts), which is strictly after this
    // prompt is issued. Configuration is not an execution record, so the block
    // must present a preReview gate as pending, never as an already-run control
    // the reviewer may skip.
    const { repoRoot, missionPath } = makeFixture({
      gateResult: PASSING_RECORD,
      gates: {
        preHandoff: [{ key: 'unit', command: 'npm test', order: 1 }],
        preReview: [{ key: 'lint', command: 'npm run lint', order: 1 }],
      },
    });
    try {
      const block = buildCompletedControlsBlock(missionPath, repoRoot);
      const preReviewLine = block.split('\n').find(l => /preReview/.test(l));
      assert.ok(preReviewLine, 'the configured preReview gate must still be listed with its phase key (SC3)');
      assert.match(preReviewLine, /npm run lint/);
      assert.match(preReviewLine, /NOT yet run/);
      assert.doesNotMatch(preReviewLine, /\bexecuted\b/);
      // Only the handoff-phase line may claim execution.
      for (const line of block.split('\n')) {
        if (!/\bexecuted\b/.test(line)) { continue; }
        assert.doesNotMatch(line, /preReview|preIntegration/,
          `a post-review lifecycle phase was reported as executed: ${line}`);
      }
    } finally {
      fs.rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  test('task-2483: the fully-populated block stays within 12 non-blank lines and 900 characters (SC6)', () => {
    const { repoRoot, missionPath } = makeFixture({
      gateResult: PASSING_RECORD,
      gates: {
        preHandoff: [
          { key: 'unit', command: 'npm test', order: 1 },
          { key: 'typecheck', command: 'npm run typecheck', order: 2 },
        ],
        preReview: [{ key: 'lint', command: 'npm run lint -- --max-warnings 0', order: 1 }],
        preIntegration: [{ key: 'e2e', command: 'npm run e2e', order: 1 }],
      },
      missionBody: `${MISSION_WITH_GATES}\nReproduction-Test: test/task-2483-repro.test.ts\n`,
    });
    try {
      const block = buildCompletedControlsBlock(missionPath, repoRoot);
      assertWithinBudget(block);
      // Fully populated means every control family is actually present.
      for (const marker of [/Verification gate/, /Mission `## Gates`/, /preHandoff gates executed by handoff/, /preReview gates NOT yet run/, /Goal Check/]) {
        assert.match(block, marker);
      }
    } finally {
      fs.rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  test('task-2483: a long gate command is truncated rather than blowing the character budget', () => {
    const { repoRoot, missionPath } = makeFixture({
      gateResult: { ...PASSING_RECORD, command: `./scripts/verify-local.sh ${'x'.repeat(400)}` },
    });
    try {
      const block = buildCompletedControlsBlock(missionPath, repoRoot);
      assertWithinBudget(block);
      assert.match(block, /…/);
    } finally {
      fs.rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  test('task-2483: buildCompactReviewPrompt substitutes {{completedControls}} and leaks no placeholder (SC2)', () => {
    const { repoRoot, missionPath } = makeFixture({ gateResult: PASSING_RECORD, missionBody: MISSION_WITH_GATES });
    try {
      const prompt = buildCompactReviewPrompt({
        reviewer: 'codex',
        branch: 'mission/task-2483',
        implementer: 'claude',
        attempt: 1,
        repoRoot,
        missionPath,
      });
      assert.doesNotMatch(prompt, /\{\{completedControls\}\}/);
      assert.doesNotMatch(prompt, /\{\{/);
      assert.match(prompt, /status passed/);
      assert.match(prompt, /exitCode 0/);
      assert.match(prompt, /recordedAt 2026-09-11T08:15:00\.000Z/);
      assert.match(prompt, /\.\/scripts\/verify-local\.sh all/);
    } finally {
      fs.rmSync(repoRoot, { recursive: true, force: true });
    }
  });
});


test('checkpoint, successful-gate and review lifecycle prompts share default-on and opt-out policy (TASK-2737)', () => {
  const root = registeredMkdtemp('prompt-policy-');
  try {
    fs.writeFileSync(path.join(root, 'opinion.md'), 'Repository opinion retained.');
    for (const enabled of [undefined, false, true]) {
      fs.writeFileSync(path.join(root, 'workflow.config.json'), JSON.stringify({ adapters: { prompts: {
        override: 'opinion.md', ...(enabled === undefined ? {} : { contextCompaction: enabled }),
      } } }));
      const execute = buildExecutePrompt('task-2737', 'CP-1 pending', { rootDir: root });
      const review = buildCompactReviewPrompt({ reviewer: 'codex', implementer: 'claude', branch: 'mission/task-2737', attempt: 2, repoRoot: root, reviewBaseline: 'baseline' });
      const repair = buildCompactActOnReviewPrompt({ implementer: 'claude', branch: 'mission/task-2737', attempt: 2, repoRoot: root });
      for (const prompt of [execute, review, repair]) {
        if (enabled !== false) { assert.match(prompt, /compact (?:your working|the prior-round working|the implementation) context/); }
        else { assert.doesNotMatch(prompt, /compact (?:your working|the prior-round working|the implementation) context/i); }
        assert.match(prompt, /Repository opinion retained/);
        assert.match(prompt, /locked mission goal|mission goal, scope/);
        assert.doesNotMatch(prompt, /\{\{/);
      }
      if (enabled !== false) {
        assert.match(execute, /Immediately after recording a checkpoint's evidence, compact your working context/);
        assert.match(execute, /each successful mission-declared Gate\*\*, compact your working context/);
      }
      assert.match(execute, /Immediately after recording a checkpoint's evidence/);
      assert.match(execute, /each successful mission-declared Gate/);
      assert.match(execute, /Retain a failed gate's failure diagnostic while repairing it/);
      assert.match(execute, /every success criterion is marked complete/);
      assert.match(execute, /do not change the Backlog task's status/);
      assert.match(review, /unresolved findings and implementer resolutions/);
      assert.match(review, /git diff baseline\.\.HEAD/);
      assert.match(review, /Separation of duties/);
      assert.match(repair, /applies even when the mission declares no gates/);
      assert.match(repair, /px resolve --slug/);
    }
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('self-development and shipped templates inherit the consumer default-on prompt path (TASK-2737)', () => {
  const root = path.resolve(import.meta.dirname, '../../../..');
  assert.equal(resolvePromptConfiguration(root).contextCompaction, true);
  const config = JSON.parse(fs.readFileSync(path.join(root, 'workflow.config.json'), 'utf8'));
  assert.equal(config.adapters?.prompts?.contextCompaction, undefined);
  function checkTemplates(dir: string): void {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) { checkTemplates(file); }
      else { assert.doesNotMatch(fs.readFileSync(file, 'utf8'), /contextCompaction/); }
    }
  }
  checkTemplates(path.join(root, 'templates'));
  assert.match(buildExecutePrompt('task-2737', '', { rootDir: root }), /compact (?:your working|the prior-round working|the implementation) context/i);
  assert.match(buildCompactActOnReviewPrompt({ implementer: 'codex', branch: 'mission/task-2737', attempt: 2, repoRoot: root }), /compact (?:your working|the prior-round working|the implementation) context/i);
});

test('TASK-2746-shaped review and act-on-review history has bounded inline UTF-8 growth (TASK-2761)', async context => {
  const root = registeredMkdtemp('prompt-growth-');
  try {
    const contract = 'Complete contract 完整 🌍\n'.repeat(9000);
    const findings = 'F1: preserve this current finding and outstanding obligation';
    const dossier = 'Retained incident: command failed; all repair obligations remain';
    const verification = 'npm test: exact receipt assertion failed on parent';
    const obligation = 'Human: retain the unfulfilled security check';
    const review = approvedReview('task-2761');
    const current = { ...review.rounds[0], number: 1001, decision: null, phase: 'reviewing' as const,
      disposition: null, implementerResponseContent: findings + '\n' + dossier + '\n' + verification };
    const artifacts = new Map<string, string>();
    const retained = { async retain(content: string) {
      const reference = '/worktree/.workflow/agent-context/' + createHash('sha256').update(content).digest('hex') + '.json';
      artifacts.set(reference, content);
      return reference;
    } };
    const sizes: Record<string, number[]> = { review: [], actOnReview: [] };
    const measured: unknown[] = [];
    for (const count of [1, 10, 100]) {
      const history = Array.from({ length: count }, (_, number) => ({ ...review.rounds[0], number: number + 1,
        implementerResponseContent: findings.repeat(200) }));
      const mission = fixtureMission('task-2761', {
        brief: { goal: 'Deliver the complete contract', why: 'Oversized launches', scope: 'Transport and compaction', outOfScope: ['No truncation'] },
        successCriteria: ['Transport exact bytes', obligation], declaredGates: ['npm test'],
        checkpoints: [{ missionId: missionId('task-2761'), name: 'CP-1', firstLine: 'Retained proof',
          goalCheck: [{ criterion: 'Transport exact bytes', evidence: contract.repeat(3) }], nextActionText: 'Retain all proof' }],
        review: { ...review, rounds: [history[0]!, ...history.slice(1), current], reviewEvents: [{
          position: 1, eventType: 'human_note', roundNumber: 1, phase: null, actor: 'operator',
          content: obligation, disposition: null, verdict: null, itemDispositions: null,
          blockedReason: null, followUpReference: null, createdAt: '2026-08-04T10:31:00Z',
        }] },
      });
      const snapshot = await readAgentLaunchContext({ async load() { return { kind: 'found', mission, version: missionVersion(1) }; } }, 'task-2761', retained);
      const value = JSON.parse(snapshot.slice(snapshot.indexOf('{')));
      assert.deepEqual(value.brief, mission.brief);
      assert.deepEqual(value.successCriteria, mission.successCriteria);
      assert.deepEqual(value.declaredGates, mission.declaredGates);
      assert.deepEqual(value.checkpoints, mission.checkpoints);
      assert.deepEqual(value.review.currentRound, current);
      assert.ok(value.review.inheritedObligations.findings.some((finding: { summary: string }) => finding.summary === obligation));
      const archived = JSON.parse(artifacts.get(value.review.fullReviewArtifact)!);
      assert.deepEqual(archived, mission.review, 'full history, human obligations and metadata remain readable');
      assert.match(artifacts.get(value.review.fullReviewArtifact)!, /unfulfilled security check/);
      assert.match(snapshot, /Read fullReviewArtifact before/);
      for (const [role, stage] of Object.entries({
        review: buildCompactReviewPrompt({ reviewer: 'claude', implementer: 'codex', branch: 'mission/task-2761', attempt: count, repoRoot: root }),
        actOnReview: buildCompactActOnReviewPrompt({ implementer: 'codex', branch: 'mission/task-2761', attempt: count, repoRoot: root }),
      })) {
        // Diff and verification are reload instructions here, never inline artifacts.
        // Include every byte of references, metadata, framing and stage instructions.
        const priorRoundHistory = JSON.stringify(value.review).replace(dossier, '').replace(verification, '');
        const sections = { contract: JSON.stringify({ ...value, review: undefined }), priorRoundHistory,
          diff: (stage.match(/git diff[^`\n]+/g) ?? []).join('\n'), incidentOrRecoveryDossier: dossier, verificationOutput: verification,
          framing: stage + snapshot.slice(0, snapshot.indexOf('{')) };
        const bytes = promptSectionBytes(sections);
        const rendered = snapshot + '\n\n' + stage;
        const total = Buffer.byteLength(rendered);
        // JSON indentation, braces and separators are framing too.
        bytes.framing += total - bytes.total;
        bytes.total = total;
        assert.equal(Object.entries(bytes).filter(([key]) => key !== 'total').reduce((sum, [, n]) => sum + n, 0), total);
        assert.ok(bytes.contract > 188583, 'mandatory contract is never capped');
        sizes[role].push(total);
        measured.push({ role, rounds: count, ...bytes });
      }
    }
    for (const values of Object.values(sizes)) {
      assert.ok(Math.max(...values) - Math.min(...values) <= 8, 'fixed required inputs: history references, metadata and framing grow by at most eight UTF-8 bytes across 1/10/100 rounds');
    }
    // Older references remain available after subsequent rounds publish new ones.
    assert.equal(artifacts.size, 3);
    context.diagnostic(JSON.stringify(measured));
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('identical recovery evidence is delivered once while changed diagnostics remain complete (TASK-2761)', () => {
  const originalDiagnostic = 'retained evidence 完整 🌍\n'.repeat(100);
  const slots = { label: 'FAILURE', slug: 'task-2761', area: 'review', facts: [] as Array<[string, string]>,
    diagnostic: originalDiagnostic, originalDiagnostic,
    classification: { failureClass: 'IncompleteEvidence', dispatchAction: 'AutoSendBack', isRelaunchable: true, label: 'evidence' } as const,
    attempt: 1, maxAttempts: 2, remedy: 'Preserve all obligations' };
  const compact = buildFreshDiagnosticRepairPrompt(slots);
  assert.equal(compact.split('retained evidence 完整 🌍').length - 1, 100);
  assert.match(compact, /identical to original failure evidence/);
  const changed = buildFreshDiagnosticRepairPrompt({ ...slots, diagnostic: 'new outstanding obligation' });
  assert.match(changed, /new outstanding obligation/);
  assert.match(changed, /Preserve all obligations/);
});


test('prompt history artifacts are private, immutable and survive subsequent rounds (TASK-2761)', async () => {
  const root = registeredMkdtemp('prompt-artifacts-');
  try {
    const artifacts = promptArtifacts(root);
    const first = await artifacts.retain('first complete review 🌍');
    const second = await artifacts.retain('second review: unresolved F1');
    assert.notEqual(first, second);
    assert.equal(await artifacts.retain('first complete review 🌍'), first);
    assert.equal(fs.readFileSync(first, 'utf8'), 'first complete review 🌍');
    assert.equal(fs.readFileSync(second, 'utf8'), 'second review: unresolved F1');
    assert.equal(fs.statSync(first).mode & 0o777, 0o600);
    assert.ok(first.startsWith(path.join(root, '.workflow', 'agent-context')));
    fs.writeFileSync(first, 'corrupted');
    await assert.rejects(artifacts.retain('first complete review 🌍'));
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

for (const kind of ['agent-timeout', 'artifact-incomplete'] as const) {
  test(`combined reviewer ${kind} retry preserves verdict authority (px-0017)`, async () => {
    const root = registeredMkdtemp('reviewer-retry-authority-');
    try {
      let combined = '';
      const result = await rebound({ kind, role: 'reviewer', diagnostic: 'No valid verdict' }, {
        slug: 'px-fixture', worktree: root, implementer: 'claude', role: 'reviewer', maxAttempts: 1,
        repairCheckpoints: { open: async () => assert.fail('reviewer retry cannot open a repair checkpoint'),
          verify: async () => assert.fail('reviewer output is not implementer certification'), readBlocker: async () => undefined },
        startAgent: async (_step, options) => {
          combined = buildCompactReviewPrompt({ reviewer: 'claude', implementer: 'codex', branch: 'mission/px-fixture', attempt: 1, repoRoot: root })
            + '\n' + (typeof options.prompt === 'function' ? options.prompt('claude') : options.prompt);
          return { agent: 'claude', result: { status: 0 } };
        }, verify: () => ({ ok: true }),
      });
      assert.equal(result.outcome, 'fixed');
      assert.match(combined, /authority to approve a correct fix/);
      assert.match(combined, /px verdict approve/);
      assert.doesNotMatch(combined, /Commit tracked repair|Harness-created repair checkpoint|do not self-approve|do not inherit.*review-approval authority/);
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });
}
