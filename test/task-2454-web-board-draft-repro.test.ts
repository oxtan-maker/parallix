import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { SqliteDatabaseAdapter } from '../src/adapters/sqlite/database-adapter.js';
import { loadDefaultMigrations, SqliteMigrationRunner } from '../src/adapters/sqlite/migration-runner.js';
import { SqliteMissionStore } from '../src/adapters/sqlite/mission-store.js';
import { NO_CURRENT_WORK_PORT } from '../src/application/recording/current-work-recorder.js';
import { composeProductionCapabilities } from '../src/composition/production-capabilities.js';
import { createDraftWorkflowAdapter } from '../src/adapters/cli/commands/draft-stats.js';
import { missionId } from '../src/domain/mission.js';
import { repositoryId } from '../src/domain/repository.js';
import { makeExecutePorts } from './fixtures/execute-mission-ports.js';

// ---------------------------------------------------------------------------
// TASK-2454 — the board's Draft button fails when the backlog card it targets
// has never been drafted, because the pre-draft card has no Mission aggregate
// in SQLite (draft's own intake step is what materializes it). The guard read
// that absence as "mission authority could not find the mission".
//
// The launch-location half: draft's preflight derived its base branch and its
// task-lookup root from `process.cwd()`, so a backend started inside a mission
// worktree drafted against that worktree instead of the primary checkout.
//
// Everything external is mocked: no git, no Forgejo, no agent launch.
// ---------------------------------------------------------------------------

const MAIN_CHECKOUT = '/fixture/parallix';
const MISSION_WORKTREE = '/fixture/parallix-task-2400';
const REPOSITORY = repositoryId('fixture-repository');

const directories: string[] = [];

const repositories = {
  agentBlocklist: { async findAll() { return []; }, async findByAgent() { return undefined; }, async save() {}, async deleteByAgent() {}, async clear() {} },
  operationalHistory: { async findAll() { return []; }, async findByType() { return []; }, async append() {}, async clear() {} },
  boardLaneEvents: { async findAll() { return []; }, async findByMissionId() { return []; }, async findByRepositoryId() { return []; }, async append() { return true; }, async clear() {} },
  usage: { async findAll() { return []; }, async findWhere() { return []; }, async save() {}, async saveAll() {}, async clear() {} },
};

async function isolatedStore() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'parallix-task-2454-'));
  directories.push(directory);
  const db = new SqliteDatabaseAdapter();
  await db.open({ path: path.join(directory, 'fixture.db') });
  await new SqliteMigrationRunner(db).applyPending(loadDefaultMigrations());
  return { db, store: new SqliteMissionStore(db) };
}

afterEach(() => {
  for (const directory of directories.splice(0)) { fs.rmSync(directory, { recursive: true, force: true }); }
});

interface DraftTrace {
  readonly launchDirs: string[];
  readonly taskLookupRoots: string[];
  readonly steps: string[];
}

/**
 * Draft adapter dependency mocks that record the directory context every
 * launch-sensitive step receives. `launchedFrom` stands in for the working
 * directory the backend process was started in.
 */
function draftAdapterDeps(launchedFrom: string): { deps: Record<string, unknown>; trace: DraftTrace } {
  const trace: DraftTrace = { launchDirs: [], taskLookupRoots: [], steps: [] };
  const deps: Record<string, unknown> = {
    cwdFn: () => launchedFrom,
    resolveMainRepoFn: () => MAIN_CHECKOUT,
    ensureRepoExistsFn: () => true,
    ensureStandaloneMissionBaselineFn: () => ({ committed: false }),
    ensureDraftRepoConfigCommittedFn: () => true,
    detectLaunchBaseBranchFn: (dir: string) => { trace.launchDirs.push(dir); return null; },
    resolveTaskFileFn: (slug: string, root: string) => {
      trace.taskLookupRoots.push(root);
      return { ok: true, taskFile: `${root}/backlog/tasks/${slug} - fixture.md`, matches: [] };
    },
    checkBacklogIntegrityFn: () => [],
    // Steps past preflight: recorded, never touching git or the filesystem.
    ensureMissionBranchFn: (repo: string) => { trace.steps.push(`ensureMissionBranch:${repo}`); },
    conventionalWorktreePathFn: (slug: string) => `${MAIN_CHECKOUT}-${slug}`,
  };
  return { deps, trace };
}

/**
 * The board path aborts in `setup` in these fixtures (no real worktree exists
 * to create), which is past every launch-directory decision preflight makes.
 * The recorded trace, not the dispatch outcome, is the assertion surface.
 */
async function dispatchBoardDraft(launchedFrom: string, slug: string) {
  const { db, store } = await isolatedStore();
  const { deps, trace } = draftAdapterDeps(launchedFrom);
  try {
    const { ports } = makeExecutePorts();
    const capabilities = composeProductionCapabilities(
      launchedFrom, REPOSITORY, repositories, ports, store, NO_CURRENT_WORK_PORT,
      undefined, undefined, { draftAdapterDeps: deps },
    );
    // No intake first: this is a plain backlog card straight off the board.
    assert.equal((await store.load(missionId(slug))).kind, 'missing', 'the card is pre-draft');
    const result = await capabilities.commandController.dispatch({
      operationId: `task-2454-${slug}`,
      kind: 'draft:create',
      missionId: missionId(slug),
      missionStatusAtRequest: 'backlog',
      capabilities: new Set(['mission:intake' as const]),
    });
    return { result, trace };
  } finally {
    await db.close();
  }
}

