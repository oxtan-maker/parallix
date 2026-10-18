import { fixtureMission as typedMissionFixture } from '../fixtures/mission-builders.js';
// Composed fixture for the integration repair loop (TASK-2620).
//
// A real Git repository with a mission worktree, the production SQLite Mission
// store under a PARALLIX_HOME the fixture owns, and the real create-cli command
// registry. Only the external boundaries are replaced: the agent launcher
// (`setWorkflowLaunchPort`), and the review provider (disabled, so no Forgejo
// HTTP is reachable). Gates run through the real gate runner with cheap shell
// commands whose outcome the fixture controls through files in the worktree.
import assert from 'node:assert/strict';
import { before, after } from 'node:test';
import { mkdtemp } from '../helpers/temp-dir.js';
import { resolveConfiguration } from '../../src/composition/config.js';
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';

import { agentFamily } from '../../src/domain/agents.js';
import { missionId, missionLabels, type Mission } from '../../src/domain/mission.js';
import { repositoryId } from '../../src/domain/repository.js';
import {
  applyReviewerCommand,
  changeRevision,
  ConfiguredReviewerEligibility,
  startReview,
  type Review,
} from '../../src/domain/review.js';
import { SqliteDatabaseAdapter } from '../../src/adapters/sqlite/database-adapter.js';
import { SqliteMigrationRunner, loadDefaultMigrations } from '../../src/adapters/sqlite/migration-runner.js';
import { SqliteMissionStore } from '../../src/adapters/sqlite/mission-store.js';
import { resolveDatabasePath } from '../../src/adapters/sqlite/database-path-resolver.js';
import { resolveCanonicalRepositoryId } from '../../src/adapters/git/repository-identity.js';
import { clearOperatorStateCache } from '../../src/adapters/sqlite/adapter-factory.js';
import { configureMissionWriteAuthorization } from '../../src/application/ports/mission-write-authorization.js';

// Cases share only the immutable, closed schema. Every Mission, repository and
// writable connection remains private, including cases that abort in setup.
let schemaRoot: string;
let schemaPath: string;
before(async () => {
  schemaRoot = mkdtemp('repair-schema-');
  schemaPath = path.join(schemaRoot, 'template.db');
  const database = new SqliteDatabaseAdapter();
  try {
    await database.open({ path: schemaPath });
    await new SqliteMigrationRunner(database).applyPending(loadDefaultMigrations());
  } finally { await database.close(); }
});
after(() => { if (schemaRoot) fs.rmSync(schemaRoot, { recursive: true, force: true }); });

/** Copy only closed, empty schema state; never share a writable case database. */
export function copyRepairSchema(databasePath: string): void {
  fs.mkdirSync(path.dirname(databasePath), { recursive: true });
  fs.copyFileSync(schemaPath, databasePath);
}

export const REVIEWER = agentFamily('codex');
export const IMPLEMENTER = agentFamily('custom');

export interface RepairFixture {
  readonly root: string;
  readonly repo: string;
  readonly worktree: string;
  readonly slug: string;
  readonly approvedRevision: string;
  readonly database: SqliteDatabaseAdapter;
  git(_cwd: string, _args: string[]): string;
  load(): Promise<Mission>;
  version(): Promise<number>;
  laneEvents(): Promise<ReadonlyArray<{ from_status: string | null; to_status: string; trigger: string }>>;
  close(): Promise<void>;
}

const GATE_COMMAND = 'test -f repaired.txt || { echo "AssertionError: repaired.txt is missing" >&2; exit 1; }';

export function integrationGateCommand(): string { return GATE_COMMAND; }

function git(cwd: string, args: string[]): string {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  assert.equal(result.status, 0, `git ${args.join(' ')}: ${result.stderr}`);
  return result.stdout.trim();
}

/**
 * An approved mission in the integration lane, the state a human leaves it in
 * before running `px integrate`. `status` lets a caller start from the
 * post-bounce active state task-2555/2606 were stranded in.
 */
