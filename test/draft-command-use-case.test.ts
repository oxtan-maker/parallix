// @ts-nocheck -- TASK-2332.10: mocked-port tests for DraftCommandUseCase

import test from 'node:test';
import assert from 'node:assert/strict';
import { DraftCommandUseCase } from '../src/application/draft-command-use-case.js';

// Shared exit tracker
function createExitTracker() {
  let code: number | undefined;
  return {
    get code() { return code; },
    exitFn: (c?: number) => { code = c ?? 0; },
  };
}

function createLogTracker() {
  const logs: string[] = [];
  return {
    logs,
    logFn: (msg: string) => logs.push(msg),
    errorFn: (msg: string) => logs.push(msg),
  };
}

// Helper: create a context that marks workflow as exited
function exitedCtx(exitTracker: ReturnType<typeof createExitTracker>, logTracker: ReturnType<typeof createLogTracker>, overrides: Record<string, any> = {}) {
  return {
    slug: '',
    mainRepo: '',
    targetWorktree: '',
    missionFile: '',
    recordedBase: null,
    syntheticTask: null,
    agent: '',
    actualAgent: null,
    agentResult: null,
    exitFn: exitTracker.exitFn,
    logFn: logTracker.logFn,
    errorFn: logTracker.errorFn,
    missionServicesFn: async () => ({}),
    options: {},
    ...overrides,
    exited: true, // always last — cannot be overwritten
  };
}

// Helper: create a context that continues workflow
function okCtx(exitTracker: ReturnType<typeof createExitTracker>, logTracker: ReturnType<typeof createLogTracker>, overrides: Record<string, any> = {}) {
  return {
    exited: false,
    slug: 'task-1234.56',
    mainRepo: '/repo/main',
    targetWorktree: '/repo/worktrees/task-1234.56',
    missionFile: '/repo/worktrees/task-1234.56/missions/task-1234.56/MISSION.md',
    recordedBase: null,
    syntheticTask: null,
    agent: 'claude',
    actualAgent: 'claude',
    agentResult: { status: 0 },
    exitFn: exitTracker.exitFn,
    logFn: logTracker.logFn,
    errorFn: logTracker.errorFn,
    missionServicesFn: async () => ({}),
    options: {},
    ...overrides,
  };
}

test('DraftCommandUseCase.execute sequences all port methods in normal flow', async () => {
  const calls: string[] = [];
  const exit = createExitTracker();
  const logs = createLogTracker();

  const port = {
    preflight: (args: string[], options?: Record<string, unknown>) => {
      calls.push('preflight');
      return okCtx(exit, logs, { options: options || {} });
    },
    setup: (ctx: any) => { calls.push('setup'); return okCtx(exit, logs, ctx); },
    scaffold: (ctx: any) => { calls.push('scaffold'); return okCtx(exit, logs, ctx); },
    intake: async (ctx: any) => { calls.push('intake'); return okCtx(exit, logs, ctx); },
    transition: async (ctx: any) => { calls.push('transition'); return okCtx(exit, logs, ctx); },
    launchAgent: async (ctx: any) => { calls.push('launchAgent'); return okCtx(exit, logs, ctx); },
    postProcess: async (ctx: any) => { calls.push('postProcess'); return okCtx(exit, logs, ctx); },
    commitSafety: (ctx: any) => { calls.push('commitSafety'); return okCtx(exit, logs, ctx); },
    finalTransition: async (_ctx: any) => { calls.push('finalTransition'); },
  };

  const useCase = new DraftCommandUseCase(port);
  await useCase.execute(['task-1234.56'], { missionServicesFn: async () => ({}) });

  assert.deepStrictEqual(calls, [
    'preflight', 'setup', 'scaffold', 'intake', 'transition',
    'launchAgent', 'postProcess', 'commitSafety', 'finalTransition',
  ], 'use case sequences all port methods in order');
});

