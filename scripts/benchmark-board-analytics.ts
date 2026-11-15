/**
 * Repeatable measurement of the board's historical analytics against the
 * populated board-loading fixture (TASK-2854.02).
 *
 * The parent process is the observer: it spawns the measuring child, samples the
 * child's resident set while the child builds the board, and reports read row
 * counts, read bytes, query counts, analytics completion/refresh time and steady
 * observer RSS together, so work that became compact cannot be claimed as an
 * improvement without the read that stopped happening.
 *
 * Usage: npm run benchmark:board-analytics [-- --missions 120 --builds 3]
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { BOARD_ANALYTICS_BASELINE_WORKLOAD, seedBoardLoading, type BoardLoadingWorkload }
  from '../test/fixtures/board-loading-state.js';
import { agentFamily } from '../src/domain/agents.js';
import { repositoryId } from '../src/domain/repository.js';
import { composeBoardProjection } from '../src/composition/board-projection.js';
import { initOperatorState, clearOperatorStateCache } from '../src/adapters/sqlite/adapter-factory.js';
import { SqliteBlocklistRepository } from '../src/adapters/sqlite/blocklist-repository.js';
import { SqliteBoardLaneEventRepository } from '../src/adapters/sqlite/board-lane-event-repository.js';
import { SqliteMissionStore } from '../src/adapters/sqlite/mission-store.js';
import { SqliteOperationalHistoryRepository } from '../src/adapters/sqlite/operational-history-repository.js';
import { SqliteUsageRepository } from '../src/adapters/sqlite/usage-repository.js';
import type { SqliteDatabaseAdapter } from '../src/adapters/sqlite/database-adapter.js';
import type { SQLInputValue } from 'node:sqlite';
import type { OperationalHistoryEntry, OperationalHistoryRepository }
  from '../src/application/ports/operation-history.js';
import { git as realGit, type GitOptions, type GitResult } from '../src/adapters/git/git.js';

/** Declared bound for one historical analytics completion or refresh. */
export const ANALYTICS_REFRESH_LIMIT_MS = 3_000;
/** Declared bound for the resident set of the process holding the observation. */
export const STEADY_OBSERVER_RSS_LIMIT_MIB = 512;

export interface AnalyticsMeasurement {
  readonly workload: { readonly missions: number; readonly repairRows: number; readonly repairFingerprintChars: number;
    readonly missionWorktrees: number };
  readonly builds: readonly { readonly label: string; readonly ms: number; readonly freshness: string | null;
    readonly reason: string | null;
    readonly rows: number; readonly bytes: number; readonly compactRepairRows: number; readonly queries: number;
    readonly gitChildren: number }[];
  readonly coldAnalyticsMs: number;
  readonly refreshAnalyticsMs: number;
  readonly totalReadRows: number;
  readonly totalReadBytes: number;
  readonly totalQueries: number;
  readonly totalGitChildren: number;
  readonly gitChildrenByOperation: readonly { readonly operation: string; readonly count: number }[];
  readonly repairBytesInAnalyticalRead: number;
  readonly storageReads: readonly { readonly method: string; readonly count: number; readonly ms: number; readonly rows: number }[];
  readonly slowestStatements: readonly { readonly sql: string; readonly count: number; readonly ms: number }[];
}

function argument(name: string, fallback: number): number {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 && process.argv[index + 1] !== undefined ? Number(process.argv[index + 1]) : fallback;
}

