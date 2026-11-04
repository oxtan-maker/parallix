import fs from 'node:fs';
import path from 'node:path';
import type { ParallixConfiguration } from '../../application/ports/configuration.js';
import type { BoardLaneEventRepository, OperationalHistoryRepository } from '../../application/ports/operation-history.js';
import { SqliteBoardLaneEventRepository } from './board-lane-event-repository.js';
import { SqliteDatabaseAdapter } from './database-adapter.js';
import { SqliteMeasurementStore } from './measurement-store.js';
import { SqliteMissionStore } from './mission-store.js';
import { SqliteOperationalHistoryRepository } from './operational-history-repository.js';
import { resolveDatabasePath } from './database-path-resolver.js';

// ---------------------------------------------------------------------------
// Isolated operator-state copy
//
// Stats recovery writes durable evidence and its audit, so it never runs
// against the live operator database. The operator points the command at a
// copy; an absent copy is materialized as a consistent snapshot with
// `VACUUM INTO`, which stays correct while the source is in WAL mode.
// ---------------------------------------------------------------------------

/** Operator-state repositories bound to one isolated copy. */
export interface IsolatedOperatorCopy {
  readonly databasePath: string;
  /** The operator database this copy was snapshotted from, when it was made here. */
  readonly snapshotSource: string | null;
  readonly measurements: SqliteMeasurementStore;
  readonly missions: SqliteMissionStore;
  readonly operationalHistory: OperationalHistoryRepository;
  readonly boardLaneEvents: Pick<BoardLaneEventRepository, 'findByRepositoryId'>;
  close(): void;
}

export interface IsolatedCopyOptions {
  readonly databasePath: string;
  readonly configuration?: ParallixConfiguration;
  /** Operator database to snapshot when the copy does not exist yet. */
  readonly snapshotFrom?: string;
  /** Only an explicit apply may create the copy; a dry-run never writes. */
  readonly materialize?: boolean;
}

const openCopies = new Map<string, IsolatedOperatorCopy>();

/** The operator database recovery must never write to. */
export function liveOperatorDatabasePath(configuration?: ParallixConfiguration): string {
  return resolveDatabasePath({ configuration });
}

/**
 * Open the isolated copy recovery writes to.
 *
 * Fails closed when the requested path IS the live operator database, and
 * when a copy is missing but this run is not allowed to create one.
 */
export function resolveIsolatedOperatorCopy(options: IsolatedCopyOptions): IsolatedOperatorCopy {
  const requestedPath = path.resolve(options.databasePath);
  const live = canonicalPath(liveOperatorDatabasePath(options.configuration));
  const source = canonicalPath(options.snapshotFrom ?? live);
  const databasePath = canonicalPath(requestedPath);
  if (sameFile(databasePath, live) || sameFile(databasePath, source)) {
    throw new Error(`Stats recovery refuses the live operator database: ${databasePath}`);
  }
  const cached = openCopies.get(databasePath);
  if (cached) { return cached; }
  let snapshotSource: string | null = null;
  if (!fs.existsSync(databasePath)) {
    if (!options.materialize) {
      throw new Error(`Isolated operator copy is absent: ${databasePath} (only --apply creates it)`);
    }
    snapshotSource = source;
    snapshotTo(snapshotSource, databasePath);
  }
  const measurements = new SqliteMeasurementStore(databasePath);
  const db = new SqliteDatabaseAdapter();
  db.openSync({ path: databasePath, busyTimeoutMs: 5000, enableWal: true });
  const copy: IsolatedOperatorCopy = {
    databasePath, snapshotSource, measurements, missions: new SqliteMissionStore(db),
    operationalHistory: new SqliteOperationalHistoryRepository(db),
    boardLaneEvents: new SqliteBoardLaneEventRepository(db),
    close: () => { openCopies.delete(databasePath); measurements.close(); db.closeSync(); },
  };
  openCopies.set(databasePath, copy);
  return copy;
}

/** Resolve existing symlink prefixes while preserving a not-yet-created tail. */
function canonicalPath(value: string): string {
  const suffix: string[] = [];
  let cursor = path.resolve(value);
  while (!fs.existsSync(cursor)) {
    const parent = path.dirname(cursor);
    if (parent === cursor) { return path.resolve(value); }
    suffix.unshift(path.basename(cursor));
    cursor = parent;
  }
  return path.join(fs.realpathSync.native(cursor), ...suffix);
}

/** Path aliases, symlinks, hard links and bind mounts to one inode are one database. */
function sameFile(left: string, right: string): boolean {
  if (left === right) { return true; }
  if (!fs.existsSync(left) || !fs.existsSync(right)) { return false; }
  const leftStat = fs.statSync(left);
  const rightStat = fs.statSync(right);
  return leftStat.dev === rightStat.dev && leftStat.ino === rightStat.ino;
}

/** Closes every cached copy. Intended for test isolation. */
export function closeIsolatedOperatorCopies(): void {
  for (const copy of [...openCopies.values()]) { copy.close(); }
}

/** One consistent snapshot of a live operator database. */
function snapshotTo(sourcePath: string, destinationPath: string): void {
  if (!fs.existsSync(sourcePath)) { throw new Error(`Operator database is unavailable: ${sourcePath}`); }
  fs.mkdirSync(path.dirname(destinationPath), { recursive: true });
  const source = new SqliteDatabaseAdapter();
  source.openSync({ path: sourcePath, busyTimeoutMs: 5000, enableWal: false });
  try {
    source.executeSync('VACUUM INTO ?;', [destinationPath]);
  } finally {
    source.closeSync();
  }
}