test('DraftCommandUseCase.execute stops at preflight on missing slug', async () => {
  const calls: string[] = [];
  const exit = createExitTracker();
  const logs = createLogTracker();

  const port = {
    preflight: (args: string[], options?: Record<string, unknown>) => {
      calls.push('preflight');
      exit.exitFn(1); // adapter calls exitFn(1) for missing slug
      return exitedCtx(exit, logs, { options: options || {} });
    },
    setup: (_ctx: any) => calls.push('setup'),
    scaffold: (_ctx: any) => calls.push('scaffold'),
    intake: async (_ctx: any) => calls.push('intake'),
    transition: async (_ctx: any) => calls.push('transition'),
    launchAgent: async (_ctx: any) => calls.push('launchAgent'),
    postProcess: async (_ctx: any) => calls.push('postProcess'),
    commitSafety: (_ctx: any) => calls.push('commitSafety'),
    finalTransition: async (_ctx: any) => calls.push('finalTransition'),
  };

  const useCase = new DraftCommandUseCase(port);
  await useCase.execute([], {});

  assert.deepStrictEqual(calls, ['preflight'], 'only preflight called');
  assert.strictEqual(exit.code, 1, 'exit code set to 1');
});

test('DraftCommandUseCase.execute stops at intake on conflict', async () => {
  const calls: string[] = [];
  const exit = createExitTracker();
  const logs = createLogTracker();

  const port = {
    preflight: (args: string[], options?: Record<string, unknown>) => {
      calls.push('preflight');
      return okCtx(exit, logs, { options: options || {} });
    },
    setup: (ctx: any) => { calls.push('setup'); return okCtx(exit, logs, ctx); },
    scaffold: (ctx: any) => { calls.push('scaffold'); return okCtx(exit, logs, ctx); },
    intake: async (ctx: any) => {
      calls.push('intake');
      ctx.logFn('[INFO] Mission already recorded in SQLite: conflict');
      return okCtx(exit, logs, ctx); // conflict is non-fatal, continues
    },
    transition: async (ctx: any) => { calls.push('transition'); return okCtx(exit, logs, ctx); },
    launchAgent: async (ctx: any) => { calls.push('launchAgent'); return okCtx(exit, logs, ctx); },
    postProcess: async (ctx: any) => { calls.push('postProcess'); return okCtx(exit, logs, ctx); },
    commitSafety: (ctx: any) => { calls.push('commitSafety'); return okCtx(exit, logs, ctx); },
    finalTransition: async (_ctx: any) => { calls.push('finalTransition'); },
  };

  const useCase = new DraftCommandUseCase(port);
  await useCase.execute(['task-existing'], {});

  assert.ok(calls.includes('intake'), 'intake called');
  assert.ok(calls.includes('finalTransition'), 'workflow completes after intake conflict');
  assert.ok(logs.logs.some(l => l.includes('already recorded')), 'conflict logged');
});

test('DraftCommandUseCase.execute stops at launchAgent on verification failure', async () => {
  const calls: string[] = [];
  const exit = createExitTracker();
  const logs = createLogTracker();

  const port = {
    preflight: (args: string[], options?: Record<string, unknown>) => {
      calls.push('preflight');
      return okCtx(exit, logs, { options: options || {} });
    },
    setup: (ctx: any) => { calls.push('setup'); return okCtx(exit, logs, ctx); },
    scaffold: (ctx: any) => { calls.push('scaffold'); return okCtx(exit, logs, ctx); },
    intake: async (ctx: any) => { calls.push('intake'); return okCtx(exit, logs, ctx); },
    transition: async (ctx: any) => { calls.push('transition'); return okCtx(exit, logs, ctx); },
    launchAgent: async (ctx: any) => {
      calls.push('launchAgent');
      exit.exitFn(1); // agent failed
      return exitedCtx(exit, logs, ctx);
    },
    postProcess: async () => calls.push('postProcess'),
    commitSafety: () => calls.push('commitSafety'),
    finalTransition: async () => calls.push('finalTransition'),
  };

  const useCase = new DraftCommandUseCase(port);
  await useCase.execute(['task-verify-fail'], {});

  assert.deepStrictEqual(calls, ['preflight', 'setup', 'scaffold', 'intake', 'transition', 'launchAgent'], 'stops after launchAgent');
  assert.ok(!calls.includes('postProcess'), 'postProcess not called after exit');
  assert.strictEqual(exit.code, 1, 'exit code set');
});

