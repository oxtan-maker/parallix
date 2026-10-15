import test from 'node:test';
import assert from 'node:assert/strict';
import { admitGateFact, relateToCandidate, substantiveInterdiffPaths, type GateFactRelation, type RecordedValidation } from '../../../../src/application/review-classification/gate-fact.js';
import type { ReviewEvidencePort } from '../../../../src/application/ports/review-evidence.js';

// Boundary: which recorded green validations may stand in for a rerun of the failed gate.
const STARTED = '2026-10-12T12:00:10.000Z';
const validation = (sha: string, recordedAt: string, hooks = ['unit', 'integration']): RecordedValidation => ({ sha, hooks, recordedAt });
const admit = (validations: readonly RecordedValidation[], relation: GateFactRelation | null = 'same', gate: string | null = 'integration') =>
  admitGateFact({ validations, gate, roundStartedAt: STARTED, candidate: 'cand', relate: async () => relation });
const bare: ReviewEvidencePort = {
  tree: async () => [], source: async () => '', diff: async () => '', mainCommits: async () => [],
  missionInterdiff: async () => ({ diff: '', paths: [] }), changedPaths: async () => [], mergeBase: async () => 'base-old', subjects: async () => [],
};

test('admits a validation recorded before the round for the failed gate at the candidate (TASK-2736.1)', async () => {
  const result = await admit([validation('cand', '2026-10-12T12:00:05Z')]);
  assert.deepEqual(result, { admitted: true, fact: { gate: 'integration', validationSha: 'cand', recordedAt: '2026-10-12T12:00:05Z', candidate: 'cand', relation: 'same' } });
});

test('rejects a validation recorded after the round started (TASK-2736.2)', async () => {
  assert.deepEqual(await admit([validation('cand', '2026-10-12T12:00:11Z')]), { admitted: false, reason: 'fact-after-round-start' });
});

test('rejects when no validation was recorded or the failed gate was not among its hooks (TASK-2736.2)', async () => {
  assert.deepEqual(await admit([]), { admitted: false, reason: 'no-fact' });
  assert.deepEqual(await admit([validation('cand', '2026-10-12T12:00:00Z', ['unit'])]), { admitted: false, reason: 'gate-not-validated' });
  assert.deepEqual(await admit([validation('cand', '2026-10-12T12:00:00Z')], 'same', null), { admitted: false, reason: 'gate-not-validated' });
});

test('admits backlog-only and rebase-only relations and reports which one (TASK-2736.2)', async () => {
  for (const relation of ['backlog-only', 'rebase-only'] as const) {
    const result = await admit([validation('old', '2026-10-12T12:00:00Z')], relation);
    assert.equal(result.admitted && result.fact.relation, relation);
  }
});

test('rejects code changed after the validated revision (TASK-2736.2)', async () => {
  assert.deepEqual(await admit([validation('old', '2026-10-12T12:00:00Z')], 'code-changed'), { admitted: false, reason: 'code-after-validated-sha' });
});

test('an unreadable relation never admits and is reported separately (TASK-2736.2)', async () => {
  assert.deepEqual(await admit([validation('old', '2026-10-12T12:00:00Z')], null), { admitted: false, reason: 'relation-unavailable' });
});

test('uses the newest covering validation and skips one whose code differs (TASK-2736.2)', async () => {
  const relations: Record<string, GateFactRelation> = { newer: 'rebase-only', older: 'code-changed' };
  const result = await admitGateFact({ validations: [validation('older', '2026-10-12T11:00:00Z'), validation('newer', '2026-10-12T11:30:00Z')],
    gate: 'integration', roundStartedAt: STARTED, candidate: 'cand', relate: async sha => relations[sha] });
  assert.equal(result.admitted && result.fact.validationSha, 'newer');
});

test('relates identical, backlog-only, rebase-only and code-changed revisions (TASK-2736.2)', async () => {
  assert.equal(await relateToCandidate('c', 'c', bare, 'b', 'main'), 'same');
  const backlog = { ...bare, changedPaths: async () => ['backlog/tasks/task-1 - x.md', 'backlog/completed/task-2 - y.md'] } satisfies NonNullable<Parameters<typeof relateToCandidate>[2]>;
  assert.equal(await relateToCandidate('v', 'c', backlog, 'b', 'main'), 'backlog-only');
  const code = { ...bare, changedPaths: async () => ['src/a.ts'] } satisfies NonNullable<Parameters<typeof relateToCandidate>[2]>;
  assert.equal(await relateToCandidate('v', 'c', code, 'b', 'main'), 'rebase-only');
  const edited = { ...code, missionInterdiff: async () => ({ diff: '+src/a.ts\t+x', paths: ['src/a.ts'] }) } satisfies NonNullable<Parameters<typeof relateToCandidate>[2]>;
  assert.equal(await relateToCandidate('v', 'c', edited, 'b', 'main'), 'code-changed');
  assert.equal(await relateToCandidate('v', 'c', code, null, 'main'), null);
});

