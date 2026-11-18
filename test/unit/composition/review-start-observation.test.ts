import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createReviewStartPolicyPorts, createTestsActionPolicyFactory } from '../../../src/composition/review-start-observation.js';
import { DEFAULT_CONFIGURATION } from '../../../src/application/ports/configuration.js';
import type { ReviewStartObservationServices } from '../../../src/composition/review-start-observation.js';
import { mkdtemp } from '../../helpers/temp-dir.js';

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
