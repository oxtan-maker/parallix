import test from 'node:test';
import assert from 'node:assert/strict';
import * as path from 'node:path';

const { findForbiddenApplicationDependencies, findCompositionViolations } = require('../dist/lib/architecture/boundary-guards');
const { createProductionApplicationServices } = require('../dist/lib/composition/application-services');

const root = process.cwd();
const fixture = (name: string) => path.join(root, 'test', 'fixtures', 'application-boundary', name);

test('application import guard accepts the application services', () => {
  const entries = [path.join(root, 'src', 'platform', 'runtime', 'lib', 'application', 'active-service.ts'), path.join(root, 'src', 'platform', 'runtime', 'lib', 'application', 'stats-backfill-service.ts')];
  assert.deepEqual(findForbiddenApplicationDependencies(entries), []);
});

test('application import guard rejects every direct prohibited dependency category', () => {
  const violations = findForbiddenApplicationDependencies([fixture('direct-prohibited.ts')]).join('\n');
  for (const dependency of ['ink', 'react', 'http', 'sqlite', 'node:fs', '../core/git', '../tools/forgejo', 'node:child_process', '../core/fmt', 'process.exit']) {
    assert.match(violations, new RegExp(dependency.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
});

test('application import guard rejects transitive prohibited dependency fixture', () => {
  assert.match(findForbiddenApplicationDependencies([fixture('transitive-prohibited.ts')]).join('\n'), /node:fs/);
});

test('composition guard accepts the sole production composition root', () => {
  assert.deepEqual(findCompositionViolations(path.join(root, 'src', 'platform', 'runtime', 'lib')), []);
  const graph = createProductionApplicationServices(root);
  assert.equal(graph.active.constructor.name, 'ActiveService');
  assert.equal(graph.statsBackfill.constructor.name, 'StatsBackfillService');
});

test('composition guard rejects complete adapter construction fixture', () => {
  assert.ok(findCompositionViolations(path.dirname(fixture('composition-violation.ts'))).includes(fixture('composition-violation.ts')));
});

test('composition guard rejects service-locator access fixture', () => {
  assert.ok(findCompositionViolations(path.dirname(fixture('locator-violation.ts'))).includes(fixture('locator-violation.ts')));
});
