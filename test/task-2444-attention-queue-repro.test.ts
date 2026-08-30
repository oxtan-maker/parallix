import test from 'node:test';
import assert from 'node:assert/strict';

import { buildBoardMetrics, buildBoardProjection } from '../src/application/projections/board.js';
import type { BoardLane, MissionCard } from '../src/application/projections/mission-board.js';
import { agentFamily } from '../src/domain/agents.js';
import { missionId, missionLabels } from '../src/domain/mission.js';
import { repositoryId } from '../src/domain/repository.js';

const repo = repositoryId('task-2444');

function makeCard(
  id: string,
  lane: BoardLane,
  opts: Partial<Pick<MissionCard, 'blockingReason' | 'gate' | 'currentWork' | 'commands'>> = {},
): MissionCard {
  return {
    id: missionId(id), repositoryId: repo, title: id, labels: missionLabels(['user_value']),
    lane, status: lane, rawStatus: lane, closed: lane === 'done', agent: agentFamily('codex'),
    checkpoint: null, checkpointDescription: null, nextActionText: null,
    gate: opts.gate ?? 'passed', pullRequest: null, reviewApproved: false,
    reviewRound: null, reviewPhase: null, reviewDisposition: null, reviewHistory: [],
    currentWork: opts.currentWork ?? null, blockingReason: opts.blockingReason ?? null,
    flags: [], commands: opts.commands ?? [{ command: lane === 'integration' ? 'integrate' : lane === 'review' ? 'review' : 'active', enabled: true, reason: null }],
  };
}

function project(cards: readonly MissionCard[], sourceFacts: Parameters<typeof buildBoardProjection>[5] = []) {
  return buildBoardProjection(
    repo, cards, [], [],
    buildBoardMetrics({ cumulativeFlow: { series: [], missingHistoryFallback: 'null' }, medianStateTimes: { series: [], missingHistoryFallback: 'null' }, throughput: { series: [], missingHistoryFallback: 'skip' }, reviewBounceRate: { series: [], missingHistoryFallback: 'estimate' } }),
    sourceFacts,
  );
}

test('task-2444: all-backlog cards produce no attention items', () => {
  assert.equal(project([makeCard('task-2444-a', 'backlog'), makeCard('task-2444-b', 'backlog')]).attentionQueue.length, 0);
});

test('task-2444: mixed-lane attention ranks are contiguous ordinals', () => {
  const mixed = project([
    makeCard('task-2444-blocking', 'active', { blockingReason: 'decision required' }),
    makeCard('task-2444-gate', 'active', { gate: 'failed' }),
    makeCard('task-2444-review', 'review'),
    makeCard('task-2444-integrate', 'integration'),
    makeCard('task-2444-stale', 'active', { currentWork: { operationId: 'op', phase: 'execute', summary: 'stale', agent: agentFamily('codex'), updatedAt: '2026-08-30T00:00:00.000Z', freshness: 'stale' } }),
    makeCard('task-2444-backlog', 'backlog'),
  ]);
  assert.deepEqual(mixed.attentionQueue.map((item) => item.rank), [1, 2, 3, 4, 5]);
  assert.deepEqual(mixed.attentionQueue.map((item) => [item.reason.kind, item.dependsOnSources]), [
    ['blocking', ['current-work']],
    ['gate-failed', ['gate']],
    ['review-lane', ['task-markdown']],
    ['integrate-lane', ['task-markdown']],
    ['stale-work', ['current-work']],
  ]);
});

test('task-2444: queued action is enabled on its card', () => {
  const nonRunnable = project([makeCard('task-2337', 'active', {
    blockingReason: 'decision required',
    commands: [{ command: 'active', enabled: false, reason: 'ineligible' }],
  })]);
  assert.equal(nonRunnable.attentionQueue.length, 0);
});

test('task-2444: every queued reason carries source dependencies', () => {
  const queue = project([makeCard('task-2444-blocking', 'active', { blockingReason: 'decision required' })]).attentionQueue;
  assert.equal(queue.length, 1);
  assert.ok(queue.every((item) => item.dependsOnSources.length >= 1));
});

test('task-2444: source facts are deduplicated by source status and value', () => {
  const duplicateFacts = project([], [
    { source: 'task-markdown', status: 'fresh', value: 'missions/task-2444/MISSION.md' },
    { source: 'task-markdown', status: 'fresh', value: 'missions/task-2444/MISSION.md' },
  ]);
  assert.equal(duplicateFacts.sourceFacts.length, 1);
});
