// Layout and registration validation contract for test/lib/test-layout-validation.ts
// (TASK-2638). Every case validates a synthetic repository listing, so it proves
// the rule rather than today's inventory; the final case checks the real tree.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {
  boundaryCallsIn, collectLayoutInput, validateTestLayout, type LayoutInput, type LayoutRegistry,
} from '../../../lib/test-layout-validation.js';

const REPO_ROOT = path.join(import.meta.dirname, '..', '..', '..', '..');

const VALID_FILES = [
  'src/domain/mission.ts',
  'src/adapters/sqlite/store.ts',
  'scripts/coverage-merge.ts',
  'test/lib/test-tier-selection.ts',
  'test/run-default-tests.ts',
  'test/bootstrap-parallix-home.ts',
  'test/fixtures/mission-builders.ts',
  'test/unit/domain/mission.test.ts',
  'test/unit/domain/mission-contract.cases.ts',
  'test/unit/adapters/sqlite/index.test.ts',
  'test/unit/persistence-guardrail.test.ts',
  'test/unit/scripts/coverage-merge.test.ts',
  'test/unit/test/lib/test-tier-selection.test.ts',
  'test/unit/repository/file-size-cap.test.ts',
  'test/integration/sqlite/index.test.ts',
  'test/integration/sandbox/bwrap.test.ts',
  'test/integration/presentation/shell-lifetime.fixture.ts',
  'test/e2e/lifecycle/mission-lifecycle.test.ts',
  'test/e2e/cli/deterministic-workflow.test.ts',
  'tools/coverage-comparison/bundle-attribution-probe/test/mod.test.ts',
];

const VALID_REGISTRY: LayoutRegistry = {
  ci: ['integration/sqlite/index.test.ts', 'e2e/cli/deterministic-workflow.test.ts'],
  local: ['integration/sandbox/bwrap.test.ts'],
  localReasons: { 'integration/sandbox/bwrap.test.ts': 'Spawns bwrap, which the hosted runner image lacks.' },
  agentE2e: ['e2e/lifecycle/mission-lifecycle.test.ts'],
};

function input(overrides: Partial<LayoutInput> & { extraFiles?: string[]; sources?: Record<string, string> } = {}): LayoutInput {
  const { extraFiles = [], sources = {}, ...rest } = overrides;
  return {
    repoFiles: [...VALID_FILES, ...extraFiles],
    registry: VALID_REGISTRY,
    sharedUnitFiles: ['unit/domain/mission.test.ts'],
    cpuBudgetFiles: ['integration/sqlite/index.test.ts'],
    readSource: file => sources[file] ?? "import test from 'node:test';\ntest('case', () => {});\n",
    ...rest,
  };
}

function errorsFor(overrides: Parameters<typeof input>[0]): string[] {
  return validateTestLayout(input(overrides));
}

test('a nested three-level layout with src mirrors, direct non-src owners, and registered lanes validates', () => {
  assert.deepEqual(validateTestLayout(input()), []);
});

test('runnable test sources outside the level roots fail with the offending path', () => {
  const errors = errorsFor({ extraFiles: ['test/flat.test.ts', 'test/misc/helper.test.ts', 'test/lib/stray.test.ts', 'src/domain/inline.test.ts'] });
  for (const file of ['test/flat.test.ts', 'test/misc/helper.test.ts', 'test/lib/stray.test.ts', 'src/domain/inline.test.ts']) {
    assert.ok(errors.some(error => error.startsWith(`${file}:`)), `${file} must be rejected: ${errors.join('\n')}`);
  }
});

test('level roots hold suites and explicitly suffixed support files only', () => {
  const errors = errorsFor({ extraFiles: ['test/unit/domain/helper.ts', 'test/integration/sqlite/notes.md'] }).sort();
  assert.equal(errors.length, 2);
  assert.match(errors[0], /^test\/integration\/sqlite\/notes\.md: level roots hold/);
  assert.match(errors[1], /^test\/unit\/domain\/helper\.ts: level roots hold/);
});

test('a unit suite must mirror an existing source directory without an extra src level', () => {
  assert.deepEqual(errorsFor({ extraFiles: ['test/unit/missions/lifecycle.test.ts'] }),
    ['test/unit/missions/lifecycle.test.ts: test/unit/missions mirrors no source directory src/missions/']);
  assert.match(errorsFor({ extraFiles: ['test/unit/src/domain/mission.test.ts'] })[0],
    /^test\/unit\/src\/domain\/mission\.test\.ts: drop the extra src\/ level/);
});

test('non-src ownership mirrors its owner directly without accepting unowned directories', () => {
  assert.deepEqual(errorsFor({ extraFiles: ['test/unit/scripts/release.test.ts'] }), []);
  const errors = errorsFor({ extraFiles: [
    'test/unit/_repo/scripts/release.test.ts', 'test/unit/misc/bucket.test.ts',
    'test/unit/test/unit/domain/mission.test.ts', 'test/unit/scripts/missing/release.test.ts',
  ] });
  assert.equal(errors.length, 4, errors.join('\n'));
  assert.ok(errors.some(error => error.includes('test/unit/_repo/scripts')));
  assert.ok(errors.some(error => error.includes('test/unit/misc')));
  assert.ok(errors.some(error => error.includes('never runnable suite directories')));
  assert.ok(errors.some(error => error.includes('mirrors no repository directory scripts/missing/')));
  assert.ok(errorsFor({ extraFiles: ['src/scripts/build.ts'] }).some(error => error.includes('collides with src/scripts/')));
});