test('uses recorded per-revision baselines even when main was rewritten (TASK-2754)', async () => {
  const seen: unknown[] = [];
  const port = { ...bare, changedPaths: async () => ['src/a.ts'], mergeBase: async () => { assert.fail('current main cannot recover historical provenance'); },
    missionInterdiff: async (before: unknown, after: unknown) => { seen.push(before, after); return { diff: '', paths: [] }; } } satisfies NonNullable<Parameters<typeof relateToCandidate>[2]>;
  await relateToCandidate('v', 'c', port, 'new-base', 'recorded-old-main');
  assert.deepEqual(seen, [{ baseline: 'recorded-old-main', revision: 'v' }, { baseline: 'new-base', revision: 'c' }]);
  assert.equal(await relateToCandidate('v', 'c', port, 'new-base', null), null);
});

test('a failed git read yields no relation instead of an admission (TASK-2736.2)', async () => {
  const failing = { ...bare, changedPaths: async () => { throw new Error('git failed'); } } satisfies NonNullable<Parameters<typeof relateToCandidate>[2]>;
  assert.equal(await relateToCandidate('v', 'c', failing, 'b', 'main'), null);
});

test('keeps only non-Backlog paths as substantive (TASK-2736.2)', () => {
  assert.deepEqual(substantiveInterdiffPaths(['backlog/tasks/t.md', 'package.json', 'src/a.ts']), ['package.json', 'src/a.ts']);
});

const lock = (root: string, dependency: string) => JSON.stringify({ name: 'p', version: root, packages: { '': { version: root }, 'node_modules/example': { version: dependency } } });
const manifest = (version: string, extra = {}) => JSON.stringify({ name: 'p', version, ...extra });
const withFiles = (files: Record<string, [string, string]>): ReviewEvidencePort => ({ ...bare, changedPaths: async () => Object.keys(files),
  missionInterdiff: async () => ({ diff: '', paths: Object.keys(files) }), source: async (revision, path) => files[path][revision === 'v' ? 0 : 1] });

test('a root version bump in the manifest and lock is rebase-only (TASK-2736.2)', async () => {
  const port = withFiles({ 'package.json': [manifest('1.0.0'), manifest('1.0.1')], 'package-lock.json': [lock('1.0.0', '4.0.0'), lock('1.0.1', '4.0.0')] });
  assert.equal(await relateToCandidate('v', 'c', port, 'b', 'main'), 'rebase-only');
});

test('a dependency whose version collides with the root bump is code-changed (TASK-2736.2)', async () => {
  const port = withFiles({ 'package.json': [manifest('1.0.0'), manifest('1.0.1')], 'package-lock.json': [lock('1.0.0', '1.0.0'), lock('1.0.1', '1.0.1')] });
  assert.equal(await relateToCandidate('v', 'c', port, 'b', 'main'), 'code-changed');
  const dependency = withFiles({ 'package-lock.json': [lock('1.0.0', '4.17.20'), lock('1.0.0', '4.17.21')] });
  assert.equal(await relateToCandidate('v', 'c', dependency, 'b', 'main'), 'code-changed');
  const manifestEdit = withFiles({ 'package.json': [manifest('1.0.0'), manifest('1.0.1', { dependencies: { x: '1' } })] });
  assert.equal(await relateToCandidate('v', 'c', manifestEdit, 'b', 'main'), 'code-changed');
});

test('an unparsable manifest or any other changed file is code-changed (TASK-2736.2)', async () => {
  assert.equal(await relateToCandidate('v', 'c', withFiles({ 'package.json': ['{', '{'] }), 'b', 'main'), 'code-changed');
  assert.equal(await relateToCandidate('v', 'c', withFiles({ 'src/a.ts': ['a', 'b'] }), 'b', 'main'), 'code-changed');
});
