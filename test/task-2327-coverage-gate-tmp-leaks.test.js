'use strict';

/**
 * Regression test for task-2327: coverage-gate temporary directory leaks on SIGKILL.
 *
 * Coverage-gate creates scratch directories with three prefixes:
 *   node-coverage-*   (NODE_V8_COVERAGE)
 *   coverage-gate-tmp-*  (per-run TMPDIR for child test process)
 *   graphify-*        (mock graphify binary)
 *
 * Its cleanup handlers (exit, SIGINT, SIGTERM) cannot run after SIGKILL.
 * This test launches a child process that creates coverage-gate scratch
 * state, terminates it with SIGKILL, and verifies the recovery path
 * reclaims only the orphaned registered roots.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..');
const COVERAGE_GATE_SRC = path.join(
  REPO_ROOT,
  '.test-runtime',
  'adapters',
  'verification',
  'coverage-gate.js'
);

/**
 * Read all roots from manifest files for a given PID in a manifest directory.
 */
function readManifestRoots(manifestDir, pid) {
  const manifestPath = path.join(manifestDir, `${pid}.json`);
  if (!fs.existsSync(manifestPath)) {return [];}
  const data = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  return Array.isArray(data) ? data : [];
}

/**
 * Wait for a child process to close, with a timeout that force-kills on expiry.
 */
