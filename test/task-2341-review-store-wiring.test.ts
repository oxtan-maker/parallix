import test from 'node:test';
import assert from 'node:assert/strict';

import { ConcreteReviewReadAdapter } from '../src/adapters/backlog/concrete-review-read-adapter.js';
import type { MissionStore } from '../src/application/domain-ports.js';
import { missionVersion } from '../src/application/domain-ports.js';
import { agentFamily } from '../src/domain/agents.js';
import { missionId, missionLabels, type Mission } from '../src/domain/mission.js';
import { repositoryId } from '../src/domain/repository.js';
import { changeRevision } from '../src/domain/review.js';

const reviewMission: Mission = {
  id: missionId('task-2341'),
  repositoryId: repositoryId('parallix'),
  title: 'Review state is stored in the operator database',
  labels: missionLabels(['bug']),
  status: 'review',
  closedAt: null,
  assignee: agentFamily('codex'),
  checkpoints: [],
  netEngineeringLines: null,
  review: {
    rounds: [{
      number: 1,
      subject: {
        change: { kind: 'local-branch', sourceBranch: 'mission/task-2341', targetBranch: 'main' },
        revision: changeRevision('reviewed-revision'),
      },
      reviewer: agentFamily('codex'),
      implementer: agentFamily('custom'),
      startedAt: '2026-08-04T12:00:00.000Z',
      decision: null,
      response: null,
      phase: 'reviewing',
      disposition: null,
      reviewerRetryCount: 0,
      implementerRetryCount: 0,
    }],
    intervention: null,
    stageLaunches: [],
    gateFailureRetryCount: 0,
    hookFailureRetryCount: 0,
    reviewEvents: [],
  },
};

const missionStore: MissionStore = {
  async load() {
    return { kind: 'found', mission: reviewMission, version: missionVersion(1) };
  },
  async save() {
    return missionVersion(1);
  },
};

test('ConcreteReviewReadAdapter returns a Review when its MissionStore has persisted review data', async () => {
  const adapter = new ConcreteReviewReadAdapter({
    rootDir: process.cwd(),
    missionStore,
  });

  const review = await adapter.loadReview(missionId('task-2341'));

  assert.notEqual(review, null);
  assert.equal(review?.rounds[0].phase, 'reviewing');
});
