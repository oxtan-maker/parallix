'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

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
  // The bootstrap exposes registerTempRoot when loaded via --require.
  // When running outside the bootstrap (e.g., integration solo runs),
  // this is a no-op — the test's own afterEach handles cleanup.
  const bootstrap = require('../bootstrap-parallix-home');
  if (typeof bootstrap.registerTempRoot === 'function') {
    bootstrap.registerTempRoot(dir);
  }
  return dir;
}

module.exports = { mkdtemp };
