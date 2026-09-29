import test from 'node:test';
import assert from 'node:assert/strict';
import { createIntegrateWorkflow } from '../src/application/integrate-workflow.js';

test('a second integrate for the same mission stops before reading or changing mission state', async () => {
  let held = false;
  let releaseFirst: (() => void) | undefined;
  let enteredFirst: (() => void) | undefined;
  const firstEntered = new Promise<void>(resolve => { enteredFirst = resolve; });
  const finishFirst = new Promise<never>((_resolve, reject) => { releaseFirst = () => reject(new Error('fixture stopped')); });
  let serviceCalls = 0;
  const exits: number[] = [];
  const workflow = createIntegrateWorkflow({
    process: {
      terminate: (code: number) => { exits.push(code); },
      cwd: () => '/tmp/base',
      chdir: () => {},
      claimIntegration: async () => {
        if (held) { return null; }
        held = true;
        return async () => { held = false; };
      },
    },
    missionPaths: { inferSlug: () => 'task-exclusive' },
    git: { git: () => ({ status: 0, stdout: '', stderr: '' }) },
    landing: { isAbort: () => false },
    agents: { startAgent: () => {}, selectAgent: () => null, workflowLauncherStatus: () => null, applyAgentFallback: () => {} },
    backlog: { transitionTask: () => {} },
    gates: { routeIntegrationGateFailure: () => {} },
  } as never);
  const options = {
    missionServicesFn: async () => {
      serviceCalls++;
      enteredFirst?.();
      return finishFirst;
    },
    exitFn: (code: number) => { exits.push(code); },
  };

  const first = workflow.integrate(['task-exclusive'], options);
  await firstEntered;
  const second = await workflow.integrate(['task-exclusive'], options);
  assert.deepEqual(second, { exitCode: 1 });
  assert.equal(serviceCalls, 1);
  assert.equal(held, true);
  releaseFirst?.();
  await first;
  assert.equal(held, false);
  assert.deepEqual(exits, [1, 1]);
});

test('repeat integrate reports a landed closed mission without rerunning gates', async () => {
  let gateCalls = 0;
  let released = 0;
  let branchRemains = false;
  const abort = new Error('incomplete closeout');
  const exits: number[] = [];
  const workflow = createIntegrateWorkflow({
    process: {
      terminate: () => {},
      cwd: () => '/tmp/base',
      chdir: () => {},
      claimIntegration: async () => async () => { released++; },
    },
    missionPaths: { inferSlug: () => 'task-closed', getPrimaryWorktree: () => '/tmp/base', missionBranchName: () => 'mission/task-closed', conventionalWorktreePath: () => '/tmp/base-task-closed' },
    fileSystem: { existsSync: () => false },
    git: { git: () => ({ status: branchRemains ? 0 : 1, stdout: '', stderr: '' }) },
    checkout: { findLandedSquashOnBaseBranch: () => 'abc123456789' },
    landing: { isAbort: (error: unknown) => error === abort, createAbort: () => abort },
    agents: { startAgent: () => {}, selectAgent: () => null, workflowLauncherStatus: () => null, applyAgentFallback: () => {} },
    backlog: { transitionTask: () => {} },
    gates: { routeIntegrationGateFailure: () => { gateCalls++; } },
  } as never);
  const result = await workflow.integrate(['task-closed'], {
    missionServicesFn: async () => ({ store: { load: async () => ({ kind: 'found', mission: { status: 'done', closedAt: '2026-09-27T20:50:34Z' } }) } }),
    exitFn: code => { exits.push(code); },
  });
  assert.deepEqual(result, { exitCode: 0 });
  assert.deepEqual(exits, [0]);
  assert.equal(gateCalls, 0);
  assert.equal(released, 1);
  branchRemains = true;
  const incomplete = await workflow.integrate(['task-closed'], {
    missionServicesFn: async () => ({ store: { load: async () => ({ kind: 'found', mission: { status: 'done', closedAt: '2026-09-27T20:50:34Z' } }) } }),
    exitFn: code => { exits.push(code); },
  });
  assert.deepEqual(incomplete, { exitCode: 1 });
  assert.deepEqual(exits, [0, 1]);
  assert.equal(gateCalls, 0);
  assert.equal(released, 2);
});