/** Counts what one measurement run asks of storage, per event family. */
class ReadCounts {
  rows = 0;
  bytes = 0;
  queries = 0;
  statements = 0;
  compactRepairRows = 0;
  repairBytes = 0;
  gitChildren = 0;
  /** Git subprocesses by operation, so a subprocess-reduction claim names the call that stopped happening. */
  readonly gitByOperation = new Map<string, number>();
  /** Elapsed storage time by read method, so a compact-read claim names the read it removed. */
  readonly calls = new Map<string, { count: number; ms: number; rows: number; bytes: number }>();
  /** Slowest individual SQL statements, so the remaining cost is attributable to a statement. */
  readonly statementsBySql = new Map<string, { count: number; ms: number }>();
  sql(label: string, ms: number) {
    const key = label.replace(/\s+/g, ' ').trim().slice(0, 120);
    const entry = this.statementsBySql.get(key) ?? { count: 0, ms: 0 };
    entry.count += 1;
    entry.ms += ms;
    this.statementsBySql.set(key, entry);
  }
  timed<T>(method: string, read: () => Promise<T>, rows: (value: T) => number = () => 0): Promise<T> {
    const started = performance.now();
    return read().then(value => {
      const entry = this.calls.get(method) ?? { count: 0, ms: 0, rows: 0, bytes: 0 };
      entry.count += 1;
      entry.ms += performance.now() - started;
      entry.rows += rows(value);
      this.calls.set(method, entry);
      return value;
    });
  }
  gitCall(args: readonly string[]) {
    this.gitChildren += 1;
    // Keep the flags: `status --porcelain` and `status --porcelain=v2 --branch`
    // are different questions, and the count must show which one a build asks.
    const operation = args.flatMap((arg, index) =>
      arg === '-C' || args[index - 1] === '-C' ? [] : [arg]).join(' ');
    this.gitByOperation.set(operation, (this.gitByOperation.get(operation) ?? 0) + 1);
  }
  snapshot() {
    return { rows: this.rows, bytes: this.bytes, queries: this.queries, compactRepairRows: this.compactRepairRows,
      gitChildren: this.gitChildren };
  }
}

/** Count every Git subprocess the composed board starts, without changing what it asks of Git. */
function instrumentGit(counts: ReadCounts) {
  return (args: string[], options?: GitOptions): Pick<GitResult, 'status' | 'stdout' | 'stderr'> => {
    counts.gitCall(args);
    return realGit(args, options);
  };
}

/** Decorate the storage boundary without changing what the composition asks for. */
function instrumentDatabase(db: SqliteDatabaseAdapter, counts: ReadCounts): SqliteDatabaseAdapter {
  const wrapped = Object.create(db) as SqliteDatabaseAdapter;
  wrapped.query = (<T extends object>(sql: string, params?: readonly SQLInputValue[]) => {
    counts.queries += 1;
    const started = performance.now();
    return db.query<T>(sql, params).then(rows => {
      counts.sql(sql, performance.now() - started);
      return rows;
    });
  }) as typeof wrapped.query;
  wrapped.execute = ((sql: string, params?: readonly SQLInputValue[]) => {
    counts.statements += 1;
    return db.execute(sql, params);
  }) as typeof wrapped.execute;
  return wrapped;
}

function instrumentHistory(repo: OperationalHistoryRepository, counts: ReadCounts): OperationalHistoryRepository {
  const tally = (rows: readonly OperationalHistoryEntry[]) => {
    counts.rows += rows.length;
    for (const row of rows) {
      counts.bytes += row.eventData.length;
      if (row.eventType === 'rebound.repair') { counts.repairBytes += row.eventData.length; }
    }
    return rows;
  };
  const wrapped: OperationalHistoryRepository = {
    findAll: () => counts.timed('history.findAll', () => repo.findAll(), r => r.length),
    findByTypes: types => counts.timed('history.findByTypes', () => repo.findByTypes!(types), r => r.length).then(tally),
    revisionForTypes: types => counts.timed('history.revisionForTypes', () => repo.revisionForTypes!(types)),
    findEarliestForMissions: (ids, repository) => repo.findEarliestForMissions!(ids, repository),
    findReboundRepairs: () => counts.timed('history.findReboundRepairs', () => repo.findReboundRepairs!(), r => r.length)
      .then(rows => { counts.compactRepairRows += rows.length; return rows; }),
    findRecentLogEntries: limit => repo.findRecentLogEntries!(limit),
    findByType: type => counts.timed('history.findByType', () => repo.findByType(type), r => r.length).then(tally),
    findByTypeForMission: (type, id) => counts.timed(`history.findByTypeForMission.${type}`,
      () => repo.findByTypeForMission!(type, id), r => r.length).then(tally),
    append: entry => repo.append(entry),
    clear: () => repo.clear(),
  };
  return wrapped;
}

