import test from 'node:test';
import assert from 'node:assert/strict';

import { availableBoardCommands } from '../src/application/projections/mission-board.js';
import { agentFamily } from '../src/domain/agents.js';
import { triggerFromTransition } from '../src/domain/board-event.js';
import { missionId, missionLabels, MissionRuleViolation, type Mission, type MissionStatus } from '../src/domain/mission.js';
import { decideMission } from '../src/domain/mission-workflow.js';
import { repositoryId } from '../src/domain/repository.js';

const id = missionId('task-2445');
const repo = repositoryId('parallix');
const implementer = agentFamily('configured-implementer');

function mission(status: MissionStatus): Mission {
  return {
    id,
    repositoryId: repo,
    title: 'Prevent direct backlog activation',
    labels: missionLabels(['ai_sdlc']),
    status,
    rawStatus: status,
    closedAt: null,
    assignee: null,
    checkpoints: [],
    review: null,
    netEngineeringLines: null,
  };
}

test('activate rejects an open backlog mission', () => {
  assert.throws(
    () => decideMission(mission('backlog'), { type: 'activate', agent: implementer }),
    MissionRuleViolation,
  );
});

test('activate accepts a refined mission and records the agent as assignee', () => {
  const activated = decideMission(mission('refined'), { type: 'activate', agent: implementer });
  assert.equal(activated.status, 'active');
  assert.equal(activated.assignee, implementer);
});

test('board projection offers draft for backlog and active for refined', () => {
  const backlog = availableBoardCommands(mission('backlog'), { reviewApproval: null });
  assert.equal(backlog.find(({ command }) => command === 'draft')?.enabled, true);
  assert.deepEqual(backlog.find(({ command }) => command === 'active'), {
    command: 'active',
    enabled: false,
    reason: 'Mission must be refined before it can be activated',
  });

  const refined = availableBoardCommands(mission('refined'), { reviewApproval: null });
  assert.equal(refined.find(({ command }) => command === 'active')?.enabled, true);
  assert.equal(refined.find(({ command }) => command === 'draft')?.enabled, false);
});

test('refine is the transition that carries a backlog mission to refined', () => {
  const refined = decideMission(mission('backlog'), { type: 'refine' });
  assert.equal(refined.status, 'refined');
  // Idempotent, so a re-run of `px draft` records the same lane once.
  assert.equal(decideMission(refined, { type: 'refine' }).status, 'refined');
  assert.equal(triggerFromTransition('backlog', 'refined'), 'refine');
});

test('a backlog to active lane move is not a recognised activation trigger', () => {
  assert.equal(triggerFromTransition('backlog', 'active'), null);
});

test('refined and intake lane moves to active stay activation triggers', () => {
  assert.equal(triggerFromTransition('refined', 'active'), 'activate');
  assert.equal(triggerFromTransition(null, 'active'), 'activate');
});
