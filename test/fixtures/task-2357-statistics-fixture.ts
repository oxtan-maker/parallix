import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import { SqliteDatabaseAdapter } from '../../src/adapters/sqlite/database-adapter.js';
import {
  SqliteMigrationRunner,
  loadDefaultMigrations,
} from '../../src/adapters/sqlite/migration-runner.js';
import { SqliteBoardLaneEventRepository } from '../../src/adapters/sqlite/board-lane-event-repository.js';
import { SqliteUsageRepository } from '../../src/adapters/sqlite/usage-repository.js';
import { SqliteOperationalHistoryRepository } from '../../src/adapters/sqlite/operational-history-repository.js';
import type { BoardLaneEventEntry } from '../../src/application/ports/operation-history.js';

// ---------------------------------------------------------------------------
// Shared fixture for the TASK-2357 statistics regressions.
//
// Every helper here writes through a migrated SQLite database and the real
// persistence repositories. Nothing constructs a `MissionTransition`,
// `MissionOutcome`, or `BoardMetrics` by hand: the point of these regressions is
// that the production conversion between a persisted fact and a reported figure
// is where the defects live.
// ---------------------------------------------------------------------------

export interface StatisticsFixture {
  readonly dir: string;
  readonly databasePath: string;
  readonly db: SqliteDatabaseAdapter;
  readonly laneEventRepo: SqliteBoardLaneEventRepository;
  readonly usageRepo: SqliteUsageRepository;
  readonly historyRepo: SqliteOperationalHistoryRepository;
}

/** Open a migrated database in a temporary directory and tear it down after. */
export async function withStatisticsDatabase(
  run: (_fixture: StatisticsFixture) => Promise<void>,
): Promise<void> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'parallix-task-2357-'));
  const databasePath = path.join(dir, 'parallix.db');
  const db = new SqliteDatabaseAdapter();
  await db.open({ path: databasePath });
  try {
    await new SqliteMigrationRunner(db).applyPending(loadDefaultMigrations());
    await run({
      dir,
      databasePath,
      db,
      laneEventRepo: new SqliteBoardLaneEventRepository(db),
      usageRepo: new SqliteUsageRepository(db),
      historyRepo: new SqliteOperationalHistoryRepository(db),
    });
  } finally {
    await db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

export interface LaneEventInput {
  readonly repositoryId: string;
  readonly missionId: string;
  /** `null` is the authoritative intake marker: the mission had no prior lane. */
  readonly from: string | null;
  readonly to: string;
  readonly at: string;
  readonly trigger?: string;
  readonly agent?: string;
}

/** A persisted lane event, keyed so repeated appends stay idempotent. */
export function laneEvent(input: LaneEventInput): BoardLaneEventEntry {
  return {
    repositoryId: input.repositoryId,
    missionId: input.missionId,
    fromStatus: input.from,
    toStatus: input.to,
    trigger: input.trigger ?? triggerFor(input.to),
    agent: input.agent ?? 'claude',
    occurredAt: input.at,
    idempotencyKey: `${input.repositoryId}|${input.missionId}|${input.from ?? 'intake'}|${input.to}|${input.at}`,
  };
}

/** The lifecycle command that puts a mission into each lane. */
function triggerFor(to: string): string {
  switch (to) {
    case 'backlog': return 'intake';
    case 'refined': return 'refine';
    case 'active': return 'activate';
    case 'review': return 'review';
    case 'integration': return 'integrate';
    case 'done': return 'complete';
    default: return 'intake';
  }
}

export interface UsageRowInput {
  readonly repo: string;
  readonly mission: string;
  readonly date: string;
  readonly stage?: string;
  readonly actorKey?: string;
  readonly classification?: string;
  readonly implementer?: string;
  /** `null` writes SQL NULL — an unknown number of review-fix rounds. */
  readonly prFixRounds?: number | null;
  readonly durationMinutes?: number | null;
  readonly inputTokens?: number | null;
  readonly outputTokens?: number | null;
  readonly costUsd?: number | null;
  readonly closed?: string;
  readonly provider?: string | null;
  readonly model?: string | null;
}

/**
 * Insert one telemetry row straight into `usage_statistics`.
 *
 * The values are bound as SQL parameters, so a `null` in the input really is a
 * SQL NULL in the file — which is what the unknown-review-fix-rounds regression
 * has to observe.
 */
export async function insertUsageRow(
  db: SqliteDatabaseAdapter,
  input: UsageRowInput,
): Promise<void> {
  await db.execute(
    `INSERT INTO usage_statistics
      (date, repo, mission, classification, implementer, pr_fix_rounds,
       provider, model, implementer_agent, reviewer_agent, stage, actor_key,
       input_tokens, output_tokens, cached_tokens, context_tokens, tool_calls,
       openai_usage_before, openai_usage_after, openai_usage_delta,
       duration_minutes, cost_usd, closed)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
    [
      input.date,
      input.repo,
      input.mission,
      input.classification ?? 'ai_sdlc',
      input.implementer ?? 'claude',
      input.prFixRounds === undefined ? null : input.prFixRounds,
      input.provider ?? null,
      input.model ?? null,
      input.implementer ?? 'claude',
      null,
      input.stage ?? 'default',
      input.actorKey ?? `${input.implementer ?? 'claude'}|${input.stage ?? 'default'}`,
      input.inputTokens ?? null,
      input.outputTokens ?? null,
      null,
      null,
      null,
      null,
      null,
      null,
      input.durationMinutes ?? null,
      input.costUsd ?? null,
      input.closed ?? '',
    ],
  );
}

/** A deterministic projection clock pinned to one instant. */
export function fixedClock(at: string): () => string {
  return () => at;
}

// ---------------------------------------------------------------------------
// Real Git checkouts
// ---------------------------------------------------------------------------

export interface GitCheckouts {
  readonly primary: string;
  readonly worktree: string;
  readonly cleanup: () => void;
}

function git(cwd: string, args: readonly string[]): void {
  const result = spawnSync('git', ['-C', cwd, ...args], { encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed in ${cwd}: ${result.stderr || result.stdout}`);
  }
}

/**
 * Create a real Git repository with one real linked worktree.
 *
 * Not a stub: the identity resolution under test shells out to
 * `git worktree list --porcelain`, so nothing short of an actual worktree
 * exercises it.
 */
export function createPrimaryAndWorktree(name: string): GitCheckouts {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'parallix-task-2357-git-'));
  // macOS puts temp dirs under a /private symlink; resolve it so the path git
  // reports and the path the test passes in are comparable.
  const resolvedRoot = fs.realpathSync(root);
  const primary = path.join(resolvedRoot, name);
  fs.mkdirSync(primary, { recursive: true });
  git(primary, ['init', '--initial-branch=main']);
  git(primary, ['config', 'user.email', 'fixture@example.invalid']);
  git(primary, ['config', 'user.name', 'Fixture']);
  fs.writeFileSync(path.join(primary, 'README.md'), '# fixture\n');
  git(primary, ['add', 'README.md']);
  git(primary, ['commit', '-m', 'initial']);
  const worktree = path.join(resolvedRoot, `${name}-task-2357`);
  git(primary, ['worktree', 'add', '-b', 'mission/task-2357', worktree]);
  return {
    primary,
    worktree,
    cleanup: () => fs.rmSync(resolvedRoot, { recursive: true, force: true }),
  };
}
