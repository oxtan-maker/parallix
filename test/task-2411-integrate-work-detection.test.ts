import test from 'node:test';
import assert from 'node:assert/strict';

import { BoardProjectionBuilder } from '../src/application/projections/board-readers.js';
import { isWorkInProgress } from '../src/application/projections/current-work.js';
import { processLivenessProbe, processStartIdentity } from '../src/adapters/process/process-liveness.js';
import { agentFamily } from '../src/domain/agents.js';
import { missionId, missionLabels, type Mission } from '../src/domain/mission.js';
import { repositoryId } from '../src/domain/repository.js';
import { AttentionItems } from '../src/interfaces/tui/shell.js';

const repository = repositoryId('parallix');
const id = missionId('task-2411');

function integrationMission(): Mission {
  return {
    id,
    repositoryId: repository,
    title: 'Integration work',
    labels: missionLabels(['bug']),
    status: 'integration',
    closedAt: null,
    assignee: agentFamily('codex'),
    checkpoints: [],
    review: null,
    netEngineeringLines: null,
  } as Mission;
}

test('running integrate projects as working, not integrate-lane', async () => {
  const builder = new BoardProjectionBuilder(
    {
      async loadAllMissions() { return [integrationMission()]; },
      async loadMission(requested) { return requested === id ? integrationMission() : null; },
      getSourceFacts() { return []; },
    },
    { async loadReviews() { return new Map([[id, { review: null, approval: null }]]); } },
    { async loadGateStatus() { return 'passed' as const; } },
    {
      async loadAgentAvailability() { return []; },
      async loadAssignedAgent() { return agentFamily('codex'); },
      async loadRunningSessions() { return []; },
    },
    { async loadRepositoryId() { return repository; }, async loadHeadCommit() { return 'head'; } },
    { async loadOperationLog() { return []; } },
    {
      currentWork: {
        async loadCurrentWork() {
          return [{
            missionId: id,
            operationId: 'integrate:task-2411',
            phase: 'integrate' as const,
            state: 'running' as const,
            summary: 'px integrate task-2411',
            agent: null,
            processId: process.pid,
            processIdentity: processStartIdentity(process.pid),
            blockedReason: null,
            occurredAt: new Date().toISOString(),
          }];
        },
      },
      isProcessAlive: processLivenessProbe,
    },
  );

  const projection = await builder.build();
  const card = projection.stages.find((stage) => stage.lane === 'integration')?.cards[0];
  const attention = projection.attentionQueue.find((item) => item.missionId === id);

  assert.ok(isWorkInProgress(card?.currentWork));
  assert.equal(attention?.reason.kind, 'none');

  const ink = await import('ink');
  const React = await import('react');
  const output = ink.renderToString(
    React.createElement(AttentionItems, {
      queue: projection.attentionQueue,
      selectedMissionId: null,
      focusedIndex: -1,
      sourceStatusMap: new Map(),
    }),
  );
  assert.doesNotMatch(output, /task-2411/);
});