export async function openRepairFixture(options: {
  slug: string;
  gateCommand?: string;
  recordBaseline?: boolean;
  extraGates?: Array<{ key: string; command: string; order: number; retries?: number }>;
  /** `undecided-review`: a review-lane mission whose round awaits a reviewer decision. */
  state?: 'approved-integration' | 'undecided-review';
}): Promise<RepairFixture> {
  const { slug } = options;
  const root = fs.realpathSync(mkdtemp('parallix-task-2620-'));
  const repo = path.join(root, 'repo');
  const worktree = path.join(root, `repo-${slug}`);
  fs.mkdirSync(path.join(repo, 'backlog', 'tasks'), { recursive: true });
  fs.mkdirSync(path.join(repo, 'config'), { recursive: true });
  // Match the product checkout: retained runtime output is not mission input.
  // The feature and repaired files remain tracked verification inputs.
  fs.writeFileSync(path.join(repo, '.gitignore'), '.workflow/\n');
  fs.writeFileSync(path.join(repo, 'workflow.config.json'), JSON.stringify({
    product: { name: 'parallix' },
    adapters: {
      tasks: { provider: 'backlog-md', storage: 'backlog', stateMap: 'config/state-map.json' },
      missions: { baseDir: 'missions', branchPrefix: 'mission/', worktreePattern: '../<repo>-<slug>' },
      review: { provider: 'none' },
      verification: { command: ':' },
      agents: { models: { custom: 'fixture' } },
      gates: {
        requirePreIntegration: true,
        preIntegration: [
          { key: 'unit', command: options.gateCommand ?? GATE_COMMAND, order: 1 },
          ...(options.extraGates ?? []),
        ],
      },
    },
  }, null, 2));
  fs.copyFileSync(path.resolve('config/agents.json'), path.join(repo, 'config', 'agents.json'));
  fs.writeFileSync(path.join(repo, 'config', 'state-map.json'), JSON.stringify({ ready: 'refined', approved: 'ready-for-integration' }));
  fs.writeFileSync(path.join(repo, 'backlog', 'tasks', `${slug} - Fixture.md`),
    `---\nid: ${slug.toUpperCase()}\ntitle: Fixture\nstatus: ready-for-integration\nassignee: [custom]\nlabels: []\n---\n`);
  git(repo, ['init', '-b', 'main']);
  git(repo, ['config', 'user.name', 'Fixture']);
  git(repo, ['config', 'user.email', 'fixture@example.com']);
  git(repo, ['add', '.']);
  git(repo, ['commit', '-m', 'fixture']);
  git(repo, ['worktree', 'add', '-b', `mission/${slug}`, worktree]);
  fs.writeFileSync(path.join(worktree, 'feature.txt'), 'approved feature\n');
  git(worktree, ['add', 'feature.txt']);
  git(worktree, ['commit', '-m', `${slug}: approved feature`]);
  const approvedRevision = git(worktree, ['rev-parse', 'HEAD']);

  // The fixture owns its operator state. Inheriting the worker's
  // PARALLIX_HOME made a direct `npx tsx --test` run write to (and collide
  // with) whatever missions the operator database already held.
  const previousHome = process.env.PARALLIX_HOME;
  const previousPrimary = process.env.PRIMARY_WORKTREE;
  const previousConfinement = process.env.PARALLIX_NO_BUBBLEWRAP;
  const previousCwd = process.cwd();
  const database = new SqliteDatabaseAdapter();
  const close = async () => {
    configureMissionWriteAuthorization(null);
    try {
      await database.close();
      await clearOperatorStateCache();
    } finally {
      if (previousHome === undefined) { delete process.env.PARALLIX_HOME; } else { process.env.PARALLIX_HOME = previousHome; }
      if (previousPrimary === undefined) { delete process.env.PRIMARY_WORKTREE; } else { process.env.PRIMARY_WORKTREE = previousPrimary; }
      if (previousConfinement === undefined) { delete process.env.PARALLIX_NO_BUBBLEWRAP; } else { process.env.PARALLIX_NO_BUBBLEWRAP = previousConfinement; }
      process.chdir(previousCwd);
      fs.rmSync(root, { recursive: true, force: true });
    }
  };
  try {
    // This fixture owns the primary checkout; pin the supported override so
    // recovery exercises the repair contract rather than repeatedly discovering it.
    process.env.PRIMARY_WORKTREE = repo;
    // Agents are injected in-process. Sandbox discovery cannot confine those
    // doubles and belongs to the launcher contracts, not this repair workflow.
    process.env.PARALLIX_NO_BUBBLEWRAP = '1';
    process.env.PARALLIX_HOME = path.join(root, 'parallix-home');
    // Repair fixtures have no blocked agents or legacy operator configuration.
    // Seed that explicit neutral state so every eligibility read need not scan
    // old worktree locations for a migration these contracts do not exercise.
    fs.mkdirSync(process.env.PARALLIX_HOME, { recursive: true });
    fs.writeFileSync(path.join(process.env.PARALLIX_HOME, 'agents.local.json'), '{"blocklist":{}}\n');
    const databasePath = resolveDatabasePath({ configuration: resolveConfiguration(process.env) });
    copyRepairSchema(databasePath);
    await database.open({ path: databasePath });
    const store = new SqliteMissionStore(database);
    const undecided = options.state === 'undecided-review';
    let seeded = seedMission(slug, undecided ? pendingReview(slug, approvedRevision) : approvedReview(slug, approvedRevision));
    if (options.recordBaseline) {
      const baseline = changeRevision(git(repo, ['rev-parse', 'main']));
      seeded = { ...seeded, review: { ...seeded.review!, rounds: seeded.review!.rounds.map(r => ({ ...r, subject: { ...r.subject, baseline } })) as unknown as Review['rounds'] } } as Mission;
    }
    // The board lists the missions of the repository it runs in, so a mission
    // the board must see carries that repository's canonical identity.
    await store.save(undecided
      ? { ...seeded, status: 'review', rawStatus: 'review', repositoryId: resolveCanonicalRepositoryId(repo) } as Mission
      : { ...seeded, repositoryId: resolveCanonicalRepositoryId(repo) }, null);

    // Some composed adapters resolve the primary checkout from process.cwd().
    // Keep those real Git reads inside the fixture, rather than the operator's
    // repository and its unrelated worktrees (TASK-2712 repair).
    process.chdir(worktree);
    // Preserve the worker authorization; independent hosting has its own contracts.
    configureMissionWriteAuthorization({ operationId: `fixture:${slug}`, async assert(id) {
      assert.equal(id, slug, 'the fixture worker may write only its own mission');
    } });

    return {
      root, repo, worktree, slug, approvedRevision, database,
      git,
      async load() {
        const loaded = await store.load(missionId(slug));
        assert.equal(loaded.kind, 'found');
        return (loaded as { mission: Mission }).mission;
      },
      async version() {
        const loaded = await store.load(missionId(slug));
        assert.equal(loaded.kind, 'found');
        return Number((loaded as { version: unknown }).version);
      },
      laneEvents: () => database.query('SELECT from_status, to_status, trigger FROM board_lane_events WHERE mission_id = ? ORDER BY id', [slug]),
      close,
    };
  } catch (error) { await close(); throw error; }
}

