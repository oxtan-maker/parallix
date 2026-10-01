// TASK-2622.04 — case-owned fixture lifetimes.
//
// The typed builders under test/fixtures hand each test case private mutable
// resources: a case root, a committed Git repository inside it, and a migrated
// SQLite operator database. These cases prove two retained safety boundaries:
//
// - builders keep no mutable state at module scope, so two cases never share
//   an aggregate, store, history or root;
// - a bootstrapped worker reclaims those resources on success and assertion
//   failure (t.after -> dispose/close), on SIGTERM (the bootstrap's signal
//   handler), and after a SIGKILL watchdog kill (the runner's manifest sweep,
//   test/lib/test-runner-temp-roots.ts cleanupRunnerTempRoots);
// - a covered fast unit run removes its runner-owned scratch root even when
//   the runner is terminated by a signal.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { caseRoot } from './fixtures/case-root.js';
import { inMemoryOperationalHistory } from './fixtures/operational-history.js';
import { fixtureMission, inMemoryTransitionStore } from './fixtures/mission-builders.js';
import { cleanupRunnerTempRoots } from './lib/test-runner-temp-roots.js';

const testRoot = path.dirname(fileURLToPath(import.meta.url));
const fixtureUrl = (file: string) => pathToFileURL(path.join(testRoot, 'fixtures', file)).href;

// The probe is one bootstrapped worker running one node:test case in-process.
const PROBE = `
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const { caseRoot } = await import(${JSON.stringify(fixtureUrl('case-root.ts'))});
const { initCommittedRepository } = await import(${JSON.stringify(fixtureUrl('git-repository.ts'))});
const { openMigratedMissionStore } = await import(${JSON.stringify(fixtureUrl('mission-sqlite-store.ts'))});
let built = [];
// Runs after the case and its t.after hooks, before the worker's exit sweep.
test.after(() => {
  fs.writeFileSync(process.env.LIFETIME_DISPOSED, JSON.stringify(built.map((root) => !fs.existsSync(root))));
});
test('probe', async (t) => {
  const owned = caseRoot('lifetime-probe-');
  t.after(() => owned.dispose());
  initCommittedRepository(owned.root);
  const migrated = await openMigratedMissionStore();
  t.after(() => migrated.close());
  built = [owned.root, migrated.root];
  fs.writeFileSync(process.env.LIFETIME_REPORT, JSON.stringify(built));
  if (process.env.LIFETIME_MODE === 'failure') { assert.fail('deliberate probe failure'); }
  if (process.env.LIFETIME_MODE === 'hang') { await new Promise(() => setInterval(() => {}, 1_000)); }
});
`;

interface Probe {
  readonly roots: Promise<string[]>;
  /** Per root, whether it was gone when the case finished (before exit). */
  disposedBeforeExit(): boolean[];
  readonly exited: Promise<{ code: number | null; signal: NodeJS.Signals | null }>;
  readonly manifestDir: string;
  kill(_signal: NodeJS.Signals): void;
}

function startProbe(mode: 'success' | 'failure' | 'hang'): Probe {
  const scratch = caseRoot('lifetime-parent-');
  test.after(() => scratch.dispose());
  const probe = path.join(scratch.root, 'probe.mjs');
  const report = path.join(scratch.root, 'roots.json');
  const disposed = path.join(scratch.root, 'disposed.json');
  const manifestDir = path.join(scratch.root, 'manifest');
  fs.mkdirSync(manifestDir);
  fs.writeFileSync(probe, PROBE);
  const child = spawn(process.execPath, [
    '--import', 'tsx', '--import', pathToFileURL(path.join(testRoot, 'bootstrap-parallix-home.ts')).href, probe,
  ], {
    cwd: path.dirname(testRoot),
    stdio: 'ignore',
    env: { ...process.env, LIFETIME_MODE: mode, LIFETIME_REPORT: report, LIFETIME_DISPOSED: disposed, PARALLIX_TEST_MANIFEST_DIR: manifestDir },
  });
  const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => {
    child.on('exit', (code, signal) => resolve({ code, signal }));
  });
  const roots = new Promise<string[]>((resolve, reject) => {
    const poll = setInterval(() => {
      if (fs.existsSync(report) && fs.statSync(report).size > 0) {
        clearInterval(poll);
        resolve(JSON.parse(fs.readFileSync(report, 'utf8')));
      }
    }, 10);
    void exited.then(() => {
      clearInterval(poll);
      if (!fs.existsSync(report)) { reject(new Error('probe exited before building its fixtures')); }
    });
  });
  return {
    roots, exited, manifestDir,
    disposedBeforeExit: () => JSON.parse(fs.readFileSync(disposed, 'utf8')),
    kill: (signal) => child.kill(signal),
  };
}

function assertReclaimed(roots: readonly string[]) {
  assert.equal(roots.length, 2);
  for (const root of roots) { assert.equal(fs.existsSync(root), false, `${root} was not reclaimed`); }
}

