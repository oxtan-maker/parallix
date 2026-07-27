// task-2286 — hermetic contract tests for the SEA stop rules (ADR 0044).
//
// These cover SC1's runtime gate and SC7's stop-and-reassess behavior without
// building or running an executable, so they belong in the fast default suite.
// The native proof that consumes this contract lives in
// test/task-2286-native-sea-smoke.test.ts.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  MINIMUM_SEA_NODE_MAJOR,
  SEA_SURFACES,
  SEA_THRESHOLDS,
  SeaStopAndReassessError,
  assertSurface,
  evaluateSeaRuntime,
} = require('../scripts/sea-surfaces.js');

const ROOT = path.resolve(__dirname, '..');

test('SEA runtime gate: Node 25 and newer are accepted, Node 22/24 are refused before artifact creation (SC1)', () => {
  assert.equal(MINIMUM_SEA_NODE_MAJOR, 25);

  for (const version of ['v25.0.0', 'v26.5.0', 'v30.1.2']) {
    const verdict = evaluateSeaRuntime(version);
    assert.equal(verdict.supported, true, `${version} must be accepted as an ESM-SEA runtime`);
  }

  for (const version of ['v22.23.1', 'v24.15.0']) {
    const verdict = evaluateSeaRuntime(version);
    assert.equal(verdict.supported, false, `${version} must be refused as an ESM-SEA runtime`);
    assert.match(verdict.reason, /mainFormat: "module"/);
    assert.match(verdict.reason, /refuses to emit an artifact/);
  }

  const garbage = evaluateSeaRuntime('not-a-version');
  assert.equal(garbage.supported, false);
  assert.match(garbage.reason, /unrecognized Node version string/);
});

test('SEA surfaces: the ADR 0044 surface list is exactly Ink, SQLite, assets, signals, Git, and source maps (SC7)', () => {
  assert.deepEqual([...SEA_SURFACES].sort(), ['assets', 'git', 'ink', 'signals', 'sourcemaps', 'sqlite']);

  const adr = fs.readFileSync(path.join(ROOT, 'docs/adr/0044-workflow-distribution-model.md'), 'utf8');
  const stopSection = adr.slice(adr.indexOf('## Stop and reassess'));
  for (const fragment of ['Ink', '`node:sqlite`', 'subprocesses', 'signals', 'assets', 'source maps']) {
    assert.ok(stopSection.includes(fragment), `ADR 0044 stop section must still list ${fragment}`);
  }
  assert.match(stopSection, /may not\s+silently substitute another authority, runtime, or distribution model/);
});

test('SEA surfaces: a failing surface raises stop-and-reassess and returns no fallback value (SC7)', () => {
  for (const surface of SEA_SURFACES) {
    assert.equal(assertSurface(surface, true, 'observed working'), true);

    let raised: unknown;
    try {
      assertSurface(surface, false, 'probe returned exit code 1');
    } catch (error) {
      raised = error;
    }
    assert.ok(raised instanceof SeaStopAndReassessError, `${surface} failure must raise SeaStopAndReassessError`);
    const stop = raised as InstanceType<typeof SeaStopAndReassessError>;
    assert.equal(stop.surface, surface);
    assert.match(stop.message, /ADR 0044 stop-and-reassess/);
    assert.match(stop.message, /forbids silently substituting/);
    assert.match(stop.message, /probe returned exit code 1/);
  }
});

test('SEA surfaces: a non-boolean surface result is a failure, never an implicit pass (SC7)', () => {
  // A probe that returns a truthy-but-unverified value (a string, an object, a
  // pending promise) must not be read as "the surface worked".
  for (const sloppy of ['ok', 1, {}, [], null, undefined]) {
    assert.throws(
      () => assertSurface('sqlite', sloppy as unknown as boolean, 'probe returned a non-boolean'),
      SeaStopAndReassessError,
    );
  }
  assert.throws(() => assertSurface('web-board', true, 'not an ADR 0044 surface'), /Unknown ADR 0044 surface/);
});

test('SEA thresholds: measurement stop thresholds are declared for size, cold start, memory, and shutdown (SC5)', () => {
  assert.deepEqual(Object.keys(SEA_THRESHOLDS).sort(), ['binarySizeBytes', 'coldStartMs', 'idleMemoryMb', 'shutdownMs']);
  assert.equal(SEA_THRESHOLDS.binarySizeBytes, 100 * 1024 * 1024);
  for (const [name, value] of Object.entries(SEA_THRESHOLDS)) {
    assert.ok(Number.isFinite(value) && value > 0, `${name} must be a positive number`);
  }
});

test('SEA build adapter: restricted areas are untouched by the SEA proof', () => {
  // ADR 0044 requires npm and the executable to run the same canonical bundle.
  // The adapter therefore consumes build/px.mjs and must never write into the
  // canonical builder, the bundle payload, or the npm bin entry.
  const adapter = fs.readFileSync(path.join(ROOT, 'scripts/build-sea.js'), 'utf8');
  assert.doesNotMatch(adapter, /require\(['"]esbuild['"]\)/, 'the SEA adapter must not re-bundle the payload');
  assert.match(adapter, /fs\.copyFileSync\(bundlePath, seaMain\)/, 'the SEA adapter reads the canonical bundle as its input');
  assert.doesNotMatch(
    adapter,
    /fs\.(?:writeFileSync|appendFileSync|unlinkSync|rmSync|renameSync|truncateSync)\(\s*bundlePath/,
    'the SEA adapter must never write to build/px.mjs',
  );

  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert.equal(manifest.bin.px, 'build/px.mjs', 'the npm bin entry stays the canonical bundle, not the SEA executable');
});