test('DraftCommandUseCase.execute stops at postProcess on classification restart failure', async () => {
  const calls: string[] = [];
  const exit = createExitTracker();
  const logs = createLogTracker();

  const port = {
    preflight: (args: string[], options?: Record<string, unknown>) => {
      calls.push('preflight');
      return okCtx(exit, logs, { options: options || {} });
    },
    setup: (ctx: any) => { calls.push('setup'); return okCtx(exit, logs, ctx); },
    scaffold: (ctx: any) => { calls.push('scaffold'); return okCtx(exit, logs, ctx); },
    intake: async (ctx: any) => { calls.push('intake'); return okCtx(exit, logs, ctx); },
    transition: async (ctx: any) => { calls.push('transition'); return okCtx(exit, logs, ctx); },
    launchAgent: async (ctx: any) => { calls.push('launchAgent'); return okCtx(exit, logs, ctx); },
    postProcess: async (ctx: any) => {
      calls.push('postProcess');
      ctx.logFn('[WARN] Post-draft mission type labels are not valid. Relaunching...');
      ctx.logFn('[FAIL] Post-draft mission type labels are still invalid after restart.');
      exit.exitFn(1);
      return exitedCtx(exit, logs, ctx);
    },
    commitSafety: () => calls.push('commitSafety'),
    finalTransition: async () => calls.push('finalTransition'),
  };

  const useCase = new DraftCommandUseCase(port);
  await useCase.execute(['task-classify'], {});

  assert.ok(calls.includes('postProcess'), 'postProcess called');
  assert.ok(!calls.includes('commitSafety'), 'commitSafety not called after exit');
  assert.ok(logs.logs.some(l => l.includes('Relaunching')), 'restart logged');
  assert.strictEqual(exit.code, 1, 'exit code set');
});

test('DraftCommandUseCase.execute passes options through to preflight', async () => {
  const exit = createExitTracker();
  const logs = createLogTracker();
  let capturedOptions: Record<string, unknown> | undefined;

  const missionServices = async () => ({
    repositoryId: 'test-repo',
    intake: { async execute() { return { status: 'completed', value: { version: 1 } }; } },
  });

  const port = {
    preflight: (args: string[], options?: Record<string, unknown>) => {
      capturedOptions = options;
      return okCtx(exit, logs, { options: options || {} });
    },
    setup: (ctx: any) => okCtx(exit, logs, ctx),
    scaffold: (ctx: any) => okCtx(exit, logs, ctx),
    intake: async (ctx: any) => okCtx(exit, logs, ctx),
    transition: async (ctx: any) => okCtx(exit, logs, ctx),
    launchAgent: async (ctx: any) => okCtx(exit, logs, ctx),
    postProcess: async (ctx: any) => okCtx(exit, logs, ctx),
    commitSafety: (ctx: any) => okCtx(exit, logs, ctx),
    finalTransition: async () => {},
  };

  const useCase = new DraftCommandUseCase(port);
  await useCase.execute(['task-1234.56'], { missionServicesFn: missionServices });

  assert.ok(capturedOptions);
  assert.ok(typeof (capturedOptions as any).missionServicesFn === 'function');
  const services = await (capturedOptions as any).missionServicesFn('/tmp/worktree');
  assert.strictEqual(services.repositoryId, 'test-repo');
});

test('DraftCommandUseCase.execute stops at commitSafety on uncommitted changes error', async () => {
  const calls: string[] = [];
  const exit = createExitTracker();
  const logs = createLogTracker();

  const port = {
    preflight: (args: string[], options?: Record<string, unknown>) => {
      calls.push('preflight');
      return okCtx(exit, logs, { options: options || {} });
    },
    setup: (ctx: any) => { calls.push('setup'); return okCtx(exit, logs, ctx); },
    scaffold: (ctx: any) => { calls.push('scaffold'); return okCtx(exit, logs, ctx); },
    intake: async (ctx: any) => { calls.push('intake'); return okCtx(exit, logs, ctx); },
    transition: async (ctx: any) => { calls.push('transition'); return okCtx(exit, logs, ctx); },
    launchAgent: async (ctx: any) => { calls.push('launchAgent'); return okCtx(exit, logs, ctx); },
    postProcess: async (ctx: any) => { calls.push('postProcess'); return okCtx(exit, logs, ctx); },
    commitSafety: (ctx: any) => {
      calls.push('commitSafety');
      exit.exitFn(1);
      return exitedCtx(exit, logs, ctx);
    },
    finalTransition: async () => calls.push('finalTransition'),
  };

  const useCase = new DraftCommandUseCase(port);
  await useCase.execute(['task-commit'], {});

  assert.ok(calls.includes('commitSafety'), 'commitSafety called');
  assert.ok(!calls.includes('finalTransition'), 'finalTransition not called after exit');
  assert.strictEqual(exit.code, 1, 'exit code set');
});
