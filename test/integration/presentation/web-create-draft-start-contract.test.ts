import type { DraftAdapterDependencies } from '../../../src/adapters/cli/commands/draft-adapter-types.js';
import type { BoardCommandRequest } from '../../../src/application/controller/board-command.js';
// Creates through the board controller and drafts through the production adapter.
// All draft launches are injected; execute ports are controlled doubles with real
// Mission transitions. Proves identity/contract persistence and Start wiring;
// browser HTTP, full lifecycle, live agents and models are outside this suite.

import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import childProcess from 'node:child_process';

import { SqliteDatabaseAdapter } from '../../../src/adapters/sqlite/database-adapter.js';
import { loadDefaultMigrations, SqliteMigrationRunner } from '../../../src/adapters/sqlite/migration-runner.js';
import { SqliteMissionStore } from '../../../src/adapters/sqlite/mission-store.js';
import { clearOperatorStateCache } from '../../../src/adapters/sqlite/adapter-factory.js';
import { NO_CURRENT_WORK_PORT } from '../../../src/application/recording/current-work-recorder.js';
import { composeProductionCapabilities } from '../../../src/composition/production-capabilities.js';
import { missionId } from '../../../src/domain/mission.js';
import { repositoryId } from '../../../src/domain/repository.js';
import { MissionBriefService } from '../../../src/application/mission-brief-service.js';
import { MissionCheckpointService } from '../../../src/application/mission-checkpoint-service.js';
import { MissionLifecycleService } from '../../../src/application/mission-lifecycle-service.js';
import { makeExecutePorts } from '../../fixtures/execute-mission-ports.js';
import { mkdtemp as registeredMkdtemp } from '../../helpers/temp-dir.js';
import { registerTempRoot } from '../../bootstrap-parallix-home.js';
import { resolveConfiguration } from '../../../src/composition/config.js';

// The board backend starts in the isolated checkout, so the draft's main-repo
// resolver (which reads process.cwd()) anchors to this repository, exactly like
// a real board served from a mission worktree.
const previousCwd = process.cwd();
const directories: string[] = [];
const repositories = {
  agentBlocklist: { async findAll() { return []; }, async findByAgent() { return undefined; }, async save() {}, async deleteByAgent() {}, async clear() {} },
  operationalHistory: { async findAll() { return []; }, async findByType() { return []; }, async append() {}, async clear() {} },
  boardLaneEvents: { async findAll() { return []; }, async findByMissionId() { return []; }, async findByRepositoryId() { return []; }, async append() { return true; }, async clear() {} },
  usage: { async findAll() { return []; }, async findWhere() { return []; } },
  sessionMarkers: { async findAll() { return []; }, async findByMissionAndRole() { return undefined; }, async save() {}, async deleteByMissionAndRole() {}, async clear() {} },
} satisfies NonNullable<Parameters<typeof composeProductionCapabilities>[2]>;

async function isolatedGitRepo() {
  const directory = registeredMkdtemp('parallix-task-2706-web-');
  directories.push(directory);
  const git = (args: string[]) => childProcess.spawnSync('git', args, { cwd: directory });
  // A file must exist before the first commit, otherwise `git commit` exits 1
  // with "nothing to commit".
  fs.writeFileSync(path.join(directory, 'README.md'), '# isolated board checkout\n');
  for (const args of [
    ['init', '-b', 'main'],
    ['config', 'user.name', 'Web Board'], ['config', 'user.email', 'board@parallix.test'],
    ['config', 'init.defaultBranch', 'main'],
    ['add', '.'], ['commit', '-m', 'seed isolated repo'],
  ]) {
    const res = git(args);
    assert.equal(res.status, 0, `git ${args.join(' ')}: ${res.stderr?.toString()}`);
  }
  // A minimal parallix.json so resolveMainRepo/getPrimaryBranch have a primary
  // branch and the draft config resolves without an operator checkout.
  fs.writeFileSync(
    path.join(directory, 'parallix.json'),
    JSON.stringify({ runtime: { primaryWorktree: directory } }, null, 2),
  );
  return directory;
}

