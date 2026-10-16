import fs from 'node:fs';
import path from 'node:path';
import { compareCodeUnits } from '../../domain/comparators.js';

/**
 * Maximum number of `<path>.bak.*` snapshot sidecars retained per database path.
 * After a new snapshot is written, older snapshots beyond this cap are pruned.
 * Named constant so the retention count can be tuned without touching the
 * pruning algorithm (task-2530).
 */
export const MAX_RETAINED_BACKUPS = 3;

/**
 * Delete timestamped `<path>.bak.<millisecond>` snapshots beyond the newest
 * `MAX_RETAINED_BACKUPS`; non-timestamped legacy sidecars are unmanaged.
 *
 * Fixed-width millisecond suffixes sort lexically == chronologically. Files
 * are sorted newest-first and everything past the cap is removed.
 */
export function pruneOlderBackups(dbPath: string): void {
  const base = path.basename(dbPath);
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) {
    return;
  }
  const prefix = `${base}.bak.`;
  const backups = fs
    .readdirSync(dir)
    .filter((f) => f.startsWith(prefix) && /^\d{13}$/.test(f.slice(prefix.length)))
    .sort((a, b) => compareCodeUnits(b, a)); // newest first
  for (const stale of backups.slice(MAX_RETAINED_BACKUPS)) {
    try {
      fs.rmSync(path.join(dir, stale), { force: true });
    } catch {
      // Best-effort cleanup; the newest backup is always retained above.
    }
  }
}

/** Locate the newest snapshot, including legacy backup sidecars for recovery. */
export function findLatestBackup(dbPath: string): string | null {
  const directory = path.dirname(dbPath);
  const prefix = `${path.basename(dbPath)}.bak.`;
  const backups = fs.readdirSync(directory).filter(file => file.startsWith(prefix)).sort(compareCodeUnits);
  return backups.length === 0 ? null : path.join(directory, backups[backups.length - 1]);
}
