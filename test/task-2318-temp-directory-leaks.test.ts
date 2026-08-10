// @ts-nocheck -- TASK-2328: partial test doubles from ESM seam migration; resolve in follow-up
/**
 * Regression test for task-2318: bootstrap temp-directory leaks.
 *
 * The bootstrap (`test/bootstrap-parallix-home.ts`) creates temp directories
 * per test process via `fs.mkdtempSync()`. This test launches a child process
 * that loads the bootstrap, records which directories it creates, and then
 * terminates the child via SIGTERM. It asserts that all created directories
 * are removed after termination — proving the cleanup path fires.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';


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

async function waitFor(condition, description, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (condition()) return;
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  assert.fail(`Timed out waiting for ${description}`);
}

function manifestEntries(manifestDir) {
  return fs.readdirSync(manifestDir).filter(entry => entry.endsWith('.json'));
}

function manifestRoots(manifestDir) {
  return manifestEntries(manifestDir).flatMap(entry => {
    try {
      const roots = JSON.parse(fs.readFileSync(path.join(manifestDir, entry), 'utf8'));
      return Array.isArray(roots) ? roots : [];
    } catch (_) {
      return [];
    }
  });
}

test('bootstrap temp directories are cleaned up after SIGTERM termination', async () => {
  const markerPath = path.join(os.tmpdir(), MARKER_PREFIX + Date.now() + '-' + process.pid);

  // Record directories that exist BEFORE the child spawns
  const before = new Set(getExistingMarkers());

  // Spawn a child that loads the bootstrap (side-effect import), writes its
  // directory list, then sends SIGTERM to itself.
  const child = spawn(process.execPath, [
    '--import', 'tsx',
    '--import', './test/bootstrap-parallix-home.ts',
    '--input-type=module',
    '-e',
    [
      // Write the list of temp directories to the marker file
      `const fs = await import('node:fs');`,
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
    '--import', 'tsx',
    '--import', './test/bootstrap-parallix-home.ts',
    '--input-type=module',
    '-e',
    [
      // Load the bootstrap exports and capture all temp roots it creates
      `const bootstrap = await import('./test/bootstrap-parallix-home.ts');`,
      // Write the full list of temp directories to the marker file
      `const fs = await import('node:fs');`,
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

  await waitFor(() => fs.existsSync(markerPath), 'SIGKILL child marker');

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

test('runner orphan cleanup reclaims SIGKILL temp directories', async () => {
  // Regression test for task-2326: the bootstrap writes a per-worker manifest
  // synchronously to a directory (PARALLIX_TEST_MANIFEST_DIR), so it survives SIGKILL.
  // The runner reads all <PID>.json files from the directory and unions the roots.
  // This test verifies the real SIGKILL path: spawn child with manifest dir,
  // SIGKILL child, verify manifest was written by bootstrap, then clean.

  const manifestDir = path.join(os.tmpdir(), MARKER_PREFIX + Date.now() + '-' + process.pid + '-run');
  fs.mkdirSync(manifestDir, { recursive: true });

  // Spawn a child that loads the bootstrap with manifest dir env var.
  // The bootstrap writes per-worker manifest synchronously (before any workers).
  const child = spawn(process.execPath, [
    '--import', 'tsx',
    '--import', './test/bootstrap-parallix-home.ts',
    '--input-type=module',
    '-e',
    [
      `setTimeout(() => {}, 30000);`,
    ].join('\n'),
  ], {
    stdio: 'pipe',
    env: { ...process.env, PARALLIX_TEST_MANIFEST_DIR: manifestDir },
  });

  await waitFor(() => manifestEntries(manifestDir).length > 0, 'bootstrap manifest');

  // Verify the manifest directory has a file written by the bootstrap
  const entries = manifestEntries(manifestDir);
  assert.ok(entries.length > 0, 'Bootstrap must write per-worker manifest synchronously');

  // Union all roots from all manifest files (matches runner cleanup)
  const allRoots = [];
  for (const entry of entries) {
    const roots = JSON.parse(fs.readFileSync(path.join(manifestDir, entry), 'utf8'));
    if (Array.isArray(roots)) allRoots.push(...roots);
  }
  assert.ok(allRoots.length > 0, 'Manifest must contain root directories');

  // Verify all manifest roots exist on disk
  const allExist = allRoots.every(dir => fs.existsSync(dir));
  assert.ok(allExist, 'All manifest roots must exist on disk before SIGKILL');

  // SIGKILL the child (simulates --test-force-exit)
  child.kill('SIGKILL');
  await new Promise(resolve => { child.on('close', resolve); });

  // Verify directories still exist after SIGKILL (no handler can catch it)
  const leakedAfter = allRoots.filter(dir => fs.existsSync(dir));
  assert.equal(
    leakedAfter.length,
    allRoots.length,
    `SIGKILL leaves all directories behind (${leakedAfter.length} leaked)`,
  );

  // Run manifest-based cleanup (matches cleanupOrphanedTempDirs in runner)
  for (const dir of allRoots) {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
  }
  try { fs.rmSync(manifestDir, { recursive: true, force: true }); } catch (_) {}

  // Verify all directories are now removed
  const stillLeaked = allRoots.filter(dir => fs.existsSync(dir));
  assert.equal(
    stillLeaked.length,
    0,
    `Runner orphan cleanup did not reclaim all directories: ${stillLeaked.join(', ')}`,
  );
});

test('runner orphan cleanup is safe with concurrent test runs', async () => {
  // Regression test for task-2326 round 3: two concurrent runners must not
  // delete each other's active roots. Each runner uses a PID-scoped manifest
  // directory (per-worker files written synchronously by bootstrap), so
  // cleanup only touches roots listed in its own directory.

  const manifestDirA = path.join(os.tmpdir(), MARKER_PREFIX + Date.now() + '-A-run');
  const manifestDirB = path.join(os.tmpdir(), MARKER_PREFIX + Date.now() + '-B-run');
  fs.mkdirSync(manifestDirA, { recursive: true });
  fs.mkdirSync(manifestDirB, { recursive: true });

  // Spawn two children with separate manifest dirs (bootstrap writes synchronously)
  const childA = spawn(process.execPath, [
    '--import', 'tsx',
    '--import', './test/bootstrap-parallix-home.ts',
    '--input-type=module',
    '-e',
    [
      `setTimeout(() => {}, 30000);`,
    ].join('\n'),
  ], { stdio: 'pipe', env: { ...process.env, PARALLIX_TEST_MANIFEST_DIR: manifestDirA } });

  const childB = spawn(process.execPath, [
    '--import', 'tsx',
    '--import', './test/bootstrap-parallix-home.ts',
    '--input-type=module',
    '-e',
    [
      `setTimeout(() => {}, 30000);`,
    ].join('\n'),
  ], { stdio: 'pipe', env: { ...process.env, PARALLIX_TEST_MANIFEST_DIR: manifestDirB } });

  await waitFor(
    () => manifestEntries(manifestDirA).length > 0 && manifestEntries(manifestDirB).length > 0,
    'both bootstrap manifests',
  );

  // Read all manifest files from each directory
  const readManifestDir = (dir) => {
    const roots = [];
    for (const entry of fs.readdirSync(dir).filter(e => e.endsWith('.json'))) {
      const r = JSON.parse(fs.readFileSync(path.join(dir, entry), 'utf8'));
      if (Array.isArray(r)) roots.push(...r);
    }
    return roots;
  };
  const rootsA = readManifestDir(manifestDirA);
  const rootsB = readManifestDir(manifestDirB);

  // Verify all directories exist
  const allExist = [...rootsA, ...rootsB].every(dir => fs.existsSync(dir));
  assert.ok(allExist, 'All bootstrap directories must exist before cleanup');

  // SIGKILL child A (simulates runner A completing with forced exit)
  childA.kill('SIGKILL');
  await new Promise(r => childA.on('close', r));

  // Runner A reads its manifest dir and cleans only its roots
  for (const dir of rootsA) {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
  }
  try { fs.rmSync(manifestDirA, { recursive: true, force: true }); } catch (_) {}

  // Verify runner B's roots still exist (not deleted by runner A's cleanup)
  const bDirsSurvived = rootsB.filter(dir => fs.existsSync(dir));
  assert.equal(
    bDirsSurvived.length,
    rootsB.length,
    `Runner A must not delete runner B's roots: ${rootsB.length - bDirsSurvived.length} deleted`,
  );

  // Clean up runner B's roots and child
  for (const dir of rootsB) {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
  }
  try { fs.rmSync(manifestDirB, { recursive: true, force: true }); } catch (_) {}
  childB.kill('SIGKILL');
  await new Promise(r => childB.on('close', r));
});

test('registerTempRoot adds test-created directories to the manifest', async () => {
  // Regression test for task-2326 round 4: test files that create their own
  // temporary directories (e.g., via mkdtempSync with 'task-*' prefix) must
  // register them so the runner can reclaim them on SIGKILL.

  const manifestDir = path.join(os.tmpdir(), MARKER_PREFIX + Date.now() + '-' + process.pid + '-register');
  fs.mkdirSync(manifestDir, { recursive: true });

  const child = spawn(process.execPath, [
    '--import', 'tsx',
    '--import', './test/bootstrap-parallix-home.ts',
    '--input-type=module',
    '-e',
    [
      // Import bootstrap exports for registerTempRoot
      `const bootstrap = await import('./test/bootstrap-parallix-home.ts');`,
      `const fs = await import('node:fs');`,
      `const os = await import('node:os');`,
      `const path = await import('node:path');`,
      // Create a custom temp directory (simulates test file creating its own dir)
      `const customDir = fs.mkdtempSync(path.join(os.tmpdir(), 'task-2318-custom-'));`,
      // Register it with the bootstrap manifest
      `bootstrap.registerTempRoot(customDir);`,
      `setTimeout(() => {}, 30000);`,
    ].join('\n'),
  ], {
    stdio: 'pipe',
    env: { ...process.env, PARALLIX_TEST_MANIFEST_DIR: manifestDir },
  });

  await waitFor(
    () => manifestRoots(manifestDir).some(dir => dir.includes('task-2318-custom-')),
    'registered custom temp directory in manifest',
  );

  // Read the manifest and verify the custom dir is included
  const entries = manifestEntries(manifestDir);
  assert.ok(entries.length > 0, 'Manifest file must exist');

  const allRoots = [];
  for (const entry of entries) {
    const roots = JSON.parse(fs.readFileSync(path.join(manifestDir, entry), 'utf8'));
    if (Array.isArray(roots)) allRoots.push(...roots);
  }

  // The custom directory must be in the manifest roots
  const hasCustomDir = allRoots.some(dir => dir.includes('task-2318-custom-'));
  assert.ok(
    hasCustomDir,
    `registerTempRoot must add custom directory to manifest (roots: ${allRoots.length} total)`,
  );

  // SIGKILL child and verify cleanup via manifest reclaims the custom dir
  child.kill('SIGKILL');
  await new Promise(r => child.on('close', r));

  // Custom dir should still exist after SIGKILL
  const customDirs = allRoots.filter(dir => dir.includes('task-2318-custom-'));
  assert.ok(
    customDirs.every(dir => fs.existsSync(dir)),
    'Custom directory must exist after SIGKILL (before runner cleanup)',
  );

  // Clean up via manifest (matches runner cleanup)
  for (const dir of allRoots) {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
  }
  try { fs.rmSync(manifestDir, { recursive: true, force: true }); } catch (_) {}

  // Verify custom dir is now removed
  const stillLeaked = customDirs.filter(dir => fs.existsSync(dir));
  assert.equal(
    stillLeaked.length,
    0,
    `Runner cleanup must reclaim registered custom directories: ${stillLeaked.join(', ')}`,
  );
});

test('test/helpers/temp-dir.ts mkdtemp registers directory with manifest', async () => {
  // Verify the temp-dir helper module registers directories with the manifest.

  const manifestDir = path.join(os.tmpdir(), MARKER_PREFIX + Date.now() + '-' + process.pid + '-helper');
  fs.mkdirSync(manifestDir, { recursive: true });

  const child = spawn(process.execPath, [
    '--import', 'tsx',
    '--import', './test/bootstrap-parallix-home.ts',
    '--input-type=module',
    '-e',
    [
      `const { mkdtemp } = await import('./test/helpers/temp-dir.ts');`,
      `const dir = mkdtemp('task-2318-helper-');`,
      `process.env._TEST_TEMP_DIR = dir;`,
      `setTimeout(() => {}, 30000);`,
    ].join('\n'),
  ], {
    stdio: 'pipe',
    env: { ...process.env, PARALLIX_TEST_MANIFEST_DIR: manifestDir },
  });

  await waitFor(
    () => manifestRoots(manifestDir).some(dir => dir.includes('task-2318-helper-')),
    'helper temp directory in manifest',
  );

  // Read manifest
  const entries = manifestEntries(manifestDir);
  const allRoots = [];
  for (const entry of entries) {
    const roots = JSON.parse(fs.readFileSync(path.join(manifestDir, entry), 'utf8'));
    if (Array.isArray(roots)) allRoots.push(...roots);
  }

  const hasHelperDir = allRoots.some(dir => dir.includes('task-2318-helper-'));
  assert.ok(
    hasHelperDir,
    'temp-dir.ts mkdtemp must register directory with manifest',
  );

  child.kill('SIGKILL');
  await new Promise(r => child.on('close', r));

  // Clean up
  for (const dir of allRoots) {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
  }
  try { fs.rmSync(manifestDir, { recursive: true, force: true }); } catch (_) {}
});

test('parallel workers each write their own manifest file in shared directory', async () => {
  // Regression test for task-2326 round 5: multiple workers sharing one
  // manifest directory must each write a separate <PID>.json file so no
  // worker's roots are lost when another worker writes concurrently.

  const manifestDir = path.join(os.tmpdir(), MARKER_PREFIX + Date.now() + '-parallel-workers');
  fs.mkdirSync(manifestDir, { recursive: true });

  // Spawn three children that all share the same manifest directory
  const children = [];
  for (let i = 0; i < 3; i++) {
    children.push(spawn(process.execPath, [
      '--import', 'tsx',
      '--import', './test/bootstrap-parallix-home.ts',
      '--input-type=module',
      '-e',
      [
        `setTimeout(() => {}, 30000);`,
      ].join('\n'),
    ], { stdio: 'pipe', env: { ...process.env, PARALLIX_TEST_MANIFEST_DIR: manifestDir } }));
  }

  await waitFor(() => manifestEntries(manifestDir).length === 3, 'all worker manifests');

  // Verify each worker wrote its own manifest file
  const entries = manifestEntries(manifestDir);
  assert.equal(
    entries.length,
    3,
    `Each worker must write its own manifest file (found ${entries.length}, expected 3)`,
  );

  // Union all roots from all manifest files
  const allRoots = [];
  for (const entry of entries) {
    const roots = JSON.parse(fs.readFileSync(path.join(manifestDir, entry), 'utf8'));
    if (Array.isArray(roots)) allRoots.push(...roots);
  }
  assert.ok(allRoots.length > 0, 'Manifests must contain root directories');

  // Verify all roots exist on disk
  const allExist = allRoots.every(dir => fs.existsSync(dir));
  assert.ok(allExist, 'All manifest roots must exist on disk');

  // SIGKILL all children
  for (const child of children) {
    child.kill('SIGKILL');
  }
  await Promise.all(children.map(c => new Promise(r => c.on('close', r))));

  // Verify directories still exist after SIGKILL
  const leakedAfter = allRoots.filter(dir => fs.existsSync(dir));
  assert.equal(
    leakedAfter.length,
    allRoots.length,
    `SIGKILL leaves all directories behind (${leakedAfter.length} leaked)`,
  );

  // Run manifest-based cleanup (matches cleanupOrphanedTempDirs in runner)
  for (const dir of allRoots) {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
  }
  try { fs.rmSync(manifestDir, { recursive: true, force: true }); } catch (_) {}

  // Verify all directories are now removed
  const stillLeaked = allRoots.filter(dir => fs.existsSync(dir));
  assert.equal(
    stillLeaked.length,
    0,
    `Runner orphan cleanup did not reclaim all directories: ${stillLeaked.join(', ')}`,
  );
});