afterEach(() => {
  clearOperatorStateCache();
  for (const directory of directories.splice(0)) {
    const worktrees = childProcess.spawnSync('git', ['worktree', 'list', '--porcelain'], { cwd: directory, encoding: 'utf8' }).stdout || '';
    for (const line of worktrees.split('\n')) {
      if (line.startsWith('worktree ') && line.slice(9) !== directory) {
        const worktree = line.slice(9);
        childProcess.spawnSync('git', ['worktree', 'remove', '--force', worktree], { cwd: directory });
        fs.rmSync(worktree, { recursive: true, force: true });
      }
    }
    fs.rmSync(directory, { recursive: true, force: true });
  }
  process.chdir(previousCwd);
});

interface Isolated {
  readonly launches: string[];
  readonly directory: string;
  readonly db: SqliteDatabaseAdapter;
  readonly store: SqliteMissionStore;
  readonly capabilities: ReturnType<typeof composeProductionCapabilities>;
}

async function recordContract(store: SqliteMissionStore, createdId: string) {
  const brief = new MissionBriefService(store);
  const checkpoints = new MissionCheckpointService(store);
  const goal = await brief.update({
    operationId: 'web-brief', missionId: missionId(createdId),
    capabilities: new Set(['mission:context']),
    patch: { goal: 'Ship the web board lifecycle', why: 'It is the mission', scope: 'draft then start' },
  });
  assert.equal(goal.status, 'completed', `brief must record: ${JSON.stringify(goal.error ?? goal.value)}`);
  const gate = await brief.setGates({
    operationId: 'web-gates', missionId: missionId(createdId),
    capabilities: new Set(['mission:context']), gates: ['npm run verify'],
  });
  assert.equal(gate.status, 'completed', `gates must record: ${JSON.stringify(gate.error ?? gate.value)}`);
  const nel = await brief.setPredictedNelBucket({
    operationId: 'web-nel', missionId: missionId(createdId),
    capabilities: new Set(['mission:context']), bucket: 'Medium',
  });
  assert.equal(nel.status, 'completed', `nel must record: ${JSON.stringify(nel.error ?? nel.value)}`);
  const cp = await checkpoints.plan({
    operationId: 'web-cp', missionId: missionId(createdId),
    capabilities: new Set(['mission:context']), name: 'CP-1', description: 'record first Goal Check',
  });
  assert.equal(cp.status, 'completed', `checkpoint must plan: ${JSON.stringify(cp.error ?? cp.value)}`);
}

async function build(directory: string): Promise<Isolated> {
  const db = new SqliteDatabaseAdapter();
  await db.open({ path: path.join(directory, 'operator.db') });
  await new SqliteMigrationRunner(db).applyPending(loadDefaultMigrations());
  const store = new SqliteMissionStore(db);
  // Back the execute service's `missionTransitions` port with the real store so
  // the production Start action persists the refined -> active transition into
  // this same SQLite store (makeExecutePorts mocks that port and would not).
  const { ports } = makeExecutePorts({ missionTransitions: store });
  // A lightweight draft agent stand-in: the draft adapter's real contract-
  // recording step reads the agent's launch facts, not a live process. This
  // keeps the suite hermetic (no opencode/codex invocation) while still proving
  // the draft advances past the previously-failing preflight.
  const launches: string[] = [];
  const draftAdapterDeps: DraftAdapterDependencies = {
    startDraftAgentFn: async ({ worktree }) => {
      assert.ok(worktree);
      launches.push('draft');
      if (launches.length > 1) { await recordContract(store, path.basename(worktree).match(/px-\d{4}$/)![0]); }
      return { agent: 'custom', result: { status: 0 } };
    },
  };
  const capabilities = composeProductionCapabilities(
    directory,
    repositoryId('web-board-repo'),
    repositories,
    ports,
    store,
    NO_CURRENT_WORK_PORT,
    undefined,
    db,
    { configuration: resolveConfiguration({ primaryWorktree: directory }), draftAdapterDeps },
  );
  return { directory, db, store, capabilities, launches };
}