function waitForClose(child, timeoutMs = 10000) {
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

/**
 * Spawn a child that loads coverage-gate with a shared manifest directory,
 * creates scratch dirs, and writes a marker file with its PID and dir paths.
 */
function spawnCoverageChild(manifestDir, markerPath) {
  return spawn(process.execPath, [
    '-e',
    [
      `const coverageGate = require(${JSON.stringify(COVERAGE_GATE_SRC)});`,
      `const fs = require('fs');`,
      `const path = require('path');`,
      `const markerPath = ${JSON.stringify(markerPath)};`,
      // Create the three scratch directory types
      `const coverageDir = coverageGate.createPerRunScratchDirs();`,
      `const tmpRoot = coverageGate.createPerRunTmpRoot();`,
      `const graphifyBin = coverageGate.createMockGraphifyBin();`,
      `const graphifyDir = path.dirname(graphifyBin);`,
      // Write the marker with dir info for parent verification
      `fs.writeFileSync(markerPath, JSON.stringify({`,
      `  pid: process.pid,`,
      `  coverageDir,`,
      `  tmpRoot,`,
      `  graphifyDir,`,
      `}));`,
      // Keep alive so parent can read marker and send SIGKILL
      `setTimeout(() => {}, 30000);`,
    ].join('\n'),
  ], {
    stdio: 'pipe',
    cwd: REPO_ROOT,
    env: {
      ...process.env,
      PARALLIX_COVERAGE_GATE_MANIFEST_DIR: manifestDir,
    },
  });
}

test('coverage-gate SIGKILL orphan recovery reclaims registered scratch roots', async () => {
  // SC1 / SC2 / SC3: A child process creates coverage-gate scratch dirs,
  // writes them to a per-run manifest, is SIGKILL'd, and the recovery path
  // reclaims only those registered roots.

  const uniqueSuffix = `task2327-${Date.now()}-${process.pid}`;
  const manifestDir = path.join(os.tmpdir(), `coverage-gate-manifests-${uniqueSuffix}`);
  fs.mkdirSync(manifestDir, { recursive: true });
  const markerPath = path.join(os.tmpdir(), `task2327-marker-${uniqueSuffix}`);

  // Spawn child with shared manifest directory
  const child = spawnCoverageChild(manifestDir, markerPath);

  // Wait for child to write marker
  await new Promise(resolve => setTimeout(resolve, 500));

  // Read the marker to find the child's scratch directories
  const markerData = JSON.parse(fs.readFileSync(markerPath, 'utf8'));
  fs.unlinkSync(markerPath);

  // Verify the child wrote the manifest
  const manifestRoots = readManifestRoots(manifestDir, markerData.pid);
  assert.ok(
    manifestRoots.length >= 3,
    `Manifest must contain at least 3 roots (found ${manifestRoots.length})`
  );

  // Verify all three directory types are recorded
  assert.ok(
    manifestRoots.some(d => d.includes('node-coverage-')),
    'Manifest must contain a node-coverage-* directory'
  );
  assert.ok(
    manifestRoots.some(d => d.includes('coverage-gate-tmp-')),
    'Manifest must contain a coverage-gate-tmp-* directory'
  );
  assert.ok(
    manifestRoots.some(d => d.includes('graphify-')),
    'Manifest must contain a graphify-* directory'
  );

  // Verify all registered directories exist on disk before SIGKILL
  const dirsExist = manifestRoots.every(dir => fs.existsSync(dir));
  assert.ok(dirsExist, 'All manifest roots must exist on disk before SIGKILL');

  // SIGKILL the child (simulates --test-force-exit or OOM killer)
  child.kill('SIGKILL');
  await waitForClose(child);

  // Verify directories still exist after SIGKILL (no handler can catch it)
  const leakedAfter = manifestRoots.filter(dir => fs.existsSync(dir));
  assert.equal(
    leakedAfter.length,
    manifestRoots.length,
    `SIGKILL leaves all ${manifestRoots.length} directories behind`
  );

  // Run the recovery path — this is the fix that reclaims orphaned roots
  const { recoverOrphanedScratchDirs } = require(COVERAGE_GATE_SRC);
  recoverOrphanedScratchDirs(manifestDir);

  // SC3: All registered roots must be removed by recovery
  const stillLeaked = manifestRoots.filter(dir => fs.existsSync(dir));
  assert.equal(
    stillLeaked.length,
    0,
    `Recovery must reclaim all registered roots: ${stillLeaked.join(', ')}`
  );

  // The manifest file itself should also be cleaned up
  const manifestFile = path.join(manifestDir, `${markerData.pid}.json`);
  assert.equal(
    fs.existsSync(manifestFile),
    false,
    'Recovery must remove the orphan manifest file'
  );

  // Clean up the manifest directory
  try { fs.rmSync(manifestDir, { recursive: true, force: true }); } catch (_) {}
});

test('recovery does not remove roots belonging to a live concurrent run', async () => {
  // SC4: Recovery must not delete directories owned by a process that is still alive.

  const uniqueSuffix = `task2327-live-${Date.now()}-${process.pid}`;
  const manifestDir = path.join(os.tmpdir(), `coverage-gate-manifests-${uniqueSuffix}`);
  fs.mkdirSync(manifestDir, { recursive: true });

  // Spawn a "live" child that creates scratch dirs and stays alive
  const liveMarker = path.join(os.tmpdir(), `task2327-live-marker-${uniqueSuffix}`);
  const liveChild = spawn(process.execPath, [
    '-e',
    [
      `const coverageGate = require(${JSON.stringify(COVERAGE_GATE_SRC)});`,
      `const fs = require('fs');`,
      `const markerPath = ${JSON.stringify(liveMarker)};`,
      `const dir = coverageGate.createPerRunScratchDirs();`,
      `fs.writeFileSync(markerPath, JSON.stringify({ pid: process.pid, dir }));`,
      `setTimeout(() => {}, 30000);`,
    ].join('\n'),
  ], {
    stdio: 'pipe',
    cwd: REPO_ROOT,
    env: { ...process.env, PARALLIX_COVERAGE_GATE_MANIFEST_DIR: manifestDir },
  });

  await new Promise(resolve => setTimeout(resolve, 500));
  const liveData = JSON.parse(fs.readFileSync(liveMarker, 'utf8'));
  fs.unlinkSync(liveMarker);
  const liveDir = liveData.dir;

  // Spawn a "dead" child (gets SIGKILL'd) with its own manifest entry
  const deadMarker = path.join(os.tmpdir(), `task2327-dead-marker-${uniqueSuffix}`);
  const deadChild = spawn(process.execPath, [
    '-e',
    [
      `const coverageGate = require(${JSON.stringify(COVERAGE_GATE_SRC)});`,
      `const fs = require('fs');`,
      `const markerPath = ${JSON.stringify(deadMarker)};`,
      `const dir = coverageGate.createPerRunScratchDirs();`,
      `fs.writeFileSync(markerPath, JSON.stringify({ pid: process.pid, dir }));`,
      `setTimeout(() => {}, 30000);`,
    ].join('\n'),
  ], {
    stdio: 'pipe',
    cwd: REPO_ROOT,
    env: { ...process.env, PARALLIX_COVERAGE_GATE_MANIFEST_DIR: manifestDir },
  });

  await new Promise(resolve => setTimeout(resolve, 500));
  const deadData = JSON.parse(fs.readFileSync(deadMarker, 'utf8'));
  fs.unlinkSync(deadMarker);
  const deadDir = deadData.dir;

  // Verify both directories exist
  assert.ok(fs.existsSync(liveDir), 'Live directory must exist');
  assert.ok(fs.existsSync(deadDir), 'Dead directory must exist');
  assert.notEqual(liveDir, deadDir, 'Live and dead directories must be distinct');

  // SIGKILL the dead child
  deadChild.kill('SIGKILL');
  await waitForClose(deadChild);

  // Run recovery
  const { recoverOrphanedScratchDirs } = require(COVERAGE_GATE_SRC);
  recoverOrphanedScratchDirs(manifestDir);

  // SC4: Live child's directory must survive recovery
  assert.ok(
    fs.existsSync(liveDir),
    'Recovery must NOT remove roots of a live concurrent run'
  );

  // Dead child's directory must be removed
  assert.equal(
    fs.existsSync(deadDir),
    false,
    'Recovery must remove roots of a SIGKILL\'d process'
  );

  // Clean up
  liveChild.kill('SIGKILL');
  await waitForClose(liveChild);
  try { fs.rmSync(liveDir, { recursive: true, force: true }); } catch (_) {}
  try { fs.rmSync(manifestDir, { recursive: true, force: true }); } catch (_) {}
});

test('recovery does not remove unregistered directories with matching prefixes', async () => {
  // SC4: Recovery must not delete directories that match the three prefixes
  // but were not registered in any manifest.

  const uniqueSuffix = `task2327-unreg-${Date.now()}-${process.pid}`;
  const manifestDir = path.join(os.tmpdir(), `coverage-gate-manifests-${uniqueSuffix}`);
  fs.mkdirSync(manifestDir, { recursive: true });

  // Create unregistered directories with matching prefixes
  const unregCoverage = fs.mkdtempSync(path.join(os.tmpdir(), 'node-coverage-'));
  const unregTmp = fs.mkdtempSync(path.join(os.tmpdir(), 'coverage-gate-tmp-'));
  const unregGraphify = fs.mkdtempSync(path.join(os.tmpdir(), 'graphify-'));

  // Spawn a child that creates and registers its own directories
  const childMarker = path.join(os.tmpdir(), `task2327-unreg-child-${uniqueSuffix}`);
  const child = spawn(process.execPath, [
    '-e',
    [
      `const coverageGate = require(${JSON.stringify(COVERAGE_GATE_SRC)});`,
      `const fs = require('fs');`,
      `const markerPath = ${JSON.stringify(childMarker)};`,
      `const dir = coverageGate.createPerRunScratchDirs();`,
      `fs.writeFileSync(markerPath, JSON.stringify({ pid: process.pid, dir }));`,
      `setTimeout(() => {}, 30000);`,
    ].join('\n'),
  ], {
    stdio: 'pipe',
    cwd: REPO_ROOT,
    env: { ...process.env, PARALLIX_COVERAGE_GATE_MANIFEST_DIR: manifestDir },
  });

  await new Promise(resolve => setTimeout(resolve, 500));
  const childData = JSON.parse(fs.readFileSync(childMarker, 'utf8'));
  fs.unlinkSync(childMarker);
  const childDir = childData.dir;

  // SIGKILL the child
  child.kill('SIGKILL');
  await waitForClose(child);

  // Run recovery
  const { recoverOrphanedScratchDirs } = require(COVERAGE_GATE_SRC);
  recoverOrphanedScratchDirs(manifestDir);

  // Child's registered directory must be removed
  assert.equal(
    fs.existsSync(childDir),
    false,
    'Registered directory must be removed by recovery'
  );

  // Unregistered directories must survive
  assert.ok(
    fs.existsSync(unregCoverage),
    'Unregistered node-coverage-* directory must NOT be removed'
  );
  assert.ok(
    fs.existsSync(unregTmp),
    'Unregistered coverage-gate-tmp-* directory must NOT be removed'
  );
  assert.ok(
    fs.existsSync(unregGraphify),
    'Unregistered graphify-* directory must NOT be removed'
  );

  // Clean up
  try { fs.rmSync(unregCoverage, { recursive: true, force: true }); } catch (_) {}
  try { fs.rmSync(unregTmp, { recursive: true, force: true }); } catch (_) {}
  try { fs.rmSync(unregGraphify, { recursive: true, force: true }); } catch (_) {}
  try { fs.rmSync(manifestDir, { recursive: true, force: true }); } catch (_) {}
});
