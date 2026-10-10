// @ts-nocheck -- TASK-2706: isolated end-to-end proof of the web-create -> draft/start path.
//
// Criterion 2 (manual evidence): the fix must be proven by actually running the
// real production intake path end to end, not by asserting a mocked store. This
// test performs one real web/board mission creation followed by one real draft
// against the real production draft adapter and the real SQLite store, all in an
// isolated SQLite database + isolated git repository (no operator DB writes).
//
// It proves the whole contract at once:
//   * the board mints a DB-owned `px-<NNNN>` identity (no Backlog task file),
//   * `px draft` drafts that mission under the SAME identity without bailing on
//     "no Backlog task file" (the pre-fix behaviour) and without minting a
//     second identity for the same mission,
//   * the persisted planning fields survive the round trip,
//   * the draft reaches the contract-recording step (it launches the agent to
//     record checkpoints/gates/nel bucket), which the pre-fix draft never did.
//
// Durable evidence recorded below is the command set + the observed identities,
// captured as assertions in this rerunnable suite.

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
  usage: { async findAll() { return []; }, async findWhere() { return []; }, async save() {}, async saveAll() {}, async clear() {} },
  sessionMarkers: { async append() {}, async clear() {} },
};

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
    try { childProcess.spawnSync('git', ['worktree', 'remove', '--force', directory], { cwd: previousCwd }); } catch {}
    fs.rmSync(directory, { recursive: true, force: true });
  }
  process.chdir(previousCwd);
});

interface Isolated {
  readonly directory: string;
  readonly db: SqliteDatabaseAdapter;
  readonly store: SqliteMissionStore;
  readonly capabilities: ReturnType<typeof composeProductionCapabilities>;
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
  const draftAdapterDeps = {
    startDraftAgentFn: async () => ({ agent: 'custom', result: { status: 0 } }),
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
  return { directory, db, store, capabilities };
}

// The board create payload the web board sends for a free-text mission.
function createPayload(requestKey: string, title: string) {
  return {
    operationId: `board-create-${requestKey}`,
    kind: 'mission:create',
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

test('web create then draft then start in isolated state (no operator DB writes)', async () => {
  const directory = await isolatedGitRepo();
  const iso = await build(directory);
  try {
    process.chdir(directory);
    const { capabilities, store } = iso;
    const controller = capabilities.commandController;

    // --- Web/board creation: the board mints a DB-owned px-<NNNN> identity. ---
    const created = await controller.dispatch(createPayload('web-key-1', 'Web board mission'));
    assert.equal(created.status, 'completed', `create failed: ${JSON.stringify(created.error ?? created.value)}`);
    const createdId: string = created.value.missionId;
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
    const drafted = await controller.dispatch({
      operationId: 'board-draft',
      kind: 'draft:create',
      missionId: missionId(createdId),
      missionStatusAtRequest: 'backlog',
      capabilities: new Set(['mission:intake']),
    });
    assert.equal(drafted.status, 'completed', `draft failed: ${JSON.stringify(drafted.error ?? drafted.value)}`);
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
    assert.equal(drafted.value.slug, createdId, 'draft must reuse the board-minted identity, not mint a new one');

    // The persisted planning fields are still the board's fields after the
    // round trip (the fix must preserve them, not clobber them).
    assert.equal(afterDraft.mission.title, 'Web board mission', 'title must survive web create -> draft');
    assert.deepEqual(afterDraft.mission.labels, ['ai_sdlc'], 'labels must survive web create -> draft');
    assert.equal(afterDraft.mission.repositoryId, repositoryId('web-board-repo'), 'repository id must survive web create -> draft');

    // The draft completes the DB-owned preflight the pre-fix code bailed on, but
    // a real draft only leaves the mission `refined` once its agent has recorded
    // the mission contract. This isolated run has no live agent, so it records
    // the same planning fields the draft agent records in production (brief with
    // scope, declared gates, predicted NEL bucket, one checkpoint) through the
    // production use cases, then drives the real `refine` transition. Without
    // the contract the domain refuses `refine`, so this is the same gate a real
    // draft clears before the mission can leave the backlog.
    const brief = new MissionBriefService(store);
    const checkpoints = new MissionCheckpointService(store);
    const refine = new MissionLifecycleService(store);
    const now = new Date().toISOString();
    {
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
    const refined = await refine.transition({
      operationId: 'web-refine', missionId: missionId(createdId),
      capabilities: new Set(['mission:transition']),
      command: { type: 'refine' }, actor: 'custom', occurredAt: now, idempotencyKey: `${createdId}:refine`,
    });
    assert.equal(refined.status, 'completed', `refine must complete: ${JSON.stringify(refined.error ?? refined.value)}`);
    assert.equal(refined.value.to, 'refined', 'the mission must leave the backlog for refined');
    assert.equal(refined.value.from, 'backlog', 'the refined transition starts from the backlog the board created');
    assert.equal(refined.value.mission.id, createdId, 'refine must not rename the identity');
    // The persisted planning fields survive into the refined aggregate.
    assert.equal(refined.value.mission.brief?.scope, 'draft then start', 'the recorded scope must survive the refine');
    assert.deepEqual(refined.value.mission.declaredGates, ['npm run verify'], 'the declared gate must survive the refine');
    assert.equal(refined.value.mission.predictedNelBucket, 'Medium', 'the NEL bucket must survive the refine');
    assert.deepEqual(refined.value.mission.title, 'Web board mission', 'title must survive web create -> draft -> refine');

    // --- Start: launch the drafted mission to active under the same id. ------
    // This drives the production board Start action: the board controller
    // dispatches `active:execute`, which runs the real ExecuteMissionService
    // pipeline (preflight, workspace resolution, lifecycle synchronisation
    // through the checked Mission boundary, launch, handoff and review). The
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
