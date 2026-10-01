import fs from 'node:fs';
import { mkdtemp } from '../helpers/temp-dir.js';

/**
 * Fixture lifetimes (TASK-2622.04).
 *
 * Immutable assets are the only state shared beyond one case. Compiled
 * TypeScript is shared by every worker of a checkout through tsx's cache in
 * the per-checkout TMPDIR (`test/lib/test-tmpdir.ts`); a warm cache saved
 * about 105 ms per bootstrapped worker when measured. The PATH shims and
 * launcher stand-ins are created once per worker by
 * `test/bootstrap-parallix-home.ts` and never written by a test. Creating them
 * costs about 0.3 ms per worker, so they are deliberately not shared across
 * workers: a cross-worker owner would outlive or be outlived by its consumers
 * for no saving.
 *
 * Everything a test can mutate is case-owned: its directory tree, database
 * file, Git repository, environment overrides, mock state and process doubles
 * belong to the one test case that built them, and no builder caches them at
 * module scope. A case root is registered with the worker manifest when it is
 * created, so it is reclaimed on success and failure (dispose), on SIGTERM
 * (the bootstrap's signal handler) and after a SIGKILL watchdog kill (the
 * runner's manifest sweep).
 */
export interface CaseRoot {
  readonly lifetime: 'case';
  /** Absolute path of the private directory. */
  readonly root: string;
  /** Remove the directory. Idempotent, and safe after a partial setup. */
  dispose(): void;
}

export function caseRoot(prefix: string): CaseRoot {
  const root = mkdtemp(prefix);
  return {
    lifetime: 'case',
    root,
    dispose() { fs.rmSync(root, { recursive: true, force: true }); },
  };
}
