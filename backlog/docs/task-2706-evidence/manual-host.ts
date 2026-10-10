// Manual browser-session host for TASK-2706. Not a discovered test suite.
// Real web assets/HTTP/board composition/draft workflow/Git/SQLite; controlled agent effects.

import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import childProcess from 'node:child_process';

import { SqliteDatabaseAdapter } from '../../../src/adapters/sqlite/database-adapter.js';
import { loadDefaultMigrations, SqliteMigrationRunner } from '../../../src/adapters/sqlite/migration-runner.js';
import { SqliteMissionStore } from '../../../src/adapters/sqlite/mission-store.js';
import { NO_CURRENT_WORK_PORT } from '../../../src/application/recording/current-work-recorder.js';
import { composeProductionCapabilities } from '../../../src/composition/production-capabilities.js';
import { repositoryId } from '../../../src/domain/repository.js';
import { MissionBriefService } from '../../../src/application/mission-brief-service.js';
import { MissionCheckpointService } from '../../../src/application/mission-checkpoint-service.js';
import { makeExecutePorts } from '../../../test/fixtures/execute-mission-ports.js';
import os from 'node:os';
const registeredMkdtemp = (prefix:string) => fs.mkdtempSync(path.join(os.tmpdir(),prefix));
import { resolveConfiguration } from '../../../src/composition/config.js';

// The board backend starts in the isolated checkout, so the draft's main-repo
// resolver (which reads process.cwd()) anchors to this repository, exactly like
// a real board served from a mission worktree.
const previousCwd = process.cwd();
const repositories = {
  agentBlocklist: { async findAll() { return []; }, async findByAgent() { return undefined; }, async save() {}, async deleteByAgent() {}, async clear() {} },
  operationalHistory: { async findAll() { return []; }, async findByType() { return []; }, async append() {}, async clear() {} },
  boardLaneEvents: { async findAll() { return []; }, async findByMissionId() { return []; }, async findByRepositoryId() { return []; }, async append() { return true; }, async clear() {} },
  usage: { async findAll() { return []; }, async findWhere() { return []; }, async save() {}, async saveAll() {}, async clear() {} },
  sessionMarkers: { async append() {}, async clear() {} },
};

async function isolatedGitRepo() {
  const directory = registeredMkdtemp('parallix-task-2706-web-');
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
  ports.agentExecution.prepare = async () => ({prompt:'Manual isolated execute',agentConfig:{},agent:'custom'});
  // A lightweight draft agent stand-in: the draft adapter's real contract-
  // recording step reads the agent's launch facts, not a live process. This
  // keeps the manual session isolated (no model invocation) while proving
  // the draft advances past the previously-failing preflight.
  const draftAdapterDeps = {
    startDraftAgentFn: async () => {
      const [mission] = await store.loadByRepository(repositoryId('web-board-repo'));
      console.log('DRAFT_AGENT_ENTERED', mission.id, mission.status);
      const brief = new MissionBriefService(store);
      const cap = new Set(['mission:context']);
      await brief.update({operationId:'manual-brief', missionId:mission.id, capabilities:cap, patch:{scope:'Create, draft and start',outOfScope:[]}});
      await brief.setGates({operationId:'manual-gates',missionId:mission.id,capabilities:cap,gates:['true']});
      await brief.setPredictedNelBucket({operationId:'manual-nel',missionId:mission.id,capabilities:cap,bucket:'Small'});
      await new MissionCheckpointService(store).plan({operationId:'manual-cp',missionId:mission.id,capabilities:cap,name:'CP-1',description:'Verify web lifecycle'});
      return {agent:'custom',result:{status:0}};
    },
  };
  const capabilities = composeProductionCapabilities(
    directory,
    repositoryId('web-board-repo'),
    repositories,
    ports,
    store,
    NO_CURRENT_WORK_PORT,
    event => console.log("PROGRESS", JSON.stringify(event)),
    db,
    { configuration: resolveConfiguration({ primaryWorktree: directory }), draftAdapterDeps },
  );
  return { directory, db, store, capabilities };
}


import { createWebHost } from '../../../src/interfaces/web/host.js';
import { loadWebAssets } from '../../../src/adapters/web/asset-store.js';
const directory = process.env.MANUAL_REUSE_DIR ?? await isolatedGitRepo();
process.env.PARALLIX_HOME = path.join(directory, 'isolated-home');
process.chdir(directory);
const iso = await build(directory);
const host = createWebHost({ assets:loadWebAssets(path.join(previousCwd,'build/web')), buildProjection:()=>iso.capabilities.boardProjection.build(), commandDispatcher:()=>iso.capabilities.commandController });
const info = await host.start();
fs.writeFileSync(path.join(previousCwd,'backlog/docs/task-2706-evidence/session-location.json'),JSON.stringify({directory,origin:info.origin,revision:childProcess.execFileSync('git',['rev-parse','HEAD'],{cwd:previousCwd}).toString().trim()}));
console.log('MANUAL_SESSION', info.origin, directory);
process.on('SIGTERM',async()=>{await host.close();await iso.db.close();process.exit(0);});
