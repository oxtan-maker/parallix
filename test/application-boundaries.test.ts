import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';

const { findForbiddenApplicationDependencies, findCompositionViolations } = require('../.test-runtime/lib/architecture/boundary-guards');
const { createProductionApplicationServices } = require('../.test-runtime/lib/composition/application-services');

const root = process.cwd();
const fixture = (name: string) => path.join(root, 'test', 'fixtures', 'application-boundary', name);
const APPLICATION_DIR = path.join(root, 'src', 'application');

/** Walk src/application/ and return every .ts file (mirrors domain-import-boundary pattern). */
function applicationFiles(): string[] {
  return fs.readdirSync(APPLICATION_DIR, { withFileTypes: true }).flatMap(entry => {
    const filePath = path.join(APPLICATION_DIR, entry.name);
    if (entry.isDirectory()) {
      return collectTsFiles(filePath);
    }
    return entry.isFile() && entry.name.endsWith('.ts') ? [filePath] : [];
  });
}

function collectTsFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const filePath = path.join(dir, entry.name);
    if (entry.isDirectory()) { return collectTsFiles(filePath); }
    return entry.isFile() && entry.name.endsWith('.ts') ? [filePath] : [];
  });
}

test('application import guard accepts every file under src/application/', () => {
  const entries = applicationFiles();
  const violations = findForbiddenApplicationDependencies(entries, APPLICATION_DIR);
  assert.deepEqual(violations, [], `Forbidden application imports:\n${violations.join('\n')}`);
});

test('application import guard scans all canonical application modules', () => {
  const names = applicationFiles().map(file => path.relative(APPLICATION_DIR, file));
  for (const required of [
    'contracts.ts', 'ports.ts', 'execute-mission-service.ts', 'ports/execute-mission.ts',
    'stats-backfill-service.ts',
    'domain-ports.ts', 'mission-authority.ts',
    'controller/board-command.ts', 'controller/board-controller.ts',
    'projections/board.ts', 'projections/board-readers.ts',
    'projections/metrics.ts', 'projections/activity.ts',
    'recording/board-event-recorder.ts',
    'services/agent-selection.ts',
  ]) {
    assert.ok(names.includes(required), `missing application module ${required}`);
  }
});

test('application import guard rejects every direct prohibited dependency category', () => {
  const violations = findForbiddenApplicationDependencies([fixture('direct-prohibited.ts')]).join('\n');
  for (const dependency of ['ink', 'react', 'http', 'node:sqlite', 'sqlite3', 'node:fs', '../core/git', '../tools/forgejo', 'node:child_process', '../core/fmt', 'process.exit']) {
    assert.match(violations, new RegExp(dependency.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `should flag ${dependency}`);
  }
});

test('application import guard rejects transitive prohibited dependency fixture', () => {
  assert.match(findForbiddenApplicationDependencies([fixture('transitive-prohibited.ts')]).join('\n'), /node:fs/);
});

test('application import guard detects a newly added violating file without modifying the test', () => {
  // Place a temporary file in src/application/ that imports a forbidden module.
  // Directory discovery must find it without any path list edit.
  const tempFile = path.join(APPLICATION_DIR, '__temp-violating-file.ts');
  fs.writeFileSync(tempFile, "import 'ink';\nexport const x = 1;\n");
  try {
    const violations = findForbiddenApplicationDependencies(applicationFiles());
    assert.ok(violations.some(v => v.includes('__temp-violating-file.ts') && v.includes('ink')),
      `should detect new violating file; got: ${violations.join('\n')}`);
  } finally {
    fs.unlinkSync(tempFile);
  }
});

test('boundary guard rejects node:sqlite builtin import', () => {
  const rejectFixture = fixture('reject-node-sqlite.ts');
  const violations = findForbiddenApplicationDependencies([rejectFixture]);
  assert.ok(violations.some(v => v.includes('node:sqlite')),
    `should reject node:sqlite; got: ${violations.join('\n')}`);
});

test('boundary guard permits src/adapters/sqlite/ repository adapter path', () => {
  const acceptFixture = fixture('accept-sqlite-adapter.ts');
  // The fixture must resolve to the real adapter file (not null).
  const resolvedTarget = path.resolve(path.dirname(acceptFixture), '../../../src/adapters/sqlite/database-adapter.ts');
  assert.ok(fs.existsSync(resolvedTarget),
    `accept fixture must resolve to real adapter: ${resolvedTarget}`);
  // Pass APPLICATION_DIR as scope so the transitive walk does not follow into
  // the real adapter file (src/adapters/sqlite/), which lives outside the
  // application layer and would bring its own node:sqlite / node:fs imports.
  const violations = findForbiddenApplicationDependencies([acceptFixture], APPLICATION_DIR);
  assert.deepEqual(violations, [],
    `should permit src/adapters/sqlite/ path; got: ${violations.join('\n')}`);
});

test('composition guard accepts the sole production composition root', async () => {
  assert.deepEqual(findCompositionViolations(path.join(root, 'src', 'platform', 'runtime', 'lib')), []);
  const graph = await createProductionApplicationServices(root, undefined, { skipImportGate: true });
  assert.equal(graph.executeMission.constructor.name, 'ExecuteMissionService');
  assert.equal(graph.statsBackfill.constructor.name, 'StatsBackfillService');
  assert.equal(graph.mission.store.constructor.name, 'SqliteMissionStore');
});

test('composition guard rejects complete adapter construction fixture', () => {
  assert.ok(findCompositionViolations(path.dirname(fixture('composition-violation.ts'))).includes(fixture('composition-violation.ts')));
});

test('composition guard rejects service-locator access fixture', () => {
  assert.ok(findCompositionViolations(path.dirname(fixture('locator-violation.ts'))).includes(fixture('locator-violation.ts')));
});
