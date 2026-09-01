import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { SqliteDatabaseAdapter } from '../src/adapters/sqlite/database-adapter.js';
import { loadDefaultMigrations, SqliteMigrationRunner } from '../src/adapters/sqlite/migration-runner.js';
import { SqliteMissionStore } from '../src/adapters/sqlite/mission-store.js';
import { clearOperatorStateCache } from '../src/adapters/sqlite/adapter-factory.js';
import { NO_CURRENT_WORK_PORT } from '../src/application/recording/current-work-recorder.js';
import type { DraftWorkflowContext, DraftWorkflowPort } from '../src/application/ports/cli-workflows.js';
import type { BoardCommandKind } from '../src/application/controller/board-command.js';
import { createProductionApplicationServices } from '../src/composition/application-services.js';
import { missionVersion } from '../src/application/domain-ports.js';
import { composeProductionCapabilities } from '../src/composition/production-capabilities.js';
import { agentFamily } from '../src/domain/agents.js';
import { missionId, missionLabels } from '../src/domain/mission.js';
import { repositoryId } from '../src/domain/repository.js';
import { makeExecutePorts } from './fixtures/execute-mission-ports.js';

const directories: string[] = [];
const repositories = {
  agentBlocklist: { async findAll() { return []; }, async findByAgent() { return undefined; }, async save() {}, async deleteByAgent() {}, async clear() {} },
  operationalHistory: { async findAll() { return []; }, async findByType() { return []; }, async append() {}, async clear() {} },
  boardLaneEvents: { async findAll() { return []; }, async findByMissionId() { return []; }, async findByRepositoryId() { return []; }, async append() { return true; }, async clear() {} },
  usage: { async findAll() { return []; }, async findWhere() { return []; }, async save() {}, async saveAll() {}, async clear() {} },
};

async function isolatedStore() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'parallix-task-2426-'));
  directories.push(directory);
  const db = new SqliteDatabaseAdapter();
  await db.open({ path: path.join(directory, 'fixture.db') });
  await new SqliteMigrationRunner(db).applyPending(loadDefaultMigrations());
  return { db, store: new SqliteMissionStore(db) };
}

afterEach(() => {
  for (const directory of directories.splice(0)) fs.rmSync(directory, { recursive: true, force: true });
});

test('wired production controller dispatches mission intake and factory agrees', async () => {
  const { db, store } = await isolatedStore();
  try {
    const { ports } = makeExecutePorts();
    const capabilities = composeProductionCapabilities(
      '/fixture-repository', repositoryId('fixture-repository'), repositories, ports, store, NO_CURRENT_WORK_PORT,
    );
    const result = await capabilities.commandController.dispatch({
      operationId: 'task-2426-intake',
      kind: 'mission:intake',
      missionId: missionId('task-2426-fixture'),
      capabilities: new Set(['mission:intake']),
      payload: {
        kind: 'mission:intake',
        repositoryId: repositoryId('fixture-repository'),
        title: 'Wire board Mission capability services',
        labels: missionLabels(['ai_sdlc']),
        assignee: agentFamily('codex'),
        rawStatus: 'active',
      },
    });
    assert.equal(result.status, 'completed');
    assert.equal((await store.load(missionId('task-2426-fixture'))).kind, 'found');
    const factoryController = capabilities.tui.commandControllerFactory(() => {});
    for (const kind of ['active:execute', 'mission:intake', 'checkpoint:record', 'handoff:record'] as const) {
      assert.equal(capabilities.commandController.canExecute(kind), true);
      assert.equal(factoryController.canExecute(kind), true);
    }
    for (const kind of remainingUnavailableKinds) {
      assert.equal(capabilities.commandController.canExecute(kind), false);
      assert.equal(factoryController.canExecute(kind), false);
    }
  } finally {
    await db.close();
  }
});

const remainingUnavailableKinds: readonly BoardCommandKind[] = [
  'review:submit', 'review:act-on-findings', 'approve:review', 'integrate:merge',
];

