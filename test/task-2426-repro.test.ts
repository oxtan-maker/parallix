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
    for (const kind of unavailableKinds) {
      assert.equal(capabilities.commandController.canExecute(kind), false);
      assert.equal(factoryController.canExecute(kind), false);
    }
  } finally {
    await db.close();
  }
});

const unavailableKinds: readonly BoardCommandKind[] = [
  'draft:create', 'review:submit', 'review:act-on-findings', 'approve:review', 'integrate:merge',
];

test('read-only production controller does not advertise Mission commands', async () => {
  const { ports } = makeExecutePorts();
  const capabilities = composeProductionCapabilities(
    '/fixture-repository', repositoryId('fixture-repository'), repositories, ports, null, NO_CURRENT_WORK_PORT,
  );
  const factoryController = capabilities.tui.commandControllerFactory(() => {});
  for (const controller of [capabilities.commandController, factoryController]) {
    assert.equal(controller.canExecute('active:execute'), true);
    for (const kind of ['mission:intake', 'checkpoint:record', 'handoff:record', ...unavailableKinds] as const) {
      assert.equal(controller.canExecute(kind), false);
    }
    const result = await controller.dispatch({
      operationId: 'task-2426-read-only', kind: 'mission:intake', missionId: 'task-2426-fixture', capabilities: new Set(),
      payload: { kind: 'mission:intake', repositoryId: repositoryId('fixture-repository'), title: 'Read-only check' },
    });
    assert.equal(result.error?.kind, 'capability');
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
    const handoff = await controller.dispatch({
      operationId: 'task-2426-production-handoff', kind: 'handoff:record', missionId: id,
      capabilities: new Set(['handoff:record']),
      payload: { kind: 'handoff:record', expectedVersion: missionVersion(2), netEngineeringLines: 1, capturedAt: '2026-08-29T00:00:00Z' },
    });
    assert.equal(handoff.status, 'completed');
  } finally {
    await services?.operatorState.close();
    if (previousHome === undefined) delete process.env.PARALLIX_HOME;
    else process.env.PARALLIX_HOME = previousHome;
    await clearOperatorStateCache();
  }
});
