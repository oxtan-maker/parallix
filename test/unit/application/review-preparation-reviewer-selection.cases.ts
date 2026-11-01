import test from 'node:test';
import { ReviewPreparationCommandUseCase } from '../../../src/application/review-preparation-command-use-case.js';
import assert from 'node:assert/strict';
import { SLUG, ROOT, MISSION_DIR, makeRecorder, makePorts, runOptions } from "../../helpers/review-preparation-ports.js";

test("explicit review preparation reviewer bypasses automatic nomination and rejects a family outside review policy", async () => {
  const { ReviewSubmissionService } = await import('../../../src/application/review-submission-service.js');
  const { agentFamily } = await import('../../../src/domain/agents.js');
  let nominations = 0;
  const ports = makePorts(makeRecorder(), { agentSelection: {
    eligibleAgentsForStep: () => ['claude', 'codex'],
    selectAgent: () => { nominations++; return 'claude'; },
  } });
  const submission = new ReviewSubmissionService(ports);
  const explicit = submission.resolveReviewPreparationReviewAssignment('claude', { reviewer: agentFamily('codex') });
  assert.equal(explicit.reviewer, 'codex');
  assert.equal(nominations, 0);
  assert.throws(() => submission.resolveReviewPreparationReviewAssignment('claude', { reviewer: agentFamily('unknown') }), /not eligible/);
  assert.equal(nominations, 0, 'invalid explicit input never falls back');
  assert.equal(submission.resolveReviewPreparationReviewAssignment('claude').reviewer, 'claude');
  assert.equal(nominations, 1, 'omission retains automatic nomination');
});

test('explicit reviewer survives gatekeeper remediation without automatic nomination (px-0015 F1)', async () => {
  const { agentFamily } = await import('../../../src/domain/agents.js');
  const recorder = makeRecorder();
  let gatekeeperCalls = 0;
  let nominations = 0;
  const ports = makePorts(recorder, {
    gatekeeper: { runGatekeeper: () => ++gatekeeperCalls === 1
      ? { ok: false, posted: true, missing: ['required review artifact'] } : { ok: true, missing: [] } },
    agents: { startAgent: async () => { recorder.relaunches.push(1); return { agent: 'claude', result: { status: 0 } }; } },
    agentSelection: { eligibleAgentsForStep: () => ['claude', 'codex', 'custom'], selectAgent: () => { nominations++; return 'custom'; } },
  });
  const services = await ports.missionServices!(ROOT, { missionDir: MISSION_DIR });
  const transition = services.lifecycle.transition;
  const reviewers: string[] = [];
  services.lifecycle.transition = async request => {
    if (request.command.type === 'submit-for-review') { reviewers.push(request.command.review.rounds.at(-1)!.reviewer); }
    return transition(request);
  };
  const result = await new ReviewPreparationCommandUseCase(ports).performReviewPreparation(SLUG,
    runOptions(recorder, { reviewer: agentFamily('codex'), missionServicesFn: async () => services }));
  assert.equal(result.ok, true, recorder.errors.join('\n'));
  assert.equal(recorder.relaunches.length, 1);
  assert.equal(gatekeeperCalls, 2);
  assert.equal(nominations, 0);
  assert.deepEqual(reviewers, ['codex']);
});

test("ineligible explicit reviewer is refused before review preparation effects (px-0015 F2)", async t => {
  const { agentFamily } = await import('../../../src/domain/agents.js');
  const recorder = makeRecorder();
  const ports = makePorts(recorder);
  const effects = [
    t.mock.method(ports.repositoryGates, 'runPhaseGates'), t.mock.method(ports.verification, 'runVerificationGate'),
    t.mock.method(ports.rebase, 'rebaseBeforeReviewRound'), t.mock.method(ports.forgejo, 'createPr'),
    t.mock.method(ports.git, 'run'), t.mock.method(ports.gatekeeper, 'runGatekeeper'),
    t.mock.method(ports.nel, 'computeNELRecord'), t.mock.method(ports.process, 'spawnSync'),
  ];
  const services = await ports.missionServices!(ROOT, { missionDir: MISSION_DIR });
  const mutations = [t.mock.method(services.checkpoints, 'record'), t.mock.method(services.lifecycle, 'transition'), t.mock.method(services.nel, 'recordNel')];
  const result = await new ReviewPreparationCommandUseCase(ports).performReviewPreparation(SLUG, runOptions(recorder, {
    reviewer: agentFamily('execute-only'), missionServicesFn: async () => services,
    eligibleAgentsForStepFn: (step: string, options: { worktree?: string }) => {
      assert.equal(step, 'review'); assert.equal(options.worktree, ROOT); return ['codex'];
    },
  }));
  assert.equal(result.ok, false);
  assert.match(result.error ?? '', /execute-only.*not eligible.*review/);
  assert.ok([...effects, ...mutations].every(effect => effect.mock.callCount() === 0), "no review preparation effects precede review eligibility");
  assert.deepEqual(recorder.transitions, []);
});

test('explicit reviewer policy read failure returns an actionable refusal at the resolved worktree', async () => {
  const { agentFamily } = await import('../../../src/domain/agents.js');
  const recorder = makeRecorder();
  const ports = makePorts(recorder);
  const result = await new ReviewPreparationCommandUseCase(ports).performReviewPreparation(SLUG, runOptions(recorder, {
    worktree: null, reviewer: agentFamily('codex'),
    eligibleAgentsForStepFn: (_step: string, options: { worktree?: string }) => {
      assert.equal(options.worktree, ROOT); throw new Error('review policy unreadable');
    },
  }));
  assert.equal(result.ok, false);
  assert.match(result.error ?? '', /Cannot validate reviewer codex.*review policy unreadable.*retry/);
  assert.deepEqual(recorder.spawned, []);
  assert.deepEqual(recorder.transitions, []);
});
