// bootstrap-e2e-parallix-home.ts — PARALLIX_HOME isolation preload for the
// standalone e2e test entries (TASK-2554).
//
// The e2e entries (test:agent-e2e, test:lifecycle-e2e, and the tui-spawn solo
// request) run without the full unit bootstrap because they need the operator's
// real HOME (the real-agent smoke copies the operator's configured Pi model
// files) and real curl. They still must not resolve the operator's default
// PARALLIX_HOME: this preload gives the test process a per-run temporary
// PARALLIX_HOME before any test module loads, so no code path in the process
// can write the operator's real parallix.db. Tests that set an explicit test
// home (process.env.PARALLIX_HOME in the test, or a PARALLIX_HOME in a spawned
// child's env) are unaffected — the explicit value simply overrides this
// default, exactly like the unit bootstrap.
//
// The default-database guard arms BEFORE the override so it protects the
// database this process would otherwise have resolved.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startDefaultDbGuard } from './lib/default-db-guard.js';

startDefaultDbGuard('e2e-test');

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'parallix-e2e-home-'));
process.env.PARALLIX_HOME = tempRoot;
fs.mkdirSync(tempRoot, { recursive: true });

// Register with the runner's temp-root manifest when running under
// run-default-tests.ts so a SIGKILL'd e2e worker's home is reclaimed too.
const manifestDir = process.env.PARALLIX_TEST_MANIFEST_DIR;
function flushManifest() {
  if (!manifestDir) { return; }
  try {
    fs.writeFileSync(path.join(manifestDir, `${process.pid}.json`), JSON.stringify([tempRoot]));
  } catch (_) {
    // best-effort manifest write
  }
}
flushManifest();

let cleanupRan = false;
function cleanupTempDirs() {
  if (cleanupRan) { return; }
  cleanupRan = true;
  try {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  } catch (_) {
    // best-effort cleanup only
  }
}

// process.on('exit') does not fire when a signal terminates the process
// without a handler; mirror the unit bootstrap's SIGTERM registration.
process.on('SIGTERM', () => {
  cleanupTempDirs();
  process.exit(128 + 15);
});
process.on('exit', cleanupTempDirs);