test('an unregistered boundary suite fails instead of vanishing or inheriting CI eligibility', () => {
  assert.deepEqual(errorsFor({ extraFiles: ['test/integration/git/worktree.test.ts'] }), [
    'integration/git/worktree.test.ts: unclassified integration suite; register it in INTEGRATION_CI_TESTS, INTEGRATION_LOCAL_TESTS (with a reason), or AGENT_E2E_TESTS',
  ]);
});

test('dangling, duplicate, conflicting, unnormalized, and unit registrations fail', () => {
  const registry: LayoutRegistry = {
    ...VALID_REGISTRY,
    ci: [...VALID_REGISTRY.ci, 'integration/sqlite/index.test.ts', 'integration/sqlite/renamed.test.ts', './integration/sqlite/index.test.ts',
      'unit/domain/mission.test.ts', 'integration/sandbox/bwrap.test.ts'],
  };
  const errors = errorsFor({ registry });
  assert.ok(errors.includes('INTEGRATION_CI_TESTS: duplicate entry integration/sqlite/index.test.ts'), errors.join('\n'));
  assert.ok(errors.includes('INTEGRATION_CI_TESTS: integration/sqlite/renamed.test.ts matches no discovered suite'));
  assert.ok(errors.includes('INTEGRATION_CI_TESTS: ./integration/sqlite/index.test.ts is not a normalized test-root-relative path'));
  assert.ok(errors.includes('INTEGRATION_CI_TESTS: unit/domain/mission.test.ts is a unit suite; unit membership comes from its test/unit/ path'));
  assert.ok(errors.includes('integration/sandbox/bwrap.test.ts: registered in both INTEGRATION_CI_TESTS and INTEGRATION_LOCAL_TESTS'));
});

test('local-only suites must record the missing hosted-runner dependency', () => {
  const errors = errorsFor({ registry: { ...VALID_REGISTRY, localReasons: { 'integration/sqlite/index.test.ts': 'not local' } } });
  assert.ok(errors.includes('INTEGRATION_LOCAL_REASONS: integration/sandbox/bwrap.test.ts records no missing GitHub-runner dependency'), errors.join('\n'));
  assert.ok(errors.includes('INTEGRATION_LOCAL_REASONS: integration/sqlite/index.test.ts is not an INTEGRATION_LOCAL_TESTS entry'));
});

test('agent workflows live below test/e2e while an e2e path may keep its integration-ci assignment', () => {
  assert.deepEqual(errorsFor({}), []);
  const errors = errorsFor({ registry: { ...VALID_REGISTRY, agentE2e: [...VALID_REGISTRY.agentE2e, 'integration/sqlite/index.test.ts'] } });
  assert.ok(errors.includes('AGENT_E2E_TESTS: integration/sqlite/index.test.ts must live below test/e2e/'), errors.join('\n'));
});

test('an empty required population fails', () => {
  const errors = errorsFor({
    repoFiles: VALID_FILES.filter(file => !file.startsWith('test/unit/') && file !== 'test/integration/sandbox/bwrap.test.ts'),
    registry: { ...VALID_REGISTRY, local: [], localReasons: {} },
    sharedUnitFiles: [],
  });
  assert.ok(errors.includes('unit: required population is empty'), errors.join('\n'));
  assert.ok(errors.includes('integration-local: required population is empty'));
});

test('shared-process and CPU policies must name live suites of the right level', () => {
  const errors = errorsFor({
    sharedUnitFiles: ['unit/domain/mission.test.ts', 'unit/domain/mission.test.ts', 'unit/domain/renamed.test.ts', 'integration/sqlite/index.test.ts'],
    cpuBudgetFiles: ['integration/sqlite/index.test.ts', 'integration/sqlite/renamed.test.ts'],
  });
  assert.deepEqual(errors, [
    'shared-unit-files.json: duplicate entry unit/domain/mission.test.ts',
    'shared-unit-files.json: unit/domain/renamed.test.ts is not a discovered unit suite',
    'shared-unit-files.json: integration/sqlite/index.test.ts is not a discovered unit suite',
    'test-cpu-budgets.json: integration/sqlite/renamed.test.ts is not a registered integration suite',
  ]);
});

test('boundary words in comments or strings keep a unit suite unit; real boundary calls fail separately', () => {
  const mentions = [
    "// This suite never calls spawn, fetch, or git init; it only names them.",
    "const label = 'spawnSync(git, [\"worktree\"]) and fetch(url)';",
    "mock.method(childProcess, 'spawnSync', () => ({ status: 0 }));",
    "const command = `npm pack && git commit && fork()`;",
    "/* spawnSync('git', ['init']) */ function spawn(fake: string) { return fake; }",
  ].join('\n');
  assert.deepEqual(boundaryCallsIn(mentions), []);
  assert.deepEqual(errorsFor({ sources: { 'test/unit/domain/mission.test.ts': mentions } }), []);
  assert.deepEqual(boundaryCallsIn("spawnSync('git', ['status']);\nchild.fork();\nawait fetch(url);"), ['spawnSync', 'fork', 'fetch']);
  assert.deepEqual(boundaryCallsIn("const out = `${execFileSync('git', ['log'])} lines`;"), ['execFileSync'],
    'a call inside a template expression is executable code');
  assert.deepEqual(errorsFor({ sources: { 'test/unit/domain/mission.test.ts': "import { execFileSync } from 'node:child_process';\nexecFileSync('git', ['init']);" } }), [
    'test/unit/domain/mission.test.ts: unit suite calls execFileSync(); real process, socket, or network boundaries belong in test/integration/',
  ]);
});

test('the repository tree, registries, and execution policies are consistent', () => {
  assert.deepEqual(validateTestLayout(collectLayoutInput(REPO_ROOT)), []);
});