/** In-memory draft workflow port: records the steps it reaches, opens nothing. */
function makeMockDraftWorkflow(slug: string) {
  const calls: string[] = [];
  const ctx: DraftWorkflowContext = {
    exited: false,
    slug,
    mainRepo: '/fixture/main',
    targetWorktree: `/fixture/worktrees/${slug}`,
    missionFile: `/fixture/worktrees/${slug}/missions/${slug}/MISSION.md`,
    recordedBase: null,
    syntheticTask: null,
    agent: '',
    actualAgent: null,
    agentResult: null,
    exitFn: (_code?: number) => { throw new Error('mock must not exit'); },
    logFn: () => {},
    errorFn: () => {},
    missionServicesFn: async () => ({}),
    options: {},
  };
  const port: DraftWorkflowPort = {
    preflight: (args) => { calls.push(`preflight:${args[0]}`); return ctx; },
    setup: (c) => { calls.push('setup'); return c; },
    scaffold: (c) => { calls.push('scaffold'); return c; },
    intake: async (c) => { calls.push('intake'); return c; },
    transition: async (c) => { calls.push('transition'); return c; },
    launchAgent: async (c) => { calls.push('launchAgent'); return c; },
    postProcess: async (c) => { calls.push('postProcess'); return c; },
    commitSafety: (c) => { calls.push('commitSafety'); return c; },
    finalTransition: async () => { calls.push('finalTransition'); },
  };
  return { calls, port };
}

test('wired production controller drafts through the injected workflow port', async () => {
  const { db, store } = await isolatedStore();
  const slug = missionId('task-2427-draft-fixture');
  try {
    const { ports } = makeExecutePorts();
    const mock = makeMockDraftWorkflow(slug);
    const capabilities = composeProductionCapabilities(
      '/fixture-repository', repositoryId('fixture-repository'), repositories, ports, store, NO_CURRENT_WORK_PORT,
      undefined, undefined, { draftWorkflow: mock.port },
    );
    // Draft requires the pre-draft state: materialize a backlog mission first.
    const intake = await capabilities.commandController.dispatch({
      operationId: 'task-2427-intake',
      kind: 'mission:intake',
      missionId: slug,
      capabilities: new Set(['mission:intake']),
      payload: { kind: 'mission:intake', repositoryId: repositoryId('fixture-repository'), title: 'Draft board capability fixture' },
    });
    assert.equal(intake.status, 'completed');

    const result = await capabilities.commandController.dispatch({
      operationId: 'task-2427-draft',
      kind: 'draft:create',
      missionId: slug,
      missionStatusAtRequest: 'backlog',
      capabilities: new Set(['mission:intake']),
    });
    assert.equal(result.status, 'completed');
    assert.deepEqual(result.value, { slug });
    assert.deepEqual(mock.calls, [
      `preflight:${slug}`, 'setup', 'scaffold', 'intake', 'transition',
      'launchAgent', 'postProcess', 'commitSafety', 'finalTransition',
    ], 'dispatch reaches the injected workflow exactly once per step');
    // The TUI controller factory path builds its own controller from the same
    // mission services, so it must expose the same draft wiring.
    assert.equal(capabilities.tui.commandControllerFactory(() => {}).canExecute('draft:create'), true);
  } finally {
    await db.close();
  }
});

test('production composition builds the trusted draft adapter by default (no override needed)', async () => {
  const { db, store } = await isolatedStore();
  try {
    const { ports } = makeExecutePorts();
    // No `draftWorkflow` override: the default path builds the real
    // createDraftWorkflowAdapter with the throwing exit function, progress
    // sink logging, and the composition's mission services. Construction is
    // lazy — no git or database handle is opened until a dispatch runs.
    const capabilities = composeProductionCapabilities(
      '/fixture-repository', repositoryId('fixture-repository'), repositories, ports, store, NO_CURRENT_WORK_PORT,
    );
    assert.equal(capabilities.commandController.canExecute('draft:create'), true);
    assert.equal(capabilities.tui.commandControllerFactory(() => {}).canExecute('draft:create'), true);
  } finally {
    await db.close();
  }
});