/** Child role: seed the fixture, build the board, report the reads it performed. */
async function measure(): Promise<AnalyticsMeasurement> {
  const missions = argument('missions', 120);
  const builds = argument('builds', 3);
  const workload: BoardLoadingWorkload = {
    missionWorktrees: argument('worktrees', BOARD_ANALYTICS_BASELINE_WORKLOAD.missionWorktrees),
    analyticalRows: argument('analytical-rows', BOARD_ANALYTICS_BASELINE_WORKLOAD.analyticalRows),
    repairRows: argument('repair-rows', BOARD_ANALYTICS_BASELINE_WORKLOAD.repairRows),
    repairFingerprintChars: argument('transcript-chars', BOARD_ANALYTICS_BASELINE_WORKLOAD.repairFingerprintChars),
  };
  const state = fs.mkdtempSync(path.join(os.tmpdir(), 'board-analytics-'));
  const counts = new ReadCounts();
  try {
    const seeded = await seedBoardLoading(state, missions, { workload });
    // The reported workload must be the fixture that was actually built, so a
    // subprocess or query count can never be read against a phantom population.
    if (seeded.worktrees !== workload.missionWorktrees) {
      throw new Error(`fixture created ${seeded.worktrees} mission worktrees for a requested ${workload.missionWorktrees}`);
    }
    const { db } = await initOperatorState({ homeDir: seeded.home });
    const counted = instrumentDatabase(db, counts);
    const history = instrumentHistory(new SqliteOperationalHistoryRepository(counted), counts);
    const board = composeBoardProjection({
      rootDir: seeded.root, missionStore: new SqliteMissionStore(counted), database: counted, gitFn: instrumentGit(counts),
      repositoryId: repositoryId('repository'), blocklistRepo: new SqliteBlocklistRepository(counted),
      historyRepo: history, laneEventRepo: new SqliteBoardLaneEventRepository(counted),
      usageRepo: new SqliteUsageRepository(counted), knownAgentFamilies: [agentFamily('codex')],
    });
    const samples: { label: string; ms: number; freshness: string | null; reason: string | null;
      rows: number; bytes: number; compactRepairRows: number; queries: number; gitChildren: number }[] = [];
    const run = async (label: string) => {
      const before = counts.snapshot();
      const started = performance.now();
      const projection = await board.builder.build({ settleHistoricalAnalytics: true });
      const ms = performance.now() - started;
      const after = counts.snapshot();
      samples.push({ label, ms, freshness: projection.metrics.analytics?.freshness ?? null,
        reason: projection.metrics.analytics?.reason ?? null,
        rows: after.rows - before.rows, bytes: after.bytes - before.bytes,
        compactRepairRows: after.compactRepairRows - before.compactRepairRows,
        queries: after.queries - before.queries,
        gitChildren: after.gitChildren - before.gitChildren });
      return projection;
    };
    await run('cold');
    for (let index = 0; index < builds; index++) { await run(`warm-unchanged-${index + 1}`); }
    // New durable evidence must still refresh the historical summary; a cached
    // snapshot is not an analytics completion claim.
    await history.append({ eventType: 'verification.attempt', createdAt: new Date().toISOString(),
      eventData: JSON.stringify({ repositoryId: 'repository', missionId: 'task-9001', state: 'passed' }) });
    await run('warm-refresh');
    return {
      workload: { missions, repairRows: workload.repairRows!, repairFingerprintChars: workload.repairFingerprintChars!,
        missionWorktrees: seeded.worktrees },
      builds: samples,
      coldAnalyticsMs: samples[0]!.ms,
      refreshAnalyticsMs: samples[samples.length - 1]!.ms,
      totalReadRows: counts.rows, totalReadBytes: counts.bytes, totalQueries: counts.queries,
      totalGitChildren: counts.gitChildren,
      gitChildrenByOperation: [...counts.gitByOperation.entries()]
        .map(([operation, count]) => ({ operation, count }))
        .sort((left, right) => right.count - left.count),
      repairBytesInAnalyticalRead: counts.repairBytes,
      storageReads: [...counts.calls.entries()]
        .map(([method, entry]) => ({ method, ...entry, ms: Math.round(entry.ms) }))
        .sort((left, right) => right.ms - left.ms),
      slowestStatements: [...counts.statementsBySql.entries()]
        .map(([sql, entry]) => ({ sql, ...entry, ms: Math.round(entry.ms) }))
        .sort((left, right) => right.ms - left.ms).slice(0, 8),
    };
  } finally {
    await clearOperatorStateCache();
    fs.rmSync(state, { recursive: true, force: true });
  }
}

