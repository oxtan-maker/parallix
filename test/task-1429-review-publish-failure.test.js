const test = require('node:test');
const assert = require('node:assert/strict');
const childProcess = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

// ============================================================================
// Reproduction test: task-1429
//
// Bug: `captureVerifiedTreeProof()` in lib/core/verification.ts calls
// `getBuildFreshnessStatus()` at line 133 and returns { ok: false } when
// .ts files are newer than .js siblings. This blocks the entire integration
// pipeline BEFORE the forgejo sync step at integrate.ts:817.
//
// The build freshness check is a linting-style warning, not a hard gate.
// It should NOT prevent forgejo sync from running.
//
// This test simulates stale build artifacts and verifies the behavior:
//
// Red at parent commit: captureVerifiedTreeProof returns { ok: false }
//   → assertion FAILS (bug present - stale build blocks integration)
// Green after fix: captureVerifiedTreeProof returns { ok: true } despite
//   stale build → assertion PASSES (bug fixed - build check is warning-only)
// ============================================================================

test('task-1429: stale build freshness does not block captureVerifiedTreeProof', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'task-1429-'));

  try {
    const runGit = (args) => {
      const result = childProcess.spawnSync('git', args, { cwd: tmpDir, encoding: 'utf8' });
      assert.equal(result.status, 0, result.stderr || result.stdout || `git ${args.join(' ')} failed`);
      return result;
    };

    // Create minimal git repo
    fs.writeFileSync(path.join(tmpDir, '.gitignore'), '*.js\n');
    // Initialize git
    runGit(['init']);
    runGit(['config', 'user.email', 'test@test.com']);
    runGit(['config', 'user.name', 'Test']);

    // Create a minimal workflow.config.json so verification adapter resolves
    fs.writeFileSync(path.join(tmpDir, 'workflow.config.json'), JSON.stringify({
      adapters: {
        verification: { command: null, defaultArea: 'all' },
      },
    }));

    // Create a dummy .ts file
    fs.writeFileSync(path.join(tmpDir, 'px.ts'), '// source');

    // Create a .js file with an OLDER timestamp to simulate stale build
    const jsPath = path.join(tmpDir, 'px.js');
    fs.writeFileSync(jsPath, '// compiled');

    // Set .ts mtime to now, .js mtime to 1 hour ago
    const now = Date.now();
    const oldTime = now - 3600000; // 1 hour ago

    fs.utimesSync(path.join(tmpDir, 'px.ts'), new Date(now), new Date(now));
    fs.utimesSync(jsPath, new Date(oldTime), new Date(oldTime));

    // Verify the stale setup
    const tsStat = fs.statSync(path.join(tmpDir, 'px.ts'));
    const jsStat = fs.statSync(jsPath);
    assert.ok(jsStat.mtimeMs < tsStat.mtimeMs, 'Setup: .js must be older than .ts');

    // Make an initial commit so the repo has a HEAD
    runGit(['add', '-A']);
    runGit(['commit', '-m', 'initial']);

    // Import the module under test
    const { captureVerifiedTreeProof } = require('../lib/core/verification.js');

    // Ensure PARALLIX_SKIP_BUILD_CHECK is NOT set (we want the stale build to trigger)
    const originalEnv = process.env.PARALLIX_SKIP_BUILD_CHECK;
    delete process.env.PARALLIX_SKIP_BUILD_CHECK;

    try {
      // Call captureVerifiedTreeProof with the stale build setup
      // This uses real git operations (execSync above set up a valid repo)
      // but no verification gate command is configured (command: null)
      const result = captureVerifiedTreeProof(undefined, tmpDir);

      // ASSERTION: The build freshness check should NOT block.
      //
      // Red at parent commit: result.ok === false with error about stale build
      //   → assertion FAILS (bug present)
      // Green after fix: result.ok === true (build check is warning-only)
      //   → assertion PASSES
      assert.ok(result.ok,
        'REGRESSION: captureVerifiedTreeProof blocked by stale build freshness check. '
        + 'Error: ' + result.error
        + '\nThe build freshness gate should be warning-only and must NOT block '
        + 'integration or forgejo sync. See lib/core/verification.ts:133-139.'
      );
    } finally {
      // Restore environment
      if (originalEnv !== undefined) {
        process.env.PARALLIX_SKIP_BUILD_CHECK = originalEnv;
      }
    }
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