test('production draft adapter maps worktree creation abort to typed failure without exiting', async () => {
  const { db, store } = await isolatedStore();
  const slug = missionId('task-2427-worktree-abort');
  try {
    const { ports } = makeExecutePorts();
    const capabilities = composeProductionCapabilities(
      '/fixture-repository', repositoryId('fixture-repository'), repositories, ports, store, NO_CURRENT_WORK_PORT,
      undefined, undefined, {
        draftAdapterDeps: {
          resolveMainRepoFn: () => '/definitely-not-a-git-repository',
          ensureRepoExistsFn: () => true,
          ensureStandaloneMissionBaselineFn: () => ({ committed: false }),
          ensureDraftRepoConfigCommittedFn: () => true,
          detectLaunchBaseBranchFn: () => null,
          resolveTaskFileFn: () => ({ ok: true, taskFile: '/fixture/task.md' }),
          checkBacklogIntegrityFn: () => [],
          ensureMissionBranchFn: () => {},
          conventionalWorktreePathFn: () => '/fixture/worktree',
          gitFn: () => { throw new Error('worktree already exists'); },
        },
      },
    );
    const intake = await capabilities.commandController.dispatch({
      operationId: 'task-2427-worktree-abort-intake', kind: 'mission:intake', missionId: slug,
      capabilities: new Set(['mission:intake']),
      payload: { kind: 'mission:intake', repositoryId: repositoryId('fixture-repository'), title: 'Worktree abort fixture' },
    });
    assert.equal(intake.status, 'completed');

    const result = await capabilities.commandController.dispatch({
      operationId: 'task-2427-worktree-abort', kind: 'draft:create', missionId: slug,
      missionStatusAtRequest: 'backlog', capabilities: new Set(['mission:intake']),
    });
    assert.equal(result.status, 'failed');
    assert.equal(result.error?.kind, 'execution');
    assert.match(result.error?.message ?? '', /draft workflow aborted/);
  } finally {
    await db.close();
  }
});

test('read-only production controller does not advertise Mission commands', async () => {
  const { ports } = makeExecutePorts();
  const capabilities = composeProductionCapabilities(
    '/fixture-repository', repositoryId('fixture-repository'), repositories, ports, null, NO_CURRENT_WORK_PORT,
  );
  const factoryController = capabilities.tui.commandControllerFactory(() => {});
  for (const controller of [capabilities.commandController, factoryController]) {
    assert.equal(controller.canExecute('active:execute'), true);
    for (const kind of ['mission:intake', 'checkpoint:record', 'handoff:record', ...remainingUnavailableKinds] as const) {
      assert.equal(controller.canExecute(kind), false);
    }
    assert.equal(controller.canExecute('draft:create'), false, 'read-only graph has no draft service');
    const result = await controller.dispatch({
      operationId: 'task-2426-read-only', kind: 'mission:intake', missionId: 'task-2426-fixture', capabilities: new Set(),
      payload: { kind: 'mission:intake', repositoryId: repositoryId('fixture-repository'), title: 'Read-only check' },
    });
    assert.equal(result.error?.kind, 'capability');
    // Draft on a read-only graph is the typed unavailable capability result:
    // no database or git handle is opened by the dispatch.
    const draftResult = await controller.dispatch({
      operationId: 'task-2427-read-only-draft', kind: 'draft:create', missionId: 'task-2427-draft-fixture', capabilities: new Set(),
    });
    assert.equal(draftResult.status, 'rejected');
    assert.equal(draftResult.error?.kind, 'capability');
    assert.ok(draftResult.error?.message.includes('draft:create'));
  }
});

test('production application services wire Mission commands through their shared controller', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'parallix-task-2426-home-'));
  directories.push(home);
  const previousHome = process.env.PARALLIX_HOME;
  process.env.PARALLIX_HOME = home;
  await clearOperatorStateCache();
  let services: Awaited<ReturnType<typeof createProductionApplicationServices>> | undefined;
  try {
    services = await createProductionApplicationServices(process.cwd());
    const controller = services.presentationCapabilities!.commandController;
    for (const kind of ['active:execute', 'mission:intake', 'checkpoint:record', 'handoff:record'] as const) {
      assert.equal(controller.canExecute(kind), true);
    }
    const id = missionId('task-2426-production-fixture');
    const intake = await controller.dispatch({
      operationId: 'task-2426-production-intake', kind: 'mission:intake', missionId: id,
      capabilities: new Set(['mission:intake']),
      payload: { kind: 'mission:intake', repositoryId: services.mission!.repositoryId, title: 'Production composition proof', rawStatus: 'active' },
    });
    assert.equal(intake.status, 'completed');
    const checkpoint = await controller.dispatch({
      operationId: 'task-2426-production-checkpoint', kind: 'checkpoint:record', missionId: id,
      capabilities: new Set(['checkpoint:record']),
      payload: {
        kind: 'checkpoint:record', expectedVersion: missionVersion(1),
        checkpoint: { missionId: id, name: 'CP-1', rawFilename: 'CP-1.md', firstLine: 'Production proof', goalCheck: [{ criterion: 'Wired', evidence: 'test/task-2426-repro.test.ts' }], nextActionText: 'Record handoff.' },
      },
    });
    assert.equal(checkpoint.status, 'completed');
  } finally {
    await services?.operatorState.close();
    if (previousHome === undefined) delete process.env.PARALLIX_HOME;
    else process.env.PARALLIX_HOME = previousHome;
    await clearOperatorStateCache();
  }
});
