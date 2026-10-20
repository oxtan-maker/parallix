// Publication credentials and authoritative implementer identity, using isolated handoff ports.
import test from 'node:test';
import assert from 'node:assert/strict';
import { agentFamily } from '../../../src/domain/agents.js';
import { startReview, changeRevision, ConfiguredReviewerEligibility } from '../../../src/domain/review.js';
import { HandoffCommandUseCase } from '../../../src/application/handoff-command-use-case.js';
import { SLUG, ROOT, BRANCH, MISSION_DIR, RECORDED_MISSION_LOAD, makeRecorder, makePorts, runOptions } from '../../helpers/handoff-ports.js';

test('missing implementer credentials use Parallix publication fallback without changing implementer (TASK-2778)', async () => {
  const recorder = makeRecorder();
  const publications: string[] = [];
  const implementers: unknown[] = [];
  const ports = makePorts(recorder, {
    productConfig: { isForgejoReviewEnabled: () => true },
    backlog: { transitionTask: (_slug, _status, options) => { implementers.push(options.implementer); return true; } },
    forgejo: { readToken: user => user === 'human' ? 'owner-token' : null,
      createPr: (_branch, user, token) => { publications.push(`${user}:${token}`); return { ok: true }; } },
    setupReview: { bootstrapReviewSurface: async () => ({ ok: false, error: 'fixture bootstrap denied' }) },
  });
  const result = await new HandoffCommandUseCase(ports).performHandoff(SLUG, runOptions(recorder));
  assert.equal(result.ok, true, result.error ?? '');
  assert.deepEqual(publications, ['human:owner-token']);
  assert.deepEqual(implementers, ['claude']);
});
test('handoff stops when neither implementer nor Parallix credentials are available (TASK-2778)', async () => {
  const recorder = makeRecorder();
  const ports = makePorts(recorder, {
    productConfig: { isForgejoReviewEnabled: () => true },
    forgejo: { readToken: () => null, createPr: () => assert.fail('no unauthenticated publication') },
    setupReview: { bootstrapReviewSurface: async () => ({ ok: false, error: 'fixture bootstrap denied' }) },
  });
  const result = await new HandoffCommandUseCase(ports).performHandoff(SLUG, runOptions(recorder));
  assert.equal(result.ok, false);
  assert.match(result.error ?? '', /Parallix publication credentials are also unavailable/);
});
test('handoff publishes as the database implementer, never its reviewer (TASK-2778 F1)', async () => {
  const recorder = makeRecorder();
  const published: string[] = [];
  const ports = makePorts(recorder, { productConfig: { isForgejoReviewEnabled: () => true },
    agentSelection: { selectAgent: () => 'claude' },
    forgejo: { createPr: (_branch, user, token) => { published.push(`${user}:${token}`); return { ok: true }; },
      readToken: user => `${user}-token` },
  });
  const services = await ports.missionServices!(ROOT, { missionDir: MISSION_DIR });
  services.store.load = async () => ({ ...RECORDED_MISSION_LOAD, mission: {
    ...RECORDED_MISSION_LOAD.mission, assignee: agentFamily('codex'),
  } });
  const result = await new HandoffCommandUseCase({ ...ports, missionServices: async () => services }).performHandoff(SLUG, runOptions(recorder));
  assert.equal(result.ok, true, recorder.errors.join('\n'));
  assert.deepEqual(published, ['codex:codex-token']);
});
test('PR 739 assignee/review drift stops before publication (TASK-2778 F1)', async () => {
  const recorder = makeRecorder();
  const review = startReview({ change: { kind: 'local-branch', sourceBranch: BRANCH, targetBranch: 'main' }, revision: changeRevision('head') },
    agentFamily('claude'), agentFamily('codex'), '2026-10-19T10:00:00Z',
    ConfiguredReviewerEligibility.fromReviewStep({ eligible: [agentFamily('claude')], strategy: 'random' }));
  const ports = makePorts(recorder, { productConfig: { isForgejoReviewEnabled: () => true },
    forgejo: { createPr: () => assert.fail('must not publish a drifted identity') },
  });
  const services = await ports.missionServices!(ROOT, { missionDir: MISSION_DIR });
  services.store.load = async () => ({ ...RECORDED_MISSION_LOAD, mission: {
    ...RECORDED_MISSION_LOAD.mission, assignee: agentFamily('claude'), review,
  } });
  const result = await new HandoffCommandUseCase({ ...ports, missionServices: async () => services }).performHandoff(SLUG, runOptions(recorder));
  assert.equal(result.ok, false);
  assert.match(result.error ?? '', /implementer identity.*(disagree|mismatch|drift)/i);
});
