import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const {
  allowedDependencyGraph,
  findDependencyViolations,
  findProductionDependencyViolations,
  layerRoots,
  legacyLayerRoots,
} = require('../.test-runtime/lib/architecture/boundary-guards');

function withFixture(source: string, target: string, run: (root: string) => void): void {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dependency-graph-'));
  try {
    const sourceFile = path.join(root, source);
    const targetFile = path.join(root, target);
    fs.mkdirSync(path.dirname(sourceFile), { recursive: true });
    fs.mkdirSync(path.dirname(targetFile), { recursive: true });
    fs.writeFileSync(targetFile, 'export const dependency = true;\n');
    const relative = path.relative(path.dirname(sourceFile), targetFile).replace(/\\/g, '/').replace(/\.ts$/, '.js');
    fs.writeFileSync(sourceFile, `import { dependency } from '${relative.startsWith('.') ? relative : `./${relative}`}';\nexport { dependency };\n`);
    run(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function assertPermitted(layer: string, source: string, target: string): void {
  withFixture(source, target, root => {
    assert.deepEqual(findDependencyViolations(root), [], `${layer} permitted edge should not violate the graph`);
  });
}

test('dependency graph validates domain layer imports without unallowlisted violations', () => {
  assert.deepEqual(allowedDependencyGraph.domain, ['domain']);
  assertPermitted('domain', 'src/domain/source.ts', 'src/domain/target.ts');
});

test('dependency graph validates application layer imports without unallowlisted violations', () => {
  assert.deepEqual(allowedDependencyGraph.application, ['domain', 'application']);
  assertPermitted('application', 'src/application/source.ts', 'src/domain/target.ts');
});

test('dependency graph validates adapters layer imports without unallowlisted violations', () => {
  assert.deepEqual(allowedDependencyGraph.adapters, ['domain', 'application', 'adapters']);
  assertPermitted('adapters', 'src/adapters/source.ts', 'src/application/target.ts');
});

test('dependency graph validates interfaces layer imports without unallowlisted violations', () => {
  assert.deepEqual(allowedDependencyGraph.interfaces, ['domain', 'application', 'interfaces']);
  assertPermitted('interfaces', 'src/interfaces/source.ts', 'src/application/target.ts');
});

test('dependency graph validates composition layer imports without unallowlisted violations', () => {
  assert.deepEqual(layerRoots.composition, ['src/composition']);
  assert.deepEqual(legacyLayerRoots.composition, ['src/platform/runtime', 'src/platform/assets']);
  assert.deepEqual(allowedDependencyGraph.composition, ['domain', 'application', 'adapters', 'interfaces', 'composition']);
  assertPermitted('composition', 'src/composition/source.ts', 'src/adapters/target.ts');
});

test('dependency graph keeps legacy package runtime assets classified during migration', () => {
  assertPermitted('composition assets', 'src/platform/runtime/source.ts', 'src/platform/assets/target.ts');
});

test('dependency graph validates entry layer imports without unallowlisted violations', () => {
  assert.deepEqual(allowedDependencyGraph.entry, ['composition', 'interfaces']);
  assertPermitted('entry', 'src/entry/source.ts', 'src/composition/target.ts');
});

test('dependency graph rejects an interface import of a canonical composition module', () => {
  withFixture('src/interfaces/source.ts', 'src/composition/target.ts', root => {
    const violations = findDependencyViolations(root);
    assert.deepEqual(violations.map((violation: { sourceLayer: string; targetLayer: string }) => [violation.sourceLayer, violation.targetLayer]), [['interfaces', 'composition']]);
  });
});

test('dependency graph rejects a forbidden unallowlisted application-to-adapter edge immediately', () => {
  withFixture('src/application/source.ts', 'src/adapters/target.ts', root => {
    const violations = findDependencyViolations(root);
    assert.deepEqual(violations.map((violation: { sourceLayer: string; targetLayer: string }) => [violation.sourceLayer, violation.targetLayer]), [['application', 'adapters']]);
  });
});

test('dependency graph honors an explicitly owned legacy exception', () => {
  withFixture('src/application/source.ts', 'src/adapters/target.ts', root => {
    assert.deepEqual(findDependencyViolations(root, [{
      source: 'src/application/source.ts',
      target: 'src/adapters/target.ts',
      ownerTaskId: 'TASK-9999.01',
      removalMission: 'mission/task-9999.01',
    }]), []);
  });
});

test('dependency graph production scan has no violation outside the owned allowlist', () => {
  assert.deepEqual(findProductionDependencyViolations(process.cwd()), []);
});
