import path from 'node:path';
import { resolveParallixHome } from '../../platform/runtime/lib/core/storage.js';

/**
 * Resolve the SQLite database path to `<PARALLIX_HOME>/parallix.db`.
 *
 * The database is always placed beneath PARALLIX_HOME and never beneath
 * a target repository, mission worktree, executable directory, or package
 * directory.
 */
export function resolveDatabasePath(options?: { home?: string }): string {
  const home = options?.home
    ? path.resolve(options.home)
    : resolveParallixHome({ ensureDir: true });
  return path.join(home, 'parallix.db');
}

/**
 * Verify that the database path is isolated from repository directories.
 *
 * Returns `true` if the database path is NOT beneath any of the given
 * repository/worktree/executable/package directories.
 */
export function verifyDatabasePathIsolation(
  dbPath: string,
  excludedRoots: readonly string[],
): boolean {
  const resolved = path.resolve(dbPath);
  for (const root of excludedRoots) {
    const resolvedRoot = path.resolve(root);
    // Database must not be beneath any excluded root (and must not be the root itself)
    if (
      resolved === resolvedRoot ||
      resolved.startsWith(resolvedRoot + path.sep)
    ) {
      return false;
    }
  }
  return true;
}
