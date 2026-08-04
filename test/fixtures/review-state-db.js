// Seed a real operator database for the review-state cutover tests.
//
// After TASK-2322.12 the review loop's state lives on the Review aggregate, so
// exercising readReviewState/writeReviewState means standing up an actual
// migrated database rather than writing a JSON file. Everything is resolved
// through PARALLIX_HOME, which is what the composition root keys off.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const { SqliteDatabaseAdapter } = require('../../.test-runtime/adapters/sqlite/database-adapter.js');
const { SqliteMigrationRunner, loadDefaultMigrations } = require('../../.test-runtime/adapters/sqlite/migration-runner.js');
const { SqliteMissionStore } = require('../../.test-runtime/adapters/sqlite/mission-store.js');
const { clearOperatorStateCache } = require('../../.test-runtime/adapters/sqlite/adapter-factory.js');
const { missionId, missionLabels } = require('../../.test-runtime/domain/mission.js');
const { repositoryId } = require('../../.test-runtime/domain/repository.js');
const { agentFamily } = require('../../.test-runtime/domain/agents.js');
const { changeRevision } = require('../../.test-runtime/domain/review.js');

/** A Mission carrying a round-1 Review, the shape `px handoff` produces. */
function missionWithReview(slug, rootDir, overrides = {}) {
  return {
    id: missionId(slug),
    repositoryId: repositoryId(rootDir),
    title: `Mission ${slug}`,
    labels: missionLabels([]),
    assignee: agentFamily('claude'),
    status: 'review',
    rawStatus: 'review',
    checkpoints: [],
    netEngineeringLines: null,
    closedAt: null,
    externalTaskRef: null,
    intakeTrace: null,
    review: {
      rounds: [{
        number: 1,
        subject: {
          change: { kind: 'local-branch', sourceBranch: `mission/${slug}`, targetBranch: 'main' },
          revision: changeRevision('rev-1'),
        },
        reviewer: agentFamily('codex'),
        implementer: agentFamily('claude'),
        startedAt: '2026-08-02T10:00:00.000Z',
        decision: null,
        response: null,
        phase: 'reviewing',
        disposition: null,
        reviewerRetryCount: 0,
        implementerRetryCount: 0,
      }],
      intervention: null,
      stageLaunches: [],
      gateFailureRetryCount: 0,
      reviewEvents: [],
      ...overrides,
    },
  };
}

/**
 * Run `fn` against a mission worktree whose PARALLIX_HOME holds a migrated
 * database. When `seedReview` is false the mission is stored without a Review,
 * which is how a mission looks before `px handoff`.
 */
async function withMissionDatabase(slug, fn, { seedReview = true, reviewOverrides = {} } = {}) {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'review-state-db-'));
  const home = path.join(tmpRoot, 'parallix-home');
  fs.mkdirSync(home, { recursive: true });

  const missionDir = path.join(tmpRoot, 'missions', slug);
  fs.mkdirSync(missionDir, { recursive: true });
  fs.writeFileSync(path.join(missionDir, 'MISSION.md'), `# Mission: ${slug}\n`);

  spawnSync('git', ['init'], { cwd: tmpRoot });
  spawnSync('git', ['config', 'user.email', 'test@test.com'], { cwd: tmpRoot });
  spawnSync('git', ['config', 'user.name', 'Test'], { cwd: tmpRoot });
  spawnSync('git', ['checkout', '-b', `mission/${slug}`], { cwd: tmpRoot });
  spawnSync('git', ['add', '.'], { cwd: tmpRoot });
  spawnSync('git', ['commit', '-m', 'init', '--allow-empty'], { cwd: tmpRoot });

  const previousHome = process.env.PARALLIX_HOME;
  const previousCwd = process.cwd();
  process.env.PARALLIX_HOME = home;
  clearOperatorStateCache();
  process.chdir(tmpRoot);

  const database = new SqliteDatabaseAdapter();
  await database.open({ path: path.join(home, 'parallix.db') });
  await new SqliteMigrationRunner(database).applyPending(loadDefaultMigrations());
  const store = new SqliteMissionStore(database);

  const mission = missionWithReview(slug, tmpRoot, reviewOverrides);
  await store.save(seedReview ? mission : { ...mission, review: null }, null);
  try {
    await fn({ root: tmpRoot, missionDir, slug, home, store, openStore: async () => {
      const db = new SqliteDatabaseAdapter();
      await db.open({ path: path.join(home, 'parallix.db') });
      return { db, store: new SqliteMissionStore(db) };
    } });
  } finally {
    await database.close();
    process.chdir(previousCwd);
    if (previousHome === undefined) { delete process.env.PARALLIX_HOME; }
    else { process.env.PARALLIX_HOME = previousHome; }
    clearOperatorStateCache();
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
}

/**
 * Point PARALLIX_HOME at `home`, migrate a database there, and store one
 * mission carrying a Review. For tests that own their own worktree layout and
 * only need the review-state reads to resolve.
 *
 * Returns a restore function.
 */
async function seedMissionDatabase(home, slug, rootDir, roundOverrides = {}, laterRounds = []) {
  fs.mkdirSync(home, { recursive: true });
  const previousHome = process.env.PARALLIX_HOME;
  process.env.PARALLIX_HOME = home;
  // Awaited: the cache closes its handles asynchronously, and seeding while a
  // previous connection is still closing is how "database is locked" happens.
  await clearOperatorStateCache();

  const database = new SqliteDatabaseAdapter();
  await database.open({ path: path.join(home, 'parallix.db') });
  await new SqliteMigrationRunner(database).applyPending(loadDefaultMigrations());

  const mission = missionWithReview(slug, rootDir);
  const [round] = mission.review.rounds;
  // `laterRounds` are numbered after the first, so a caller can seed the
  // multi-round history a fix-round count is derived from.
  const rounds = [
    { ...round, ...roundOverrides },
    ...laterRounds.map((overrides, index) => ({ ...round, number: index + 2, ...overrides })),
  ];
  await new SqliteMissionStore(database).save({
    ...mission,
    review: { ...mission.review, rounds },
  }, null);

  // The fixture seeds the post-cutover database directly, so `rootDir` has
  // already been imported by construction. Without the ledger row the
  // composition root's preflight gate re-imports the worktree's Markdown and
  // reports every seeded field as a divergence conflict.
  await database.execute(
    `INSERT INTO import_history (source_path, digest, imported_count, skipped_count, imported_at, backup_path)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [rootDir, `seeded-${slug}`, 1, 0, new Date().toISOString(), null],
  );
  const store = new SqliteMissionStore(database);
  const restore = async () => {
    await database.close();
    if (previousHome === undefined) { delete process.env.PARALLIX_HOME; }
    else { process.env.PARALLIX_HOME = previousHome; }
    clearOperatorStateCache();
  };
  restore.store = store;
  return restore;
}

module.exports = { withMissionDatabase, missionWithReview, seedMissionDatabase };
