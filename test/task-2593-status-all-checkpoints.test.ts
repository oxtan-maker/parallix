// TASK-2593: `px status` presents every checkpoint of a Mission in execution
// order — planned ones with what they deliver, recorded ones with every Goal
// Check criterion and its paired evidence — not only the latest checkpoint.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createStatusBoardAdapter } from '../src/adapters/cli/commands/status-adapter.js';
import type { StatusResult } from '../src/application/ports/cli-workflows.js';
import { renderStatus, statusJson } from '../src/interfaces/cli/status.js';
import { agentFamily } from '../src/domain/agents.js';
import type { CheckpointData } from '../src/domain/checkpoint.js';
import { missionId, missionLabels, type Mission } from '../src/domain/mission.js';
import { repositoryId } from '../src/domain/repository.js';

const id = missionId('task-2593');

function cp(name: string, firstLine: string, goalCheck: CheckpointData['goalCheck'] = [], nextActionText = ''): CheckpointData {
  return { missionId: id, name, firstLine, goalCheck, nextActionText };
}

/** Two recorded checkpoints followed by two planned ones, stored in execution order. */
const checkpoints: CheckpointData[] = [
  cp('CP-1', 'Add focused coverage', [
    { criterion: 'Every checkpoint is shown', evidence: 'test/task-2593-status-all-checkpoints.test.ts' },
    { criterion: 'Evidence is shown', evidence: '`npm test`' },
  ], 'Continue with CP-2'),
  cp('CP-2', 'Update the renderer', [
    { criterion: 'Renderer lists all checkpoints', evidence: 'src/interfaces/cli/status.ts' },
  ], 'Continue with CP-3'),
  cp('CP-3', 'Document the view'),
  cp('CP-4', 'Run the gate'),
];

async function statusResult(): Promise<StatusResult> {
  const mission = {
    id,
    repositoryId: repositoryId('parallix'),
    title: 'px status all checkpoints and evidence',
    labels: missionLabels(['user_value']),
    status: 'active',
    rawStatus: 'active',
    closedAt: null,
    assignee: agentFamily('claude'),
    checkpoints,
    review: null,
    netEngineeringLines: null,
  } as Mission;
  const board = createStatusBoardAdapter({
    buildProjectionFn: async () => ({ async buildMissionCard() { return null; } } as any),
    loadMissionFn: async () => ({ mission, version: 7 }),
  });
  return {
    branch: 'mission/task-2593',
    worktree: '/repo',
    rebaseInfo: null,
    slug: 'task-2593',
    missionData: await board.getMissionData(id, '/repo'),
    prInfo: null,
    staleWorktrees: [],
    staleWorktreeRebase: {},
    agents: [],
    lastThreeCommits: [],
    uncommittedCount: 0,
  };
}

test('px status renders every planned and recorded checkpoint in execution order with its Goal Check evidence', async () => {
  const lines: string[] = [];
  renderStatus(await statusResult(), (msg) => lines.push(msg));

  const start = lines.indexOf('Checkpoints:');
  assert.ok(start >= 0, 'renders the checkpoint section');
  assert.deepEqual(lines.slice(start, start + 10), [
    'Checkpoints:',
    '  [x] CP-1: Add focused coverage',
    '      Goal Check: Every checkpoint is shown',
    '        Evidence: test/task-2593-status-all-checkpoints.test.ts',
    '      Goal Check: Evidence is shown',
    '        Evidence: `npm test`',
    '  [x] CP-2: Update the renderer',
    '      Goal Check: Renderer lists all checkpoints',
    '        Evidence: src/interfaces/cli/status.ts',
    '  [ ] CP-3: Document the view',
  ]);
  assert.equal(lines[start + 10], '  [ ] CP-4: Run the gate');
  assert.ok(lines[start + 11].startsWith('Declared gates:'), 'the checkpoint section ends after the last planned checkpoint');
  assert.ok(lines.includes('Last checkpoint: CP-2'), 'the latest recorded checkpoint is still named');
});

test('px status --json carries every checkpoint with its Goal Check evidence', async () => {
  const json = JSON.parse(statusJson(await statusResult()));
  assert.deepEqual(json.checkpoints, [
    {
      name: 'CP-1',
      description: 'Add focused coverage',
      recorded: true,
      goalCheck: [
        { criterion: 'Every checkpoint is shown', evidence: 'test/task-2593-status-all-checkpoints.test.ts' },
        { criterion: 'Evidence is shown', evidence: '`npm test`' },
      ],
    },
    {
      name: 'CP-2',
      description: 'Update the renderer',
      recorded: true,
      goalCheck: [{ criterion: 'Renderer lists all checkpoints', evidence: 'src/interfaces/cli/status.ts' }],
    },
    { name: 'CP-3', description: 'Document the view', recorded: false, goalCheck: [] },
    { name: 'CP-4', description: 'Run the gate', recorded: false, goalCheck: [] },
  ]);
});