/** Resident set of the child and everything it spawned, in KiB. */
function processTreeRss(root: number): number {
  const children = new Map<number, number[]>();
  for (const entry of fs.readdirSync('/proc')) {
    if (!/^\d+$/.test(entry)) { continue; }
    const pid = Number(entry);
    try {
      const stat = fs.readFileSync(`/proc/${pid}/stat`, 'utf8');
      const ppid = Number(stat.slice(stat.lastIndexOf(')') + 1).trim().split(/\s+/)[1]);
      children.set(ppid, [...(children.get(ppid) ?? []), pid]);
    } catch { /* the process is already gone */ }
  }
  let total = 0;
  const seen = new Set<number>();
  const walk = (pid: number) => {
    if (seen.has(pid)) { return; }
    seen.add(pid);
    try {
      for (const line of fs.readFileSync(`/proc/${pid}/status`, 'utf8').split('\n')) {
        if (line.startsWith('VmRSS:')) { total += Number(line.split(/\s+/)[1]); }
      }
    } catch { /* the process is already gone */ }
    for (const child of children.get(pid) ?? []) { walk(child); }
  };
  walk(root);
  return total;
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

/** Parent role: observe the measuring child and report its steady resident set. */
async function observe(): Promise<void> {
  const self = fileURLToPath(import.meta.url);
  const child = spawn(process.execPath, ['--import', 'tsx', self, '--measure', ...process.argv.slice(2)], {
    stdio: ['ignore', 'pipe', 'inherit'], env: { ...process.env, PARALLIX_TEST_NO_FORGEJO: '1', NO_COLOR: '1' },
  });
  const samples: number[] = [];
  const observedPid = child.pid ?? 0;
  const scan = setInterval(() => {
    if (child.exitCode !== null || child.signalCode !== null) { return; }
    samples.push(processTreeRss(observedPid));
  }, 50);
  let stdout = '';
  child.stdout.on('data', chunk => { stdout += chunk; });
  const exit = await new Promise<number | null>(resolve => child.once('exit', resolve));
  clearInterval(scan);
  if (exit !== 0) { process.exitCode = exit ?? 1; return; }
  const measurement = JSON.parse(stdout.trim().split('\n').filter(Boolean).pop()!) as AnalyticsMeasurement;
  // Steady state is the resident set once the builds have settled, not the peak
  // of the seeding that precedes them.
  const steady = samples.slice(Math.floor(samples.length * 0.4));
  const report = {
    ...measurement,
    environment: { os: `${process.platform} ${os.release()}`, node: process.version, cpu: os.cpus()[0]?.model ?? 'unavailable' },
    observer: {
      samples: samples.length,
      peakRssMiB: Math.round(samples.reduce((max, value) => Math.max(max, value), 0) / 1024),
      steadyRssMiB: Math.round(median(steady.length ? steady : samples) / 1024),
      limitMiB: STEADY_OBSERVER_RSS_LIMIT_MIB,
    },
    limits: { analyticsRefreshMs: ANALYTICS_REFRESH_LIMIT_MS, steadyRssMiB: STEADY_OBSERVER_RSS_LIMIT_MIB },
  };
  console.log(JSON.stringify(report, null, 2));
  if (report.refreshAnalyticsMs > ANALYTICS_REFRESH_LIMIT_MS) {
    throw new Error(`analytics refresh ${report.refreshAnalyticsMs.toFixed(0)} ms exceeds ${ANALYTICS_REFRESH_LIMIT_MS} ms`);
  }
  if (report.observer.steadyRssMiB > STEADY_OBSERVER_RSS_LIMIT_MIB) {
    throw new Error(`steady observer RSS ${report.observer.steadyRssMiB} MiB exceeds ${STEADY_OBSERVER_RSS_LIMIT_MIB} MiB`);
  }
}

if (process.argv.includes('--measure')) {
  measure().then(result => console.log(JSON.stringify(result))).catch(error => { console.error(error); process.exitCode = 1; });
} else {
  observe().catch(error => { console.error(error); process.exitCode = 1; });
}