function pendingReview(slug: string, revision: string): Review {
  const eligibility = ConfiguredReviewerEligibility.fromReviewStep({ eligible: [REVIEWER], strategy: 'random' });
  return startReview({
    change: { kind: 'local-branch', sourceBranch: `mission/${slug}`, targetBranch: 'main' },
    revision: changeRevision(revision),
  }, REVIEWER, IMPLEMENTER, '2026-09-20T10:00:00.000Z', eligibility);
}

function approvedReview(slug: string, revision: string): Review {
  return applyReviewerCommand(pendingReview(slug, revision), { type: 'approve', revision: changeRevision(revision), decidedAt: '2026-09-20T11:00:00.000Z', comment: 'Looks right', source: { kind: 'local' } });
}

function seedMission(slug: string, review: Review): Mission {
  return typedMissionFixture(String(missionId(slug)), {
    repositoryId: repositoryId('parallix'),
    title: `Mission ${slug}`,
    labels: missionLabels(['user_value']),
    status: 'integration',
    rawStatus: 'integration',
    checkpoints: [{
      missionId: missionId(slug),
      name: 'CP-1',
      rawFilename: 'CP-1.md',
      firstLine: 'CP-1',
      goalCheck: [{ criterion: 'feature ships', evidence: 'feature.txt' }],
      nextActionText: 'hand off',
    }],
    brief: { goal: 'Ship the fixture feature', why: 'The fixture needs it', scope: 'feature.txt', outOfScope: [] },
    declaredGates: [':'],
    successCriteria: ['feature ships'],
    completedSuccessCriteria: [0],
    dependencies: [],
    predictedNelBucket: 'Small',
    reproductionTest: null,
    assignee: IMPLEMENTER,
    externalTaskRef: null,
    review,
    netEngineeringLines: null,
    closedAt: null});
}
