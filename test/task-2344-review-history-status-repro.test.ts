import test from 'node:test';
import assert from 'node:assert/strict';

import status from '../src/adapters/cli/commands/status.js';
import { ConcreteReviewReadAdapter } from '../src/adapters/backlog/concrete-review-read-adapter.js';
import { projectReviewHistory } from '../src/application/projections/mission-board.js';
import { missionVersion, type MissionLoadResult, type MissionStore, type MissionVersion } from '../src/application/domain-ports.js';
import { agentFamily } from '../src/domain/agents.js';
import { missionId, missionLabels, type Mission, type MissionId } from '../src/domain/mission.js';
import { repositoryId } from '../src/domain/repository.js';
import type { Review, ReviewFinding, ReviewRound } from '../src/domain/review.js';

const slug = missionId('task-2344');

function round(
  number: number,
  reviewer: 'codex' | 'claude',
  disposition: 'PUSHBACK_ALL' | 'BLOCKED',
  finding: ReviewFinding | null,
): ReviewRound {
  return {
    number,
    subject: {
      change: { kind: 'local-branch', sourceBranch: 'mission/task-2344', targetBranch: 'main' },
      revision: `revision-${number}` as any,
    },
    reviewer: agentFamily(reviewer),
    implementer: agentFamily('codex'),
    startedAt: `2026-08-0${number}T10:00:00Z`,
    decision: finding ? {
      kind: 'changes-requested',
      decidedAt: `2026-08-0${number}T11:00:00Z`,
      comment: disposition,
      findings: [finding],
    } : null,
    response: number === 1 ? {
      kind: 'resolved',
      respondedAt: '2026-08-01T12:00:00Z',
      resultingRevision: 'revision-2' as any,
      resolutions: [
        { findingId: 'finding-fixed' as any, kind: 'fixed', evidence: 'guard added' },
        { findingId: 'finding-pushback' as any, kind: 'disputed', rationale: 'already covered' },
      ],
    } : null,
    phase: number === 1 ? 'fixing' : 'reviewing',
    disposition,
    reviewerRetryCount: 0,
    implementerRetryCount: 0,
  };
}

test('px status task-2344 renders every persisted review round with earlier findings and resolutions', async () => {
  const rounds = [
    round(1, 'codex', 'PUSHBACK_ALL', {
      id: 'finding-fixed' as any,
      summary: 'earlier-round finding',
      location: 'src/example.ts:1',
    }),
    round(2, 'claude', 'BLOCKED', null),
  ] as [ReviewRound, ...ReviewRound[]];
  const review: Review = {
    rounds,
    intervention: null,
    stageLaunches: [],
    gateFailureRetryCount: 0,
    hookFailureRetryCount: 0,
    reviewEvents: [],
  };
  const mission: Mission = {
    id: slug,
    repositoryId: repositoryId('task-2344-test'),
    title: 'Review history status regression',
    labels: missionLabels(['bug']),
    assignee: null,
    status: 'review',
    closedAt: null,
    checkpoints: [],
    review,
    netEngineeringLines: null,
  };
  const store: MissionStore = {
    async load(_id: MissionId): Promise<MissionLoadResult> {
      return { kind: 'found', mission, version: missionVersion(1) };
    },
    async save(_mission: Mission, _expectedVersion: MissionVersion | null): Promise<MissionVersion> {
      return missionVersion(1);
    },
  };
  const persistedReview = await new ConcreteReviewReadAdapter({
    rootDir: process.cwd(),
    missionStore: store,
    readReviewState: () => null,
  }).loadReview(slug);
  assert.ok(persistedReview);

  const lines: string[] = [];
  await status(['task-2344'], {
    log: (line: string) => lines.push(line),
    exit: () => {},
    inferSlugFn: () => 'task-2344',
    getCurrentBranchFn: () => 'mission/task-2344',
    detectRebaseStateFn: () => ({ inProgress: false, detached: false, unmergedFiles: [] }),
    getPrStatusFn: () => ({ exists: false }),
    readAgentConfigOrExitFn: () => ({}),
    eligibleAgentsForStepFn: () => [],
    allWorkflowAgentNamesFn: () => [],
    workflowLauncherStatusFn: () => ({ supported: true }),
    getLastThreeCommitsFn: () => [],
    getUncommittedCountFn: () => 0,
    buildProjectionFn: async () => ({
      build: async () => ({
        stages: [{ cards: [{
          id: slug,
          status: 'review',
          rawStatus: 'review',
          checkpoint: null,
          checkpointDescription: null,
          reviewRound: 2,
          reviewPhase: 'reviewing',
          reviewDisposition: 'BLOCKED',
          reviewHistory: projectReviewHistory(persistedReview),
        }] }],
      }),
    }),
  });

  const output = lines.join('\n');
  assert.match(output, /Round 1 \[codex -> codex\]: PUSHBACK_ALL/);
  assert.match(output, /Round 2 \[claude -> codex\]: BLOCKED/);
  assert.match(output, /finding: earlier-round finding/);
  assert.match(output, /fixed: finding-fixed: guard added/);
  assert.match(output, /pushback: finding-pushback: already covered/);
});
