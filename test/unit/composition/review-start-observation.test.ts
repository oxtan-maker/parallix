import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createReviewStartPolicyPorts, createTestsActionPolicyFactory } from '../../../src/composition/review-start-observation.js';
import { DEFAULT_CONFIGURATION } from '../../../src/application/ports/configuration.js';
import type { ReviewStartObservationServices } from '../../../src/composition/review-start-observation.js';
import { mkdtemp } from '../../helpers/temp-dir.js';
import { createPolicyActionPort } from '../../../src/composition/review-policy-actions.js';
import { missionId } from '../../../src/domain/mission.js';

test('off or absent verification policy composes no review-start query boundary (TASK-2859.09)', () => {
  for (const configured of [false, true]) {
    const worktree = mkdtemp('review-start-off-');
    if (configured) {
      fs.writeFileSync(path.join(worktree, 'workflow.config.json'), JSON.stringify({ verificationPolicy: { mode: 'off' } }));
    }
    const services = new Proxy({} as ReviewStartObservationServices, {
      get: (_target, property) => assert.fail(`off mode touched ${String(property)}`),
    });
    assert.equal(createReviewStartPolicyPorts({ missionWorktree: worktree, baseBranch: 'release' },
      'task-2859.09', DEFAULT_CONFIGURATION, services), undefined);
    assert.equal(createTestsActionPolicyFactory(DEFAULT_CONFIGURATION, services)({
      rootDir: worktree, targetBranch: 'release', slug: 'task-2859.10',
    }), undefined);
  }
});

test('tests-action policy uses the integration receiving branch and existing writer (TASK-2859.10)', () => {
  const worktree = mkdtemp('tests-action-target-');
  fs.writeFileSync(path.join(worktree, 'workflow.config.json'), JSON.stringify({
    verificationPolicy: { mode: 'shadow', artifact: 'missing-policy.json' },
  }));
  const history = {};
  const services = {
    db: {}, store: {}, history, lifecycle: {}, repositoryId: 'repository-1',
  } as unknown as ReviewStartObservationServices;
  const ports = createTestsActionPolicyFactory(DEFAULT_CONFIGURATION, services)({
    rootDir: worktree, targetBranch: 'release/next', slug: 'task-2859.10',
  });
  assert.equal(ports?.targetBranch, 'release/next');
  assert.equal(ports?.writer, history);
});

test('review-start change identity uses the execution context base branch (TASK-2859.09 review 4202)', () => {
  const worktree = mkdtemp('review-start-target-');
  fs.writeFileSync(path.join(worktree, 'workflow.config.json'), JSON.stringify({
    verificationPolicy: { mode: 'shadow', artifact: 'missing-policy.json' },
  }));
  const services = {
    db: {}, store: {}, history: {}, lifecycle: {}, repositoryId: 'repository-1',
  } as unknown as ReviewStartObservationServices;
  const ports = createReviewStartPolicyPorts({ missionWorktree: worktree, baseBranch: 'release/next' },
    'task-2859.09', DEFAULT_CONFIGURATION, services);
  assert.equal(ports?.targetBranch, 'release/next');
});

test('only pilot composes policy actions bound to the loop and rebase state (TASK-2859.19, TASK-2859.20)', async () => {
  const worktree = mkdtemp('policy-actions-');
  const policy = (mode: 'shadow' | 'pilot') => ({
    configuration: { mode, artifact: 'policy.json' }, repositoryId: 'repository-1' as never, targetBranch: 'main', operationId: null,
    loadPolicy: () => ({ mode: 'fixed' as const, reason: 'missing' as const }),
    readHistory: async () => ({ ok: true as const, entries: [], record: { passed: [], failed: [] }, tests: 'unobserved' as const }),
    identity: { branchHead: () => null, changeIdentity: () => 'patch-1', onlyBookkeepingSince: () => false },
    writer: { recordReviewStartDecision: async () => true, resolveReviewEntryPin: async () => null, settleReviewStartOutcomes: async () => 0 },
    readOutcomeFacts: async () => ({ review: null, runs: [] }),
  });
  const input = (mode: 'shadow' | 'pilot') => ({ slug: 'task-2859.19', executionContext: { missionWorktree: worktree } as never,
    configuration: DEFAULT_CONFIGURATION, policy: policy(mode), policyFactory: (() => undefined) as never, missionServices: {} as never });
  assert.equal(createPolicyActionPort(input('shadow')), undefined, 'shadow runs the fixed policy with no policy action port');
  const port = createPolicyActionPort(input('pilot'));
  assert.ok(port);
  assert.equal(port.rebaseInProgress(), false);
  assert.equal((await port.select({ missionId: missionId('task-2859.19'), revision: 'abc' })).action, null,
    'an unusable policy leaves the fixed policy in charge');
});

test('outcome facts read the stored review and fail loudly when either source is unreadable (TASK-2867.06)', async () => {
  const worktree = mkdtemp('review-outcome-facts-');
  fs.writeFileSync(path.join(worktree, 'workflow.config.json'), JSON.stringify({
    verificationPolicy: { mode: 'shadow', artifact: 'missing-policy.json' },
  }));
  const review = { rounds: [], intervention: null, stageLaunches: [], reviewEvents: [] };
  const portsFor = (loaded: unknown) => createReviewStartPolicyPorts({ missionWorktree: worktree, baseBranch: 'main' },
    'task-2867.06', DEFAULT_CONFIGURATION, { db: {}, store: { load: async () => loaded }, history: {}, lifecycle: {},
      repositoryId: 'repository-1' } as unknown as ReviewStartObservationServices)!;
  const facts = await portsFor({ kind: 'found', mission: { review } }).readOutcomeFacts(missionId('task-2867.06'));
  assert.equal(facts.review, review);
  assert.deepEqual(facts.runs, [], 'a mission with no retained run has an empty run list, read from the run history');
  await assert.rejects(portsFor({ kind: 'missing' }).readOutcomeFacts(missionId('task-2867.06')), /review rounds are unavailable/);
});
