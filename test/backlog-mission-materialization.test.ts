import test from 'node:test';
import assert from 'node:assert/strict';

import {
  materializeBacklogMission,
  missionStatusFromBacklog,
  type BacklogMissionRecord,
  type BacklogMissionSnapshot,
} from '../src/adapters/backlog/mission-materialization.js';
import { agentFamily } from '../src/domain/agents.js';
import { missionId, missionLabels } from '../src/domain/mission.js';
import { repositoryId } from '../src/domain/repository.js';

const codex = agentFamily('codex');
const custom = agentFamily('custom');

test('Backlog adapter maps persisted and virtual queue vocabulary to domain states', () => {
  assert.deepEqual(
    ['ready', 'refined', 'approved', 'ready-for-integration', 'integration']
      .map(missionStatusFromBacklog),
    ['refined', 'refined', 'integration', 'integration', 'integration'],
  );
  assert.equal(missionStatusFromBacklog('not-a-state'), null);
});

test('missionStatusFromBacklog maps "open" to "backlog"', () => {
  assert.equal(missionStatusFromBacklog('open'), 'backlog');
  assert.equal(missionStatusFromBacklog('OPEN'), 'backlog');
  assert.equal(missionStatusFromBacklog(' Open '), 'backlog');
});

function record(overrides: Partial<BacklogMissionRecord> = {}): BacklogMissionRecord {
  return {
    id: missionId('task-2294'),
    repositoryId: repositoryId('parallix'),
    title: 'base title',
    labels: missionLabels(['user_value']),
    status: 'active',
    assignee: codex,
    checkpoints: [],
    review: null,
    netEngineeringLines: null,
    ...overrides,
  };
}

function snapshot(
  overrides: Partial<BacklogMissionSnapshot> = {},
): BacklogMissionSnapshot {
  return {
    integrationBase: { kind: 'found', mission: record(), completionRecorded: false },
    missionWorktree: { kind: 'absent' },
    closedAt: null,
    ...overrides,
  };
}

test('integration base owns lifecycle while an open worktree supplies mission content', () => {
  const result = materializeBacklogMission(snapshot({
    integrationBase: {
      kind: 'found',
      mission: record({ status: 'integration', assignee: codex }),
      completionRecorded: false,
    },
    missionWorktree: {
      kind: 'found',
      mission: record({
        title: 'new worktree title',
        labels: missionLabels(['ai_sdlc', 'bug']),
        status: 'review',
        assignee: custom,
        netEngineeringLines: 42,
      }),
    },
  }));
  assert.equal(result.kind, 'found');
  if (result.kind !== 'found') { return; }
  assert.equal(result.contentSource, 'mission-worktree');
  assert.equal(result.mission.status, 'integration');
  assert.equal(result.mission.assignee, codex);
  assert.equal(result.mission.title, 'new worktree title');
  assert.deepEqual(result.mission.labels, ['ai_sdlc', 'bug']);
  assert.equal(result.mission.netEngineeringLines, 42);
  assert.equal(result.mission.closedAt, null);
});

test('integrated mission remains open while its worktree still exists', () => {
  const result = materializeBacklogMission(snapshot({
    integrationBase: {
      kind: 'found',
      mission: record({ status: 'done', title: 'merged content' }),
      completionRecorded: true,
    },
    missionWorktree: { kind: 'unreadable' },
    closedAt: null,
  }));
  assert.equal(result.kind, 'found');
  if (result.kind !== 'found') { return; }
  assert.equal(result.contentSource, 'integration-base');
  assert.equal(result.mission.status, 'done');
  assert.equal(result.mission.closedAt, null);
});

test('worktree or uncommitted closeout state cannot outrank the committed integration base', () => {
  const result = materializeBacklogMission(snapshot({
    integrationBase: {
      kind: 'found',
      mission: record({ status: 'integration' }),
      completionRecorded: false,
    },
    missionWorktree: {
      kind: 'found',
      mission: record({ status: 'done', title: 'uncommitted closeout content' }),
    },
  }));
  assert.equal(result.kind, 'found');
  if (result.kind !== 'found') { return; }
  assert.equal(result.mission.status, 'integration');
  assert.equal(result.mission.closedAt, null);
});

test('mission closes only after integration is recorded and the worktree is absent', () => {
  const result = materializeBacklogMission(snapshot({
    integrationBase: {
      kind: 'found',
      mission: record({ status: 'done', title: 'merged content' }),
      completionRecorded: true,
    },
    missionWorktree: { kind: 'absent' },
    closedAt: '2026-07-23T10:00:00Z',
  }));
  assert.equal(result.kind, 'found');
  if (result.kind !== 'found') { return; }
  assert.equal(result.mission.status, 'done');
  assert.equal(result.mission.closedAt, '2026-07-23T10:00:00Z');
});

test('task-authority disagreements never materialize a mission', () => {
  const cases: readonly [string, BacklogMissionSnapshot, string][] = [
    ['base missing despite a worktree copy', snapshot({
      integrationBase: { kind: 'missing' },
      missionWorktree: { kind: 'found', mission: record() },
    }), 'integration-base-missing'],
    ['duplicate or ambiguous base task', snapshot({ integrationBase: { kind: 'conflict' } }), 'integration-base-conflict'],
    ['completed placement before done status', snapshot({
      integrationBase: { kind: 'found', mission: record({ status: 'review' }), completionRecorded: true },
    }), 'completion-conflict'],
    ['done status outside completed placement', snapshot({
      integrationBase: { kind: 'found', mission: record({ status: 'done' }), completionRecorded: false },
    }), 'completion-conflict'],
    ['open worktree cannot be read', snapshot({
      missionWorktree: { kind: 'unreadable' },
    }), 'worktree-unreadable'],
    ['closed mission lacks a closure time', snapshot({
      integrationBase: { kind: 'found', mission: record({ status: 'done' }), completionRecorded: true },
    }), 'closure-time-missing'],
    ['closure is recorded before worktree removal', snapshot({
      integrationBase: { kind: 'found', mission: record({ status: 'done' }), completionRecorded: true },
      missionWorktree: { kind: 'found', mission: record({ status: 'done' }) },
      closedAt: '2026-07-23T10:00:00Z',
    }), 'closure-before-worktree-removal'],
    ['worktree belongs to another mission', snapshot({
      missionWorktree: {
        kind: 'found',
        mission: record({ id: missionId('task-other') }),
      },
    }), 'identity-conflict'],
  ];

  for (const [label, input, reason] of cases) {
    assert.deepEqual(materializeBacklogMission(input), { kind: 'unavailable', reason }, label);
  }
});