test('TASK-2622.04: builders return independent case-owned state', () => {
  const first = inMemoryTransitionStore(fixtureMission('task-2622-04-a'));
  const second = inMemoryTransitionStore(fixtureMission('task-2622-04-a'));
  assert.notEqual(first.mission(), second.mission());
  assert.notEqual(first.events, second.events);
  assert.notEqual(first.mission().checkpoints, second.mission().checkpoints);

  const history = inMemoryOperationalHistory();
  assert.notEqual(history.appended, inMemoryOperationalHistory().appended);

  const a = caseRoot('lifetime-unique-');
  const b = caseRoot('lifetime-unique-');
  assert.notEqual(a.root, b.root);
  assert.equal(a.lifetime, 'case');
  a.dispose();
  a.dispose();
  b.dispose();
  assert.equal(fs.existsSync(a.root), false);
  assert.equal(fs.existsSync(b.root), false);
});

test('TASK-2622.04: a passing case disposes its root, repository and database', async () => {
  const probe = startProbe('success');
  const roots = await probe.roots;
  assert.deepEqual(await probe.exited, { code: 0, signal: null });
  assert.deepEqual(probe.disposedBeforeExit(), [true, true], 'dispose/close ran at the end of the case');
  assertReclaimed(roots);
});

test('TASK-2622.04: a failing case still disposes its fixtures', async () => {
  const probe = startProbe('failure');
  const roots = await probe.roots;
  assert.deepEqual(await probe.exited, { code: 1, signal: null });
  assert.deepEqual(probe.disposedBeforeExit(), [true, true], 'dispose/close ran despite the failed assertion');
  assertReclaimed(roots);
});

test('TASK-2622.04: SIGTERM reclaims fixtures through the bootstrap signal handler', async () => {
  const probe = startProbe('hang');
  const roots = await probe.roots;
  probe.kill('SIGTERM');
  assert.deepEqual(await probe.exited, { code: 143, signal: null });
  assertReclaimed(roots);
});

test('TASK-2622.04: after a SIGKILL watchdog kill the runner manifest sweep reclaims fixtures', async () => {
  const probe = startProbe('hang');
  const roots = await probe.roots;
  probe.kill('SIGKILL');
  assert.equal((await probe.exited).signal, 'SIGKILL');
  for (const root of roots) { assert.equal(fs.existsSync(root), true, 'SIGKILL leaves the root for the runner'); }
  cleanupRunnerTempRoots(probe.manifestDir);
  assertReclaimed(roots);
});

test('TASK-2622.04: a signalled covered fast-unit run removes its runner-owned scratch root', async () => {
  // A stand-in checkout whose fast unit entry point reports the scratch root
  // the runner handed it, then hangs until the runner's signal forwarding
  // terminates the suite process group.
  const checkout = caseRoot('lifetime-runner-');
  test.after(() => checkout.dispose());
  const report = path.join(checkout.root, 'scratch.txt');
  fs.mkdirSync(path.join(checkout.root, 'test'));
  fs.writeFileSync(path.join(checkout.root, 'package.json'), '{}\n');
  fs.symlinkSync(path.join(testRoot, '..', 'node_modules'), path.join(checkout.root, 'node_modules'));
  fs.writeFileSync(path.join(checkout.root, 'test', 'run-fast-unit-tests.ts'), [
    "import fs from 'node:fs';",
    `fs.writeFileSync(${JSON.stringify(report)}, process.env.PARALLIX_FAST_UNIT_SCRATCH_DIR ?? '');`,
    'setInterval(() => {}, 1_000);',
  ].join('\n'));
  // Coverage runs select a Node 26.7+ executable. The stand-in tier never
  // instruments anything, so a shim that reports such a version and runs the
  // current Node keeps the case independent of the installed runtimes.
  const testNode = path.join(checkout.root, 'node');
  fs.writeFileSync(testNode, `#!/bin/sh\nif [ "$1" = --version ]; then echo v26.7.0; else exec ${JSON.stringify(process.execPath)} "$@"; fi\n`);
  fs.chmodSync(testNode, 0o755);
  const runner = spawn(process.execPath, ['--import', 'tsx', path.join(testRoot, 'run-default-tests.ts')], {
    cwd: path.dirname(testRoot),
    stdio: ['ignore', 'ignore', 'pipe'],
    env: {
      ...process.env,
      PARALLIX_EXECUTION_ROOT: checkout.root,
      PARALLIX_FAST_UNIT: '1',
      PARALLIX_TEST_COVERAGE: '1',
      PARALLIX_TEST_NODE: testNode,
      // Skips the native CPU meter so the stand-in needs no C compiler.
      GITHUB_ACTIONS: 'true',
    },
  });
  let stderr = '';
  runner.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });
  let running = true;
  const exited = new Promise<number | null>((resolve) => {
    runner.on('exit', (code) => { running = false; resolve(code); });
  });
  while (running && !(fs.existsSync(report) && fs.statSync(report).size > 0)) {
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assert.ok(running, `the runner exited before starting the fast unit tier: ${stderr}`);
  const scratch = fs.readFileSync(report, 'utf8');
  assert.match(path.basename(scratch), /^fast-unit-scratch-/);
  assert.equal(fs.existsSync(scratch), true);
  runner.kill('SIGTERM');
  assert.equal(await exited, 143);
  assert.equal(fs.existsSync(scratch), false, 'the terminated runner must remove its fast-unit scratch root');
});
