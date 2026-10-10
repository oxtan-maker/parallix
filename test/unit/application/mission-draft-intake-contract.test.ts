// @ts-nocheck -- TASK-2328: partial test doubles from ESM seam migration; resolve in follow-up
// Mission draft intake contract: draft command use case, draft current-work publication, and start
// removal.
//
// Behavior-owned suite (TASK-2622.07). Legacy case names are unchanged; each section keeps its
// historical task provenance and the legacy file it replaced.
//   Draft command use case: no task ID in the legacy file
//   Draft current-work publication: TASK-2406
//   Mission start removal: no task ID in the legacy file

import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { DraftCommandUseCase } from '../../../src/application/draft-command-use-case.js';
import { MissionCreationService } from '../../../src/application/mission-creation-service.js';
import { main, KNOWN_COMMANDS, suggestCommand } from '../../../src/interfaces/cli/runtime.js';

// no task ID in the legacy file (was test/draft-command-use-case.test.ts)
describe('Draft command use case', () => {
  // @ts-nocheck -- TASK-2332.10: mocked-port tests for DraftCommandUseCase


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
      preflight: async (args: string[], options?: Record<string, unknown>) => {
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
      preflight: async (args: string[], options?: Record<string, unknown>) => {
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
      preflight: async (args: string[], options?: Record<string, unknown>) => {
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
      preflight: async (args: string[], options?: Record<string, unknown>) => {
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
      preflight: async (args: string[], options?: Record<string, unknown>) => {
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
      preflight: async (args: string[], options?: Record<string, unknown>) => {
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
      preflight: async (args: string[], options?: Record<string, unknown>) => {
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
});

// TASK-2406 (was test/task-2406-draft-current-work.test.ts)
describe('Draft current-work publication', () => {
  // @ts-nocheck -- mocked-port regression coverage for DraftCommandUseCase


  function context(overrides: Record<string, unknown> = {}) {
    return {
      exited: false,
      slug: 'task-2406',
      agent: 'codex',
      ...overrides,
    };
  }

  function workflow(calls: string[], overrides: Record<string, unknown> = {}) {
    return {
      preflight: async () => { calls.push('preflight'); return context(); },
      setup: (ctx: any) => { calls.push('setup'); return context(ctx); },
      scaffold: (ctx: any) => { calls.push('scaffold'); return context(ctx); },
      intake: async (ctx: any) => { calls.push('intake'); return context(ctx); },
      transition: async (ctx: any) => { calls.push('transition'); return context(ctx); },
      launchAgent: async (ctx: any) => { calls.push('launchAgent'); return context(ctx); },
      postProcess: async (ctx: any) => { calls.push('postProcess'); return context(ctx); },
      commitSafety: (ctx: any) => { calls.push('commitSafety'); return context(ctx); },
      finalTransition: async () => { calls.push('finalTransition'); },
      ...overrides,
    };
  }

  test('draft publishes running with phase draft before workflow and ended after finalTransition', async () => {
    const calls: string[] = [];
    const currentWork = {
      running: async (publication: any) => { calls.push(`running:${publication.phase}`); },
      blocked: async () => { calls.push('blocked'); },
      ended: async () => { calls.push('ended'); },
    };

    await new DraftCommandUseCase(workflow(calls), currentWork).execute(['task-2406']);

    assert.deepEqual(calls, [
      'preflight', 'running:draft', 'setup', 'scaffold', 'intake', 'transition',
      'launchAgent', 'postProcess', 'commitSafety', 'finalTransition', 'ended',
    ]);
  });

  test('draft publishes blocked with the workflow error and rethrows it', async () => {
    const calls: string[] = [];
    const currentWork = {
      running: async () => { calls.push('running'); },
      blocked: async (_publication: any, reason: string) => { calls.push(`blocked:${reason}`); },
      ended: async () => { calls.push('ended'); },
    };
    const failure = new Error('draft agent failed');

    await assert.rejects(
      new DraftCommandUseCase(workflow(calls, { launchAgent: async () => { throw failure; } }), currentWork).execute(['task-2406']),
      failure,
    );
    assert.deepEqual(calls, ['preflight', 'running', 'setup', 'scaffold', 'intake', 'transition', 'blocked:draft agent failed']);
  });

  test('draft skips current-work publication for an unparseable slug', async () => {
    const calls: string[] = [];
    const currentWork = {
      running: async () => { calls.push('running'); },
      blocked: async () => { calls.push('blocked'); },
      ended: async () => { calls.push('ended'); },
    };
    const draftWorkflow = workflow(calls, { preflight: async () => context({ slug: 'not a slug' }) });

    await new DraftCommandUseCase(draftWorkflow, currentWork).execute(['not a slug']);

    assert.deepEqual(calls, ['setup', 'scaffold', 'intake', 'transition', 'launchAgent', 'postProcess', 'commitSafety', 'finalTransition']);
  });
});

// no task ID in the legacy file (was test/mission-start-removal.test.ts)
describe('Mission start removal', () => {
  // @ts-nocheck -- focused regression for task-2495: the hallucinated `px mission-start`
  // command is removed from the CLI surface and can never reach startup preflight.

  // The command is gone from the canonical command table, so help and the
  // "did you mean" suggestion can no longer advertise it.
  test('KNOWN_COMMANDS no longer registers mission-start', () => {
    assert.equal(KNOWN_COMMANDS.includes('mission-start'), false);
  });

  test('suggestCommand never proposes mission-start', () => {
    assert.equal(suggestCommand('missionstart'), null);
    assert.equal(suggestCommand('mission-start'), null);
  });

  // Dispatching `px mission-start` must fall through to the unknown-command path:
  // it reports "Unknown command: mission-start", prints usage, and exits 1 without
  // ever invoking the startup-preflight implementation.
  test('px mission-start resolves to Unknown command and never reaches preflight', async () => {
    const errors = [];
    let exitedWith = 'unset';
    let usagePrinted = false;

    await main(['mission-start'], {
      commandFns: {},
      loadAliasesFn: () => ({}),
      cwdFn: () => '/tmp/nowhere',
      errorFn: (msg) => errors.push(String(msg)),
      printUsageFn: () => { usagePrinted = true; },
      exitFn: (code) => { exitedWith = code; },
    });

    assert.equal(exitedWith, 1, 'unknown command must exit non-zero');
    assert.ok(usagePrinted, 'usage must be printed for an unknown command');
    assert.ok(
      errors.some((line) => /Unknown command: mission-start/.test(line)),
      'dispatch must report mission-start as unknown',
    );
    // No USABLE verdict means the startup preflight never ran.
    assert.ok(!errors.some((line) => /Environment verdict: USABLE/.test(line)));
    assert.ok(!errors.some((line) => /Running mission startup preflight/.test(line)));
  });

  // A near-miss spelling must not silently resolve to the removed command.
  test('px mission-startx does not resolve to a removed command', async () => {
    const errors = [];
    let exitedWith = 'unset';

    await main(['mission-startx'], {
      commandFns: {},
      loadAliasesFn: () => ({}),
      cwdFn: () => '/tmp/nowhere',
      errorFn: (msg) => errors.push(String(msg)),
      printUsageFn: () => {},
      exitFn: (code) => { exitedWith = code; },
    });

    assert.equal(exitedWith, 1);
    assert.ok(errors.some((line) => /Unknown command: mission-startx/.test(line)));
  });
});

// Create new mission (TASK-2693) from the web board — identity, validation, dependency
// eligibility and retry safety, against doubles for the intake write and the catalog.
describe('Mission creation use case', () => {
  const REPO = 'parallix' as never;
  const CAPABILITIES = new Set(['mission:intake'] as const);

  function fixture(missions: unknown[] = []) {
    const writes: Record<string, unknown>[] = [];
    let counter = 0;
    let failNext: unknown = null;
    const intake = {
      async execute(request: Record<string, unknown>) {
        writes.push(request);
        if (failNext) { const outcome = failNext; failNext = null; return outcome; }
        return { status: 'completed', value: { mission: { id: request.missionId }, version: 1 }, durableEvidence: [] };
      },
    };
    const service = new MissionCreationService(
      intake as never,
      { loadAllMissions: async () => missions as never },
      { allocate: () => `px-${String(++counter).padStart(4, '0')}` as never },
      REPO,
    );
    const create = (overrides: Record<string, unknown> = {}) => service.execute({
      operationId: 'op', requestKey: 'form-1', title: 'Capture it', capabilities: CAPABILITIES, ...overrides,
    } as never);
    return { writes, create, failWith: (outcome: unknown) => { failNext = outcome; }, allocated: () => counter };
  }
  const open = (id: string, overrides: Record<string, unknown> = {}) => ({ id, repositoryId: REPO, status: 'backlog', closedAt: null, ...overrides });

  test('creates one backlog intake carrying every submitted field under an allocated identity', async () => {
    const { create, writes } = fixture([open('task-1')]);
    const outcome = await create({
      title: '  Capture it  ', description: 'Goal text', context: 'Because', labels: ['UX', 'ux', 'api'],
      successCriteria: ['It works'], dependencies: ['task-1'],
    });
    assert.equal(outcome.status, 'completed');
    assert.equal(writes.length, 1);
    assert.equal(writes[0].missionId, 'px-0001');
    assert.equal(writes[0].repositoryId, REPO);
    assert.equal(writes[0].title, 'Capture it');
    assert.deepEqual(writes[0].labels, ['ux', 'api']);
    assert.deepEqual(writes[0].brief, { goal: 'Goal text', why: 'Because', scope: null, outOfScope: [] });
    assert.deepEqual(writes[0].successCriteria, ['It works']);
    assert.deepEqual(writes[0].dependencies, ['task-1']);
  });

  test('keeps a description with no context as the description and records no brief (TASK-2693)', async () => {
    const { create, writes } = fixture();
    const outcome = await create({ description: '  Needs a reason later  ' });
    assert.equal(outcome.status, 'completed');
    assert.equal(writes[0].description, 'Needs a reason later');
    assert.equal(writes[0].brief, undefined);
  });

  test('rejects blank titles and incomplete or oversized input before allocating an identity or writing', async () => {
    const { create, writes, allocated } = fixture();
    for (const overrides of [
      { title: '   ' },
      { title: 'x'.repeat(201) },
      { title: 'ok', context: 'only a context' },
      { title: 'ok', labels: ['a', ' '] },
      { title: 'ok', successCriteria: ['same', 'same'] },
      { title: 'ok', dependencies: ['task-1', 'task-1'] },
    ]) {
      const outcome = await create(overrides);
      assert.equal(outcome.status, 'rejected', JSON.stringify(overrides));
      assert.equal(outcome.error.kind, 'validation');
    }
    assert.equal(writes.length, 0);
    assert.equal(allocated(), 0);
  });

  test('refuses finished, closed, foreign and nonexistent dependencies', async () => {
    const { create, writes } = fixture([
      open('task-open'), open('task-done', { status: 'done' }), open('task-closed', { closedAt: '2026-01-01T00:00:00Z' }),
      open('task-foreign', { repositoryId: 'other' }),
    ]);
    for (const dependency of ['task-done', 'task-closed', 'task-foreign', 'task-missing']) {
      const outcome = await create({ requestKey: dependency, dependencies: ['task-open', dependency] });
      assert.equal(outcome.status, 'rejected', dependency);
      assert.match(outcome.error.message, new RegExp(dependency));
    }
    assert.equal(writes.length, 0);
    assert.equal((await create({ requestKey: 'ok', dependencies: ['task-open'] })).status, 'completed');
  });

  test('requires the intake capability', async () => {
    const { create, writes } = fixture();
    const outcome = await create({ capabilities: new Set() });
    assert.equal(outcome.error.kind, 'capability');
    assert.equal(writes.length, 0);
  });

  test('a repeated request key returns the persisted mission instead of creating another', async () => {
    const { create, writes } = fixture();
    const [first, concurrent] = await Promise.all([create(), create()]);
    const retried = await create();
    assert.equal(writes.length, 1);
    assert.equal(first.value.mission.id, concurrent.value.mission.id);
    assert.equal(retried.value.mission.id, first.value.mission.id);
    assert.equal((await create({ requestKey: 'form-2' })).value.mission.id, 'px-0002');
  });

  test('a failed write is not remembered, so the same request key can retry', async () => {
    const { create, writes, failWith } = fixture();
    failWith({ status: 'failed', error: { kind: 'unavailable', message: 'database is locked' }, durableEvidence: [] });
    assert.equal((await create()).status, 'failed');
    assert.equal((await create()).status, 'completed');
    assert.equal(writes.length, 2);
  });
});