// ---------------------------------------------------------------------------
// Reproduction: the reported "mission authority could not find the mission"
// ---------------------------------------------------------------------------

test('board Draft on a pre-draft backlog card reaches the draft workflow instead of reporting a missing mission', async () => {
  const { result, trace } = await dispatchBoardDraft(MAIN_CHECKOUT, 'task-2454-repro');

  assert.notEqual(
    result.error?.message,
    'mission authority could not find the mission',
    'a backlog card that has never been drafted is the normal Draft input, not a missing mission',
  );
  assert.ok(trace.launchDirs.length > 0, 'the draft workflow ran its preflight');
  assert.equal(trace.steps[0], `ensureMissionBranch:${MAIN_CHECKOUT}`, 'the workflow proceeded past preflight');
});

// ---------------------------------------------------------------------------
// Both supported launch locations resolve the same repository context
// ---------------------------------------------------------------------------

test('board Draft anchors the draft launch directory to the main checkout when the backend runs in a mission worktree', async () => {
  const { trace } = await dispatchBoardDraft(MISSION_WORKTREE, 'task-2454-worktree');

  assert.deepEqual(trace.launchDirs, [MAIN_CHECKOUT],
    'base-branch detection reads the primary checkout, not the worktree the server happens to run in');
  assert.deepEqual(trace.taskLookupRoots.slice(0, 1), [MAIN_CHECKOUT],
    'the backlog task is looked up in the primary checkout');
  assert.deepEqual(trace.steps, [`ensureMissionBranch:${MAIN_CHECKOUT}`],
    'the mission branch is created in the primary checkout, not in the worktree the server runs in');
});

test('board Draft anchors the draft launch directory to the main checkout when the backend runs in the main checkout', async () => {
  const { trace } = await dispatchBoardDraft(MAIN_CHECKOUT, 'task-2454-main');

  assert.deepEqual(trace.launchDirs, [MAIN_CHECKOUT]);
  assert.deepEqual(trace.taskLookupRoots.slice(0, 1), [MAIN_CHECKOUT]);
});

// ---------------------------------------------------------------------------
// The CLI keeps its caller-provided context (feature-branch missions)
// ---------------------------------------------------------------------------

test('px draft keeps the caller working directory as its launch context when the board anchor is absent', () => {
  const { deps, trace } = draftAdapterDeps(MISSION_WORKTREE);
  const adapter = createDraftWorkflowAdapter({
    ...deps,
    exitFn: (code?: number) => { throw new Error(`draft exited (${code ?? 0})`); },
    logFn: () => {},
    errorFn: () => {},
  });
  const ctx = adapter.preflight(['task-2454-cli'], {});

  assert.equal(ctx.exited, false);
  assert.deepEqual(trace.launchDirs, [MISSION_WORKTREE],
    'without the board anchor the caller directory still decides the base branch');
});

// ---------------------------------------------------------------------------
// The board reports a successful Draft result for a pre-draft backlog card
// ---------------------------------------------------------------------------

test('board Draft on a pre-draft backlog card completes and runs the whole draft sequence once', async () => {
  const { db, store } = await isolatedStore();
  const slug = missionId('task-2454-outcome');
  const steps: string[] = [];
  const ctx = {
    exited: false, slug, mainRepo: MAIN_CHECKOUT,
    targetWorktree: `${MAIN_CHECKOUT}-${slug}`,
    missionFile: `${MAIN_CHECKOUT}-${slug}/missions/${slug}/MISSION.md`,
    recordedBase: null, syntheticTask: null, agent: '', actualAgent: null, agentResult: null,
    exitFn: (_code?: number) => { throw new Error('mock must not exit'); },
    logFn: () => {}, errorFn: () => {}, missionServicesFn: async () => ({}), options: {},
  } as unknown as import('../src/application/ports/cli-workflows.js').DraftWorkflowContext;
  const draftWorkflow: import('../src/application/ports/cli-workflows.js').DraftWorkflowPort = {
    preflight: (args) => { steps.push(`preflight:${args[0]}`); return ctx; },
    setup: (c) => { steps.push('setup'); return c; },
    scaffold: (c) => { steps.push('scaffold'); return c; },
    intake: async (c) => { steps.push('intake'); return c; },
    transition: async (c) => { steps.push('transition'); return c; },
    launchAgent: async (c) => { steps.push('launchAgent'); return c; },
    postProcess: async (c) => { steps.push('postProcess'); return c; },
    commitSafety: (c) => { steps.push('commitSafety'); return c; },
    finalTransition: async () => { steps.push('finalTransition'); },
  };
  try {
    const { ports } = makeExecutePorts();
    const capabilities = composeProductionCapabilities(
      MISSION_WORKTREE, REPOSITORY, repositories, ports, store, NO_CURRENT_WORK_PORT,
      undefined, undefined, { draftWorkflow },
    );
    const result = await capabilities.commandController.dispatch({
      operationId: 'task-2454-outcome',
      kind: 'draft:create',
      missionId: slug,
      missionStatusAtRequest: 'backlog',
      capabilities: new Set(['mission:intake' as const]),
    });

    assert.equal(result.status, 'completed');
    assert.deepEqual(result.value, { slug });
    assert.deepEqual(steps, [
      `preflight:${slug}`, 'setup', 'scaffold', 'intake', 'transition',
      'launchAgent', 'postProcess', 'commitSafety', 'finalTransition',
    ]);
  } finally {
    await db.close();
  }
});
