// Composed fixture for the integration repair loop (TASK-2620).
//
// A real Git repository with a mission worktree, the production SQLite Mission
// store under a PARALLIX_HOME the fixture owns, and the real create-cli command
// registry. Only the external boundaries are replaced: the agent launcher
// (`setWorkflowLaunchPort`), and the review provider (disabled, so no Forgejo
// HTTP is reachable). Gates run through the real gate runner with cheap shell
// commands whose outcome the fixture controls through files in the worktree.
import assert from 'node:assert/strict';
import { resolveConfiguration } from '../../src/composition/config.js';
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
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
  extraGates?: Array<{ key: string; command: string; order: number; retries?: number }>;
  /** `undecided-review`: a review-lane mission whose round awaits a reviewer decision. */
  state?: 'approved-integration' | 'undecided-review';
}): Promise<RepairFixture> {
  const { slug } = options;
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'parallix-task-2620-')));
  const repo = path.join(root, 'repo');
  const worktree = path.join(root, `repo-${slug}`);
  fs.mkdirSync(path.join(repo, 'backlog', 'tasks'), { recursive: true });
  fs.mkdirSync(path.join(repo, 'config'), { recursive: true });
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
          { key: 'unit', command: GATE_COMMAND, order: 1 },
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
  process.env.PARALLIX_HOME = path.join(root, 'parallix-home');
  const database = new SqliteDatabaseAdapter();
  await database.open({ path: resolveDatabasePath({ configuration: resolveConfiguration(process.env) }) });
  await new SqliteMigrationRunner(database).applyPending(loadDefaultMigrations());
  const store = new SqliteMissionStore(database);
  const undecided = options.state === 'undecided-review';
  const seeded = seedMission(slug, undecided ? pendingReview(slug, approvedRevision) : approvedReview(slug, approvedRevision));
  // The board lists the missions of the repository it runs in, so a mission
  // the board must see carries that repository's canonical identity.
  await store.save(undecided
    ? { ...seeded, status: 'review', rawStatus: 'review', repositoryId: resolveCanonicalRepositoryId(repo) } as Mission
    : seeded, null);

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
    async close() {
      await database.close();
      await clearOperatorStateCache();
      if (previousHome === undefined) { delete process.env.PARALLIX_HOME; } else { process.env.PARALLIX_HOME = previousHome; }
      fs.rmSync(root, { recursive: true, force: true });
    },
  };
}

function pendingReview(slug: string, revision: string): Review {
  const eligibility = ConfiguredReviewerEligibility.fromReviewStep({ eligible: [REVIEWER], strategy: 'random' });
  return startReview({
    change: { kind: 'local-branch', sourceBranch: `mission/${slug}`, targetBranch: 'main' },
    revision: changeRevision(revision),
  }, REVIEWER, IMPLEMENTER, '2026-09-20T10:00:00.000Z', eligibility);
}

function approvedReview(slug: string, revision: string): Review {
  return applyReviewerCommand(pendingReview(slug, revision), { type: 'approve', decidedAt: '2026-09-20T11:00:00.000Z', comment: 'Looks right', source: { kind: 'local' } });
}

function seedMission(slug: string, review: Review): Mission {
  return {
    id: missionId(slug),
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
    intakeTrace: null,
    review,
    netEngineeringLines: null,
    closedAt: null,
  } as unknown as Mission;
}
