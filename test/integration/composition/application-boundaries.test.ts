import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { findForbiddenApplicationDependencies, findCompositionViolations, findWorkflowOwnershipViolations } from '../../../src/adapters/architecture/boundary-guards.js';
import { createProductionApplicationServices } from '../../../src/composition/application-services.js';
import { resolveConfiguration } from '../../../src/composition/config.js';
const root = process.cwd();
const fixture = (name: string) => path.join(root, 'test', 'fixtures', 'application-boundary', name);
const APPLICATION_DIR = path.join(root, 'src', 'application');

/** Walk src/application/ and return every .ts file (mirrors the domain import boundary pattern). */
function applicationFiles(applicationDir = APPLICATION_DIR): string[] {
  return fs.readdirSync(applicationDir, { withFileTypes: true }).flatMap(entry => {
    const filePath = path.join(applicationDir, entry.name);
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
  // Keep the discovery fixture outside src/ so a concurrent typecheck cannot
  // include a file that this test removes. Directory discovery still receives
  // an application-shaped root, without a hand-maintained file list.
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'application-boundary-'));
  const tempFile = path.join(tempDir, '__temp-violating-file.ts');
  fs.writeFileSync(tempFile, "import 'ink';\nexport const x = 1;\n");
  try {
    const violations = findForbiddenApplicationDependencies(applicationFiles(tempDir), tempDir);
    assert.ok(violations.some(v => v.includes('__temp-violating-file.ts') && v.includes('ink')),
      `should detect new violating file; got: ${violations.join('\n')}`);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
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
  assert.deepEqual(findCompositionViolations(path.join(root, 'src', 'composition')), []);
  // The ownership assertion is static. Keep the construction smoke test
  // in-process by opting out of the real operator database and Git identity.
  const graph = await createProductionApplicationServices(root, undefined, { includeOperatorState: false, configuration: resolveConfiguration(process.env) });
  assert.equal(graph.executeMission.constructor.name, 'ExecuteMissionService');
  assert.equal(graph.statsBackfill.constructor.name, 'StatsBackfillService');
  assert.equal(graph.mission, null);
});

test('composition guard rejects complete adapter construction fixture', () => {
  assert.ok(findCompositionViolations(path.dirname(fixture('composition-violation.ts'))).includes(fixture('composition-violation.ts')));
});

test('composition guard rejects service-locator access fixture', () => {
  assert.ok(findCompositionViolations(path.dirname(fixture('locator-violation.ts'))).includes(fixture('locator-violation.ts')));
});

const REVIEW_WORKFLOW_ADAPTER = 'src/adapters/review/review-workflow-adapter.ts';

/** A scratch repository holding `source` at `relative`, with every relative import target stubbed. */
function adapterRepo(t: { after: (_fn: () => void) => void }, relative: string, source: string): string {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'px-workflow-ownership-'));
  t.after(() => fs.rmSync(repo, { recursive: true, force: true }));
  const file = path.join(repo, relative);
  for (const [, specifier] of source.matchAll(/from\s+'(\.[^']+)'/g)) {
    const target = path.resolve(path.dirname(file), specifier.replace(/\.js$/, '.ts'));
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, '');
  }
  fs.writeFileSync(file, source);
  return repo;
}

test('workflow ownership guard finds no adapter-owned workflow control in production adapters (TASK-2637.06)', () => {
  const violations = findWorkflowOwnershipViolations(root);
  assert.deepEqual(violations, [], violations.map(violation => `${violation.file}: ${violation.detail}`).join('\n'));
});

test('workflow ownership guard accepts the re-homed review adapter through its typed port bindings', t => {
  const source = fs.readFileSync(path.join(root, REVIEW_WORKFLOW_ADAPTER), 'utf8');
  assert.match(source, /: StaticReviewWorkflowPort = \{/);
  // The autonomous review loop is re-homed through the typed entry port and its
  // mechanism bindings, not through a broad workflow port.
  assert.match(source, /: ReviewRoundEntryPort = \{/);
  assert.doesNotMatch(source, /: ReviewRoundWorkflowPort = \{/);
  assert.deepEqual(findWorkflowOwnershipViolations(adapterRepo(t, REVIEW_WORKFLOW_ADAPTER, source)), []);
});

test('workflow ownership guard rejects the review adapter choosing a follow-on action outside a typed port', t => {
  const source = fs.readFileSync(path.join(root, REVIEW_WORKFLOW_ADAPTER), 'utf8').replace(
    /\n\}\n\nexport function createReviewWorkflowAdapter/,
    "\n  private async relaunch(findings: string[], agent: string): Promise<void> { if (findings.length) { await startAgent('active', { prompt: '', worktree: '', agent }); } else { await submitForReview('', true, {}); } }\n}\n\nexport function createReviewWorkflowAdapter",
  );
  const violations = findWorkflowOwnershipViolations(adapterRepo(t, REVIEW_WORKFLOW_ADAPTER, source));
  assert.deepEqual(violations.map(violation => [violation.file, violation.rule]), [
    [REVIEW_WORKFLOW_ADAPTER, 'adapter-owned-workflow-control'],
    [REVIEW_WORKFLOW_ADAPTER, 'adapter-owned-workflow-control'],
  ]);
  assert.match(violations.map(violation => violation.detail).join('\n'), /agent-launch operation "startAgent"[\s\S]*lifecycle operation "submitForReview"/);
});
