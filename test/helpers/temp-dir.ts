import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as bootstrap from '../bootstrap-parallix-home.js';

/**
 * Creates a temporary directory and registers it with the test harness
 * manifest so it is cleaned up even if the worker process is SIGKILL'd.
 *
 * Test files that create their own temporary directories (instead of relying
 * on the bootstrap's PARALLIX_HOME / HOME / FORGEJO_HOME) should use this
 * helper so the runner can reclaim their directories on forced exit.
 *
 * @param {string} [prefix] - Directory name prefix (default: 'parallix-test-')
 * @returns {string} Absolute path to the created directory
 */
function mkdtemp(prefix = 'parallix-test-') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  // Register with the bootstrap manifest if available (task-2326).
  // The bootstrap exposes registerTempRoot when loaded via --import.
  // When running outside the bootstrap (e.g., integration solo runs),
  // this is a no-op — the test's own afterEach handles cleanup.
  if (typeof bootstrap.registerTempRoot === 'function') {
    bootstrap.registerTempRoot(dir);
  }
  return dir;
}

export { mkdtemp };