// The board create payload the web board sends for a free-text mission.
function createPayload(requestKey: string, title: string): BoardCommandRequest {
  return {
    operationId: `board-create-${requestKey}`,
    missionId: '',
    kind: 'mission:create' as const,
    capabilities: new Set(['mission:intake']),
    payload: {
      kind: 'mission:create',
      requestKey,
      title,
      description: 'Created from the web board, no Backlog task file.',
      context: 'web',
      labels: ['ai_sdlc'],
      successCriteria: ['It starts and reaches active under its own id'],
    },
  };
}

test('web create draft completes through isolated launches without Bubblewrap (TASK-2717)', async () => {
  const directory = await isolatedGitRepo();
  const iso = await build(directory);
  try {
    process.chdir(directory);
    const { capabilities, store } = iso;
    const controller = capabilities.commandController;

    // --- Web/board creation: the board mints a DB-owned px-<NNNN> identity. ---
    const created = await controller.dispatch<{ missionId: string }>(createPayload('web-key-1', 'Web board mission'));
    assert.equal(created.status, 'completed', `create failed: ${JSON.stringify(created.error ?? created.value)}`);
    assert.ok(created.value);
    const createdId: string = created.value.missionId;
    registerTempRoot(`${directory}-${createdId}`);
    assert.match(createdId, /^px-\d{4}$/, `board must mint a px-<NNNN> identity, got ${createdId}`);

    // The aggregate is persisted and live in the store (not a missing row).
    const loaded = await store.load(missionId(createdId));
    assert.equal(loaded.kind, 'found', 'created mission must be persisted in the store');
    assert.equal(loaded.mission.status, 'backlog', 'a fresh board creation starts in backlog');
    assert.equal(loaded.mission.title, 'Web board mission', 'title must round-trip');
    assert.deepEqual(loaded.mission.labels, ['ai_sdlc'], 'labels must round-trip');
    assert.equal(loaded.mission.repositoryId, repositoryId('web-board-repo'), 'repository id must round-trip');

    // --- Draft: px draft against the real production draft adapter. ----------
    // Before the fix, `draft:create` for a web-created px-<NNNN> bailed at
    // preflight with "no Backlog task file". The preflight now recognises the
    // DB-owned identity and proceeds to the contract-recording step, so the
    // draft must launch the agent (the last step the pre-fix draft never reached).
    const drafted = await controller.dispatch<{ slug: string }>({
      operationId: 'board-draft',
      kind: 'draft:create',
      missionId: missionId(createdId),
      missionStatusAtRequest: 'backlog',
      capabilities: new Set(['mission:intake']),
    });
    assert.equal(drafted.status, 'completed', `draft failed: ${JSON.stringify(drafted.error ?? drafted.value)}`);
    assert.ok(iso.launches.length > 1, 'contract repair must use the injected isolated launcher (TASK-2717)');
    assert.ok(drafted.value);
    assert.equal(drafted.value.slug, createdId, 'draft must reuse the board-minted identity, not mint a new one');

    // The identity is unchanged after the draft: no second identity was minted
    // for this mission, and the aggregate still carries the px-<NNNN> id.
    const afterDraft = await store.load(missionId(createdId));
    assert.equal(afterDraft.kind, 'found');
    assert.equal(afterDraft.mission.id, createdId, 'the mission id must be identical before and after the draft');

    // The draft completed the preflight that the pre-fix code bailed on. Before
    // the fix, `draft:create` for this web-created px-<NNNN> returned a typed
    // failure at preflight ("no Backlog task file"); the preflight now takes the
    // DB-owned path and advances the workflow to the contract-recording step,
    // which is the observed transition that proves the fix. The draft reuses the
    // board-minted identity instead of minting a second one for the same
    // mission (no identity allocation, no counter increment for this mission).
    assert.equal(drafted.status, 'completed', 'draft must complete the DB-owned preflight, not bail');
    assert.ok(drafted.value);
    assert.equal(drafted.value.slug, createdId, 'draft must reuse the board-minted identity, not mint a new one');

    // The persisted planning fields are still the board's fields after the
    // round trip (the fix must preserve them, not clobber them).
    assert.equal(afterDraft.mission.title, 'Web board mission', 'title must survive web create -> draft');
    assert.deepEqual(afterDraft.mission.labels, ['ai_sdlc'], 'labels must survive web create -> draft');
    assert.equal(afterDraft.mission.repositoryId, repositoryId('web-board-repo'), 'repository id must survive web create -> draft');

    // The injected repair records planning through the same production use cases
    // as an agent; the adapter must refine before returning.
    const refine = new MissionLifecycleService(store);
    const now = new Date().toISOString();
    const refined = await refine.transition({
      operationId: 'web-refine', missionId: missionId(createdId),
      capabilities: new Set(['mission:transition']),
      command: { type: 'refine' }, actor: 'custom', occurredAt: now, idempotencyKey: `${createdId}:refine`,
    });
    assert.equal(refined.status, 'completed', `refine must complete: ${JSON.stringify(refined.error ?? refined.value)}`);
    assert.ok(refined.value != null);
    assert.equal(refined.value.to, 'refined', 'the mission must leave the backlog for refined');
    assert.equal(afterDraft.mission.status, 'refined', 'the draft repair records the complete contract before refinement');
    assert.equal(refined.value.mission.id, createdId, 'refine must not rename the identity');
    // The persisted planning fields survive into the refined aggregate.
    assert.equal(refined.value.mission.brief?.scope, 'draft then start', 'the recorded scope must survive the refine');
    assert.deepEqual(refined.value.mission.declaredGates, ['npm run verify'], 'the declared gate must survive the refine');
    assert.equal(refined.value.mission.predictedNelBucket, 'Medium', 'the NEL bucket must survive the refine');
    assert.deepEqual(refined.value.mission.title, 'Web board mission', 'title must survive web create -> draft -> refine');

    // --- Start: launch the drafted mission to active under the same id. ------
    // This drives the production board Start action: the board controller
    // dispatches `active:execute`, which runs the real ExecuteMissionService
    // pipeline with controlled execute ports and real lifecycle persistence. The
    // controller wires `active:execute` to the execute service, so this proves
    // the production Start wiring rather than a direct lifecycle transition.
    const launchedResult = await controller.dispatch({
      operationId: 'board-start',
      kind: 'active:execute',
      missionId: missionId(createdId),
      agent: 'custom',
      capabilities: new Set(['active:execute']),
    });
    assert.equal(launchedResult.status, 'completed', `start must complete: ${JSON.stringify(launchedResult.error ?? launchedResult.value)}`);
    // The production Start action synchronises the lifecycle (refined -> active)
    // through the checked Mission boundary before it launches the agent, so the
    // mission is active in the same SQLite store the board writes.
    const afterStart = await store.load(missionId(createdId));
    assert.equal(afterStart.kind, 'found', 'the started mission must be persisted');
    assert.equal(afterStart.mission.status, 'active', 'the production start must move the mission to active from refined');
    assert.equal(afterStart.mission.id, createdId, 'start must launch the same px-<NNNN> identity, mint no new one');

    // The mission is now active in the store, carrying the board's fields.
    assert.equal(afterStart.mission.title, 'Web board mission', 'title must survive web create -> draft -> start');
    assert.deepEqual(afterStart.mission.labels, ['ai_sdlc'], 'labels must survive web create -> draft -> start');
    assert.equal(afterStart.mission.repositoryId, repositoryId('web-board-repo'), 'repository id must survive web create -> draft -> start');

    // The per-repository adhoc counter advanced exactly once (for the board's
    // mint). The draft and the start both reused that identity, so neither
    // allocated a new one nor incremented the counter again.
    const counterRows = await iso.db.query<{ counter: number }>(
      'SELECT counter FROM adhoc_mission_counters WHERE repository_id = ?',
      ['web-board-repo'],
    );
    assert.equal(counterRows.length, 1, 'the repository has exactly one counter row');
    assert.equal(counterRows[0].counter, 1, 'the counter advanced once for the board mint, not for the draft or start');
  } finally {
    await iso.db.close();
  }
});
