import { watch } from 'node:fs';
import path from 'node:path';
import type { BoardWakeSource } from '../../application/projections/board-subscription.js';

/**
 * Hints that another process committed to the operator database.
 *
 * The directory is watched, not the files: the WAL and shared-memory files are
 * created and removed as connections open and close, which would orphan a
 * per-file watch. A watcher that cannot start or later fails only removes the
 * hint; the subscription's periodic reconciliation keeps the board correct.
 */
export function databaseChangeSignal(databasePath: string): BoardWakeSource {
  const directory = path.dirname(databasePath);
  const prefix = path.basename(databasePath);
  return wake => {
    try {
      const watcher = watch(directory, { persistent: false }, (_event, filename) => {
        if (filename === null || filename.startsWith(prefix)) { wake(); }
      });
      watcher.on('error', () => { watcher.close(); });
      return () => { watcher.close(); };
    } catch {
      return () => {};
    }
  };
}
