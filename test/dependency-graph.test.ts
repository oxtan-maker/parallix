import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import {
  adapterPackageDependencies,
  allowedDependencyGraph,
  classifyDependencyLayer,
  findCrossAdapterViolations,
  findDependencyViolations,
  findPlatformPaths,
  findProductionDependencyViolations,
  productionDependencyExceptions,
  findResponsibilityViolations,
  findServiceLocationViolations,
  findUnclassifiedProductionModules,
  formatResponsibilityViolation,
  dependencyLayers,
  layerRoots,
} from '../src/adapters/architecture/boundary-guards.js';

function withTempRoot(run: (_root: string) => void): void {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dependency-graph-'));
  try {
    run(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function writeModule(root: string, relativePath: string, body: string): string {
  const file = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, body);
  return file;
}

function importLine(fromFile: string, toFile: string, binding: string): string {
  const relative = path.relative(path.dirname(fromFile), toFile).replace(/\\/g, '/').replace(/\.ts$/, '.js');
  return `import { dependency as ${binding} } from '${relative.startsWith('.') ? relative : `./${relative}`}';\n`;
}

/** Builds a two-module fixture tree: `source` imports `target`. */
function withFixture(source: string, target: string, run: (_root: string) => void): void {
  withTempRoot(root => {
    const targetFile = writeModule(root, target, 'export const dependency = true;\n');
    const sourceFile = path.join(root, source);
    fs.mkdirSync(path.dirname(sourceFile), { recursive: true });
    fs.writeFileSync(sourceFile, `${importLine(sourceFile, targetFile, 'dependency')}export { dependency };\n`);
    run(root);
  });
}

function assertPermitted(layer: string, source: string, target: string): void {
  withFixture(source, target, root => {
    assert.deepEqual(findDependencyViolations(root), [], `${layer} permitted edge should not violate the graph`);
  });
}

/* ------------------------------------------------------------------ *
 * Layer dependency graph
 * ------------------------------------------------------------------ */

test('dependency graph validates domain layer imports without unallowlisted violations', () => {
  assert.deepEqual(allowedDependencyGraph.domain, ['domain']);
  assertPermitted('domain', 'src/domain/source.ts', 'src/domain/target.ts');
});

test('dependency graph validates application layer imports without unallowlisted violations', () => {
  assert.deepEqual(allowedDependencyGraph.application, ['domain', 'application']);
  assertPermitted('application', 'src/application/source.ts', 'src/domain/target.ts');
});

test('dependency graph grants adapters no blanket adapters-to-adapters permission', () => {
  assert.deepEqual(allowedDependencyGraph.adapters, ['domain', 'application']);
  assert.equal(allowedDependencyGraph.adapters.includes('adapters'), false);
  assertPermitted('adapters', 'src/adapters/git/source.ts', 'src/application/target.ts');
});

test('dependency graph validates interfaces layer imports without unallowlisted violations', () => {
  assert.deepEqual(allowedDependencyGraph.interfaces, ['domain', 'application', 'interfaces']);
  assertPermitted('interfaces', 'src/interfaces/source.ts', 'src/application/target.ts');
});

test('dependency graph validates composition layer imports without unallowlisted violations', () => {
  assert.deepEqual(layerRoots.composition, ['src/composition']);
  assert.deepEqual(allowedDependencyGraph.composition, ['domain', 'application', 'adapters', 'interfaces', 'composition']);
  assertPermitted('composition', 'src/composition/source.ts', 'src/adapters/target.ts');
});

test('dependency graph validates entry layer imports without unallowlisted violations', () => {
  assert.deepEqual(allowedDependencyGraph.entry, ['composition', 'interfaces']);
  assertPermitted('entry', 'src/entry/source.ts', 'src/composition/target.ts');
});

test('dependency graph rejects an interface import of a canonical composition module', () => {
  withFixture('src/interfaces/source.ts', 'src/composition/target.ts', root => {
    const violations = findDependencyViolations(root);
    assert.deepEqual(violations.map(violation => [violation.sourceLayer, violation.targetLayer]), [['interfaces', 'composition']]);
  });
});

test('dependency graph rejects an adapter import of a canonical composition module', () => {
  withFixture('src/adapters/review/source.ts', 'src/composition/production-capabilities.ts', root => {
    const violations = findDependencyViolations(root);
    assert.deepEqual(violations.map(violation => [violation.sourceLayer, violation.targetLayer]), [['adapters', 'composition']]);
  });
});

test('dependency graph rejects a forbidden unallowlisted application-to-adapter edge immediately', () => {
  withFixture('src/application/source.ts', 'src/adapters/target.ts', root => {
    const violations = findDependencyViolations(root);
    assert.deepEqual(violations.map(violation => [violation.sourceLayer, violation.targetLayer]), [['application', 'adapters']]);
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

test('every owned dependency exception names a task ID and an existing removal mission', () => {
  for (const exception of productionDependencyExceptions) {
    assert.match(exception.ownerTaskId, /^TASK-\d+(?:\.\d+)?$/, `exception ${exception.source} -> ${exception.target} needs an owning task ID`);
    assert.ok(
      fs.existsSync(path.resolve(process.cwd(), exception.removalMission)),
      `exception ${exception.source} -> ${exception.target} names removal mission ${exception.removalMission}, which does not exist`,
    );
  }
});

test('every owned dependency exception still describes a live application-to-adapter edge', () => {
  for (const exception of productionDependencyExceptions) {
    for (const file of [exception.source, exception.target]) {
      assert.ok(fs.existsSync(path.resolve(process.cwd(), file)), `stale exception: ${file} no longer exists`);
    }
    assert.equal(classifyDependencyLayer(exception.source, process.cwd()), 'application');
    assert.equal(classifyDependencyLayer(exception.target, process.cwd()), 'adapters');
  }
});

test('platform-path guard rejects a production legacy directory even without an import edge', () => {
  withTempRoot(root => {
    writeModule(root, path.join('src', 'platform', 'runtime', 'legacy.ts'), 'export const legacy = true;\n');
    assert.deepEqual(findPlatformPaths(root), ['src/platform/runtime/legacy.ts']);
  });
});

test('repository has no retired src/platform paths', () => {
  assert.deepEqual(findPlatformPaths(process.cwd()), []);
});

/* ------------------------------------------------------------------ *
 * SC1 — responsibility classification of every production module
 * ------------------------------------------------------------------ */

test('responsibility model owns exactly the six canonical layers, with no second classification table', () => {
  assert.deepEqual([...dependencyLayers].sort(), ['adapters', 'application', 'composition', 'domain', 'entry', 'interfaces']);
  assert.deepEqual(layerRoots, {
    domain: ['src/domain'],
    application: ['src/application'],
    adapters: ['src/adapters'],
    interfaces: ['src/interfaces'],
    composition: ['src/composition'],
    entry: ['src/entry'],
  });
});

test('responsibility classifier assigns each canonical root its owning responsibility', () => {
  withTempRoot(root => {
    for (const layer of dependencyLayers) {
      for (const layerRoot of layerRoots[layer]) {
        const file = writeModule(root, path.join(layerRoot, 'module.ts'), 'export const value = 1;\n');
        assert.equal(classifyDependencyLayer(file, root), layer, `${layerRoot} must be owned by ${layer}`);
      }
    }
  });
});

test('responsibility scan reports a new unclassified production module with its path and expected owner', () => {
  withTempRoot(root => {
    writeModule(root, path.join('src', 'domain', 'kept.ts'), 'export const value = 1;\n');
    writeModule(root, path.join('src', 'runtime', 'relabeled-monolith.ts'), 'export const value = 2;\n');
    const violations = findUnclassifiedProductionModules(root);
    assert.deepEqual(violations.map(violation => violation.file), [path.join('src', 'runtime', 'relabeled-monolith.ts')]);
    assert.equal(violations[0].rule, 'unclassified-production-module');
    assert.equal(violations[0].actualOwner, 'unclassified');
    assert.match(formatResponsibilityViolation(violations[0]), /relabeled-monolith\.ts: rule unclassified-production-module failed .* expected owner: application, actual owner: unclassified/);
  });
});

test('responsibility scan reports a loose module at the src root as unclassified', () => {
  withTempRoot(root => {
    writeModule(root, path.join('src', 'stray.ts'), 'export const value = 1;\n');
    assert.deepEqual(findUnclassifiedProductionModules(root).map(violation => violation.file), [path.join('src', 'stray.ts')]);
  });
});

test('production tree has no unclassified module', () => {
  assert.deepEqual(findUnclassifiedProductionModules(process.cwd()), []);
});

/* ------------------------------------------------------------------ *
 * SC2 — named cross-adapter dependency rules
 * ------------------------------------------------------------------ */

test('cross-adapter rules name every adapter package and grant no wildcard', () => {
  const packages = fs.readdirSync(path.join(process.cwd(), 'src', 'adapters'), { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => entry.name)
    .sort();
  assert.deepEqual(Object.keys(adapterPackageDependencies).sort(), packages);
  for (const [source, targets] of Object.entries(adapterPackageDependencies)) {
    assert.equal(targets.includes('*'), false, `${source} must not hold a wildcard permission`);
    assert.equal(targets.includes(source), false, `${source} must not restate its own package`);
    for (const target of targets) {
      assert.ok(packages.includes(target), `${source} names unknown package ${target}`);
    }
  }
});

test('cross-adapter guard rejects a prohibited direct import between unnamed adapter packages', () => {
  withFixture('src/adapters/alpha/source.ts', 'src/adapters/beta/target.ts', root => {
    const violations = findCrossAdapterViolations(root);
    assert.deepEqual(violations.map(violation => [violation.file, violation.rule, violation.expectedOwner]), [
      [path.join('src', 'adapters', 'alpha', 'source.ts'), 'cross-adapter-dependency-not-named', 'application'],
    ]);
    assert.match(formatResponsibilityViolation(violations[0]), /declares no named dependency on "beta".*application-owned port/s);
  });
});

test('cross-adapter guard permits an edge that matches a named package rule', () => {
  withFixture('src/adapters/git/source.ts', 'src/adapters/config/target.ts', root => {
    assert.ok(adapterPackageDependencies.git.includes('config'));
    assert.deepEqual(findCrossAdapterViolations(root), []);
  });
});

test('cross-adapter guard permits an edge inside a single adapter package', () => {
  withFixture('src/adapters/git/source.ts', 'src/adapters/git/nested/target.ts', root => {
    assert.deepEqual(findCrossAdapterViolations(root), []);
  });
});

test('production tree has no unnamed cross-adapter dependency', () => {
  assert.deepEqual(findCrossAdapterViolations(process.cwd()), []);
});

/* ------------------------------------------------------------------ *
 * SC3 — hidden service location
 * ------------------------------------------------------------------ */

test('responsibility guard fails hidden service location in an adapter module', () => {
  withTempRoot(root => {
    writeModule(root, path.join('src', 'adapters', 'git', 'locator.ts'), 'export const resolve = (services: Record<string, unknown>) => services["gitPort"];\n');
    const violations = findServiceLocationViolations(root);
    assert.deepEqual(violations.map(violation => [violation.file, violation.rule, violation.expectedOwner, violation.actualOwner]), [
      [path.join('src', 'adapters', 'git', 'locator.ts'), 'hidden-service-location', 'composition', 'adapters'],
    ]);
    assert.match(formatResponsibilityViolation(violations[0]), /resolves collaborators by dynamic key lookup/);
  });
});

test('responsibility guard fails complete-graph construction outside the composition root', () => {
  withTempRoot(root => {
    writeModule(root, path.join('src', 'adapters', 'mission', 'sneaky-root.ts'), 'export const build = () => { const ports = createExecuteMissionPorts(); return [ports, new LegacyStatsBackfillAdapter()]; };\n');
    const violations = findServiceLocationViolations(root);
    assert.deepEqual(violations.map(violation => [violation.file, violation.rule, violation.expectedOwner]), [
      [path.join('src', 'adapters', 'mission', 'sneaky-root.ts'), 'complete-graph-outside-composition', 'composition'],
    ]);
  });
});

test('production tree has no hidden service location', () => {
  assert.deepEqual(findServiceLocationViolations(process.cwd()), []);
});

/* ------------------------------------------------------------------ *
 * SC4/SC5 — aggregate scan and actionable diagnostics
 * ------------------------------------------------------------------ */

test('aggregate responsibility scan reports every failing rule for one fixture tree', () => {
  withTempRoot(root => {
    writeModule(root, path.join('src', 'runtime', 'unowned.ts'), 'export const value = 1;\n');
    const alpha = path.join(root, 'src', 'adapters', 'alpha', 'source.ts');
    const beta = writeModule(root, path.join('src', 'adapters', 'beta', 'target.ts'), 'export const dependency = true;\n');
    fs.mkdirSync(path.dirname(alpha), { recursive: true });
    fs.writeFileSync(alpha, `${importLine(alpha, beta, 'dependency')}export const resolve = (services: Record<string, unknown>) => [dependency, services["port"]];\n`);
    const rules = findResponsibilityViolations(root).map(violation => violation.rule).sort();
    assert.deepEqual(rules, ['cross-adapter-dependency-not-named', 'hidden-service-location', 'unclassified-production-module']);
  });
});

test('every responsibility violation names the offending file, the failed rule, and the expected owner', () => {
  withTempRoot(root => {
    writeModule(root, path.join('src', 'runtime', 'unowned.ts'), 'export const value = 1;\n');
    writeModule(root, path.join('src', 'adapters', 'git', 'locator.ts'), 'export const resolve = (services: Record<string, unknown>) => services["gitPort"];\n');
    const violations = findResponsibilityViolations(root);
    assert.ok(violations.length >= 2);
    for (const violation of violations) {
      const rendered = formatResponsibilityViolation(violation);
      assert.ok(rendered.startsWith(`${violation.file}:`), `diagnostic must lead with the offending file: ${rendered}`);
      assert.ok(rendered.includes(`rule ${violation.rule} failed`), `diagnostic must name the failed rule: ${rendered}`);
      assert.ok(rendered.includes(`expected owner: ${violation.expectedOwner}`), `diagnostic must name the expected owner: ${rendered}`);
      assert.ok(rendered.includes(`actual owner: ${violation.actualOwner}`), `diagnostic must name the actual owner: ${rendered}`);
    }
  });
});

test('responsibility scan is clean for a tree that exercises all six responsibilities', () => {
  withTempRoot(root => {
    const domain = writeModule(root, path.join('src', 'domain', 'model.ts'), 'export const dependency = true;\n');
    const application = path.join(root, 'src', 'application', 'use-case.ts');
    fs.mkdirSync(path.dirname(application), { recursive: true });
    fs.writeFileSync(application, `${importLine(application, domain, 'dependency')}export const useCase = () => dependency;\n`);
    const adapter = path.join(root, 'src', 'adapters', 'git', 'git-adapter.ts');
    fs.mkdirSync(path.dirname(adapter), { recursive: true });
    fs.writeFileSync(adapter, `${importLine(adapter, domain, 'dependency')}export const adapter = () => dependency;\n`);
    const interfaces = path.join(root, 'src', 'interfaces', 'cli.ts');
    fs.mkdirSync(path.dirname(interfaces), { recursive: true });
    fs.writeFileSync(interfaces, `${importLine(interfaces, application, 'useCase')}export const cli = () => useCase;\n`);
    const composition = path.join(root, 'src', 'composition', 'root.ts');
    fs.mkdirSync(path.dirname(composition), { recursive: true });
    fs.writeFileSync(composition, `${importLine(composition, adapter, 'adapter')}export const root = () => adapter;\n`);
    const entry = path.join(root, 'src', 'entry', 'px.ts');
    fs.mkdirSync(path.dirname(entry), { recursive: true });
    fs.writeFileSync(entry, `${importLine(entry, composition, 'root')}export const main = () => root;\n`);

    assert.deepEqual(findResponsibilityViolations(root), []);
    assert.deepEqual(findDependencyViolations(root), []);
    for (const layer of dependencyLayers) {
      assert.ok(
        [domain, application, adapter, interfaces, composition, entry].some(file => classifyDependencyLayer(file, root) === layer),
        `${layer} must be exercised by the six-responsibility fixture`,
      );
    }
  });
});


/* ------------------------------------------------------------------ *
 * TASK-2332.03 — application ports are capability-owned and neutral
 * ------------------------------------------------------------------ */

const portsDirectory = path.resolve(process.cwd(), 'src', 'application', 'ports');

function portFiles(): string[] {
  return fs.readdirSync(portsDirectory).filter(name => name.endsWith('.ts')).sort();
}

test('every application port module is a capability module that declares contracts', () => {
  const files = portFiles();
  assert.ok(files.length > 0, 'src/application/ports/ must contain capability modules');
  for (const file of files) {
    const source = fs.readFileSync(path.join(portsDirectory, file), 'utf8');
    assert.match(
      source,
      /export (?:interface|type) /,
      `${file} must declare at least one exported contract to be a capability port module`,
    );
  }
});

test('application ports name no storage mechanism in their declarations', () => {
  // Prose may name a mechanism to say the port deliberately excludes it; a
  // declaration may not, because that is the leak ADR 0051 forbids.
  const mechanism = /\b(?:sqlite|DatabaseSync|StatementSync|legacy-storage|legacyStorage)\b/i;
  for (const file of portFiles()) {
    const declarations = fs.readFileSync(path.join(portsDirectory, file), 'utf8')
      .split('\n')
      .filter(line => !/^\s*(?:\/\/|\/?\*)/.test(line));
    const leak = declarations.find(line => mechanism.test(line));
    assert.equal(leak, undefined, `${file} leaks a storage mechanism into a port declaration: ${leak}`);
  }
});

test('application ports import no adapter and no storage runtime', () => {
  const forbidden = /from '(?:node:sqlite|[^']*\/adapters\/[^']*)'/;
  for (const file of portFiles()) {
    const source = fs.readFileSync(path.join(portsDirectory, file), 'utf8');
    const offending = source.split('\n').find(line => forbidden.test(line));
    assert.equal(offending, undefined, `${file} must not import an adapter or a storage runtime: ${offending}`);
  }
});


/* ------------------------------------------------------------------ *
 * TASK-2332.06 — the architecture documentation and the graph agree
 * ------------------------------------------------------------------ */

const architectureDocuments = [
  'docs/adr/0051-ui-neutral-application-boundary.md',
  'src/adapters/README.md',
  'src/composition/README.md',
  'src/interfaces/README.md',
  'src/entry/README.md',
];

test('ADR 0051 names every canonical layer root the graph enforces', () => {
  const adr = fs.readFileSync(path.resolve(process.cwd(), 'docs/adr/0051-ui-neutral-application-boundary.md'), 'utf8');
  for (const roots of Object.values(layerRoots)) {
    for (const root of roots) {
      assert.ok(adr.includes(root), `ADR 0051 must name the canonical layer root ${root} that boundary-guards.ts enforces`);
    }
  }
});

test('no architecture document describes a layer the graph does not enforce', () => {
  const enforced = new Set(Object.values(layerRoots).flat());
  for (const document of architectureDocuments) {
    const text = fs.readFileSync(path.resolve(process.cwd(), document), 'utf8');
    for (const claimed of text.match(/src\/[a-z-]+(?=\/|`|\b)/g) ?? []) {
      if (claimed.split('/').length !== 2) { continue; }
      assert.ok(
        enforced.has(claimed),
        `${document} describes ${claimed} as a source tree, but layerRoots does not enforce it`,
      );
    }
  }
});

test('no production module names a retired migration scaffold', () => {
  // The scaffolds TASK-2332 removed. A reference here means either the scaffold
  // came back or a comment is describing architecture that no longer exists.
  const retired = /\b(?:LegacyActiveAdapter|ActivePort|src\/platform)\b/;
  const production = dependencyLayers
    .flatMap(layer => layerRoots[layer])
    .flatMap(root => walkProduction(path.resolve(process.cwd(), root)));
  for (const file of production) {
    const offending = fs.readFileSync(file, 'utf8').split('\n').find(line => retired.test(line));
    assert.equal(offending, undefined, `${path.relative(process.cwd(), file)} names a retired migration scaffold: ${offending}`);
  }
});

function walkProduction(dir: string): string[] {
  if (!fs.existsSync(dir)) { return []; }
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) { return walkProduction(file); }
    return entry.isFile() && /\.(?:ts|tsx)$/.test(entry.name) ? [file] : [];
  });
}
