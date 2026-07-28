'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

/**
 * Regression test for task-2318: bootstrap temp-directory leaks.
 *
 * The bootstrap (`test/bootstrap-parallix-home.js`) creates temp directories
 * per test process via `fs.mkdtempSync()`. This test launches a child process
 * that loads the bootstrap, records which directories it creates, and then
 * terminates the child via SIGTERM. It asserts that all created directories
 * are removed after termination — proving the cleanup path fires.
 */

// Unique prefix so the test can identify the directories its child created
// among any other `parallix-test-*` directories on the host.
const MARKER_PREFIX = 'parallix-test-2318-leak-';

function getExistingMarkers() {
  const entries = fs.readdirSync(os.tmpdir());
  return entries
    .filter(name => name.startsWith('parallix-test-home-')
      || name.startsWith('parallix-test-user-home-')
      || name.startsWith('parallix-test-forgejo-home-')
      || name.startsWith('parallix-test-git-')
      || name.startsWith('parallix-test-curl-')
      || name.startsWith('parallix-test-launchers-'))
    .map(name => path.join(os.tmpdir(), name));
}

function waitForExit(child, timeoutMs) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      try { child.kill('SIGKILL'); } catch (_) {}
      reject(new Error(`Child process ${child.pid} did not exit within ${timeoutMs}ms`));
    }, timeoutMs);
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal });
    });
  });
}

test('bootstrap temp directories are cleaned up after SIGTERM termination', async () => {
  const markerPath = path.join(os.tmpdir(), MARKER_PREFIX + Date.now() + '-' + process.pid);

  // Record directories that exist BEFORE the child spawns
  const before = new Set(getExistingMarkers());

  // Spawn a child that loads the bootstrap, writes its directory list, then
  // sends SIGTERM to itself.
  const child = spawn(process.execPath, [
    '-e',
    [
      // Load the bootstrap (creates temp dirs + registers cleanup)
      `require('./test/bootstrap-parallix-home.js');`,
      // Write the list of temp directories to the marker file
      `const fs = require('fs');`,
      `const marker = ${JSON.stringify(markerPath)};`,
      `fs.writeFileSync(marker, JSON.stringify({`,
      `  pid: process.pid,`,
      `  dirs: [`,
      `    process.env.PARALLIX_HOME,`,
      `    process.env.HOME,`,
      `    process.env.FORGEJO_HOME,`,
      `  ]`,
      `}));`,
      // Keep the event loop alive briefly so the SIGTERM signal can be
      // processed (process.kill schedules the signal for the next tick).
      `setTimeout(() => {}, 1000);`,
      // Send SIGTERM to self
      `process.kill(process.pid, 'SIGTERM');`,
    ].join('\n'),
  ], {
    stdio: 'pipe',
  });

  const { code, signal } = await waitForExit(child, 10000);

  // Child should have exited via SIGTERM (signal) or exit code 143 (128+15, SIGTERM handler)
  assert.ok(
    signal === 'SIGTERM' || code === 143,
    `Child exited with code=${code}, signal=${signal} (expected SIGTERM or code 143)`
  );

  // Read the marker to find which directories the child created
  const data = JSON.parse(fs.readFileSync(markerPath, 'utf8'));
  fs.unlinkSync(markerPath);

  // Verify the specific directories the child reported are gone.
  // We check only the child's own directories (from the marker file) rather
  // than all parallax-test-* in /tmp, to avoid false positives from concurrent
  // test processes that also create bootstrap directories (task-2318 finding 6).
  const leaked = [];
  for (const dir of data.dirs) {
    if (fs.existsSync(dir)) {
      leaked.push(dir);
    }
  }

  assert.equal(
    leaked.length,
    0,
    `Bootstrap temp directories leaked after SIGTERM termination: ${leaked.join(', ')}`
  );
});

test('bootstrap temp directories are cleaned up after SIGKILL termination', async () => {
  const markerPath = path.join(os.tmpdir(), MARKER_PREFIX + Date.now() + '-' + process.pid + '-kill');

  // Record directories that exist BEFORE the child spawns
  const before = new Set(getExistingMarkers());

  // Spawn a child that loads the bootstrap and writes its directory list,
  // then waits briefly before the parent sends SIGKILL.
  const child = spawn(process.execPath, [
    '-e',
    [
      // Load the bootstrap and capture all temp roots it creates
      `const bootstrap = require('./test/bootstrap-parallix-home.js');`,
      // Write the full list of temp directories to the marker file
      `const fs = require('fs');`,
      `const marker = ${JSON.stringify(markerPath)};`,
      `fs.writeFileSync(marker, JSON.stringify({`,
      `  pid: process.pid,`,
      `  dirs: bootstrap.tempRoots,`,
      `}));`,
      // Keep the process alive briefly so the parent can read the marker
      `setTimeout(() => {}, 30000);`,
    ].join('\n'),
  ], {
    stdio: 'pipe',
  });

  // Wait a moment for the child to write the marker file
  await new Promise(resolve => setTimeout(resolve, 500));

  // Send SIGKILL to the child (simulates --test-force-exit timeout behavior)
  child.kill('SIGKILL');

  await new Promise(resolve => {
    child.on('close', resolve);
  });

  // Read the marker to find which directories the child created
  const data = JSON.parse(fs.readFileSync(markerPath, 'utf8'));
  fs.unlinkSync(markerPath);

  // Collect directories that exist AFTER the child exits
  const after = new Set(getExistingMarkers());

  // Find new directories that didn't exist before
  const leaked = [];
  for (const dir of after) {
    if (!before.has(dir)) {
      leaked.push(dir);
    }
  }

  // On the fixed bootstrap, SIGKILL should still leave directories because
  // no JavaScript handler can catch SIGKILL. This test documents that
  // limitation. After the fix, the SIGTERM path handles the common case
  // (test runner sends SIGTERM before SIGKILL).
  //
  // For now, this test asserts that SIGKILL leaves directories (documents
  // the known limitation).
  assert.ok(
    leaked.length >= data.dirs.length,
    `SIGKILL scenario: expected at least ${data.dirs.length} leaked directories, found ${leaked.length}`
  );

  // Parent process cleans up the child's leaked directories so the test
  // itself does not contribute to /tmp inode exhaustion.
  for (const dir of data.dirs) {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
  }
});
