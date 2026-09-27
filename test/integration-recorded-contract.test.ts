import test from 'node:test';
import assert from 'node:assert/strict';
import { createIntegrationPreflight } from '../src/application/integrate/preflight.js';
import { createIntegrationContextBuilder } from '../src/application/integrate/context.js';
import type { IntegrateWorkflowPorts } from '../src/application/ports/integrate-workflow.js';

function fixture() {
  let searches = 0;
  const ports = {
    missionPaths: {
      findMissionDir: () => null,
      resolveWorktree: () => '/mission',
      missionBranchName: () => 'mission/task-2543',
      missionDirForSlug: () => '/base/missions/task-2543',
      findMissionDocInBranches: () => { searches++; return []; },
      conventionalWorktreePath: () => process.cwd(),
    },
    backlog: {
      resolveTaskFile: () => ({ ok: true, taskFile: '/mission/backlog/tasks/task-2543.md' }),
      getTaskAssignee: () => 'codex',
      getTaskClassification: () => 'ai_sdlc',
    },
    productConfig: { isForgejoReviewEnabled: () => false },
    git: {
      getCurrentBranch: () => 'mission/task-2543',
      git: (args: string[]) => ({ status: 0, stdout: args.includes('branch') ? 'main' : '', stderr: '' }),
      detectRebaseState: () => ({ inProgress: false }),
    },
    checkout: { getUnresolvedIndexConflicts: () => ({ ok: true, files: [] }) },
    fileSystem: { existsSync: () => false },
    forgejo: {}, review: {}, landing: {},
    stateMap: { toVirtual: () => 'ready-for-integration' },
  } as unknown as IntegrateWorkflowPorts;
  return { ports, searches: () => searches };
}

for (const recorded of [true, false]) {
  test(`integration ${recorded ? 'accepts a recorded brief without files' : 'explains how to recover a missing historical contract'}`, async () => {
    const { ports, searches } = fixture();
    const context = await createIntegrationContextBuilder(ports).buildIntegrationContext('task-2543', {
      baseBranch: 'main', baseWorktree: '/base',
    });
    assert.equal(context.area, 'all', 'missing mission files must not narrow verification to docs');
    const lines: string[] = [];
    const result = createIntegrationPreflight(ports).printIntegrationPreflight({
      ...context, missionStatus: 'integration',
      missionBrief: recorded ? { goal: 'repair', why: 'unblock integration', scope: null, outOfScope: [] } : null,
    }, { log: line => lines.push(line) });
    assert.deepEqual(result.failures, recorded ? [] : ['mission-doc']);
    assert.equal(searches(), recorded ? 0 : 1);
    if (!recorded) {
      assert.match(lines.join('\n'), /Mission doc: missions\/task-2543\/MISSION.md not found/);
      assert.match(lines.join('\n'), /px status task-2543 --json/);
      assert.match(lines.join('\n'), /px import-legacy --existing-only/);
      assert.match(lines.join('\n'), /px goal set/);
    }
  });
}
