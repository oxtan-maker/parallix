// TASK-2625: sha-keyed integration-validation marker.
//
// Covers the four success criteria:
//  1. the marker is recorded when the integration suite passes green (recorded by the validation path);
//  2. integrate skips the validated high-level hooks from the whitelist;
//  3. integrate falls back to the full suite when the marker is missing or the validating sha does not cover the current branch;
//  4. the bounce-from-integration-to-active-to-resolved-to-integrate flow skips validated hooks on integrate.
//
// TASK-2646 extends coverage to a finalized commit that moved past the
// validated sha: bookkeeping-only movement (direct or through a rebase) reuses
// the marker; any substantive path or git failure runs the full suite.
//
// No .only, no bare .skip.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  buildIntegrationValidationMarker,
  INTEGRATION_VALIDATION_EVENT_TYPE,
  partitionGatesForSkip,
  parseIntegrationValidationMarker,
  isBookkeepingPath,
  validationSkipApplies,
} from '../../../src/application/integrate/validation-marker.js';
import { listChangedPathsBetween } from '../../../src/adapters/cli/commands/integrate-gates.js';
import { createIntegrationGateStep } from '../../../src/application/integrate/gates.js';
import { routeIntegrationGateFailure } from '../../../src/adapters/cli/commands/integrate-gate-rebound.js';
import { setLogger } from '../../../src/application/presentation/cli-format.js';
import type { OperationalHistoryService } from '../../../src/application/services/operational-history-service.js';
import { openRepairFixture } from '../../lib/integration-repair-fixture.js';
import { SqliteOperationalHistoryRepository } from '../../../src/adapters/sqlite/operational-history-repository.js';

const EVENT = INTEGRATION_VALIDATION_EVENT_TYPE;
const SLUG = 'task-2625';

// ── buildIntegrationValidationMarker ─────────────────────────────────────────

test('buildIntegrationValidationMarker keeps distinct non-empty hooks and rejects an empty whitelist', () => {
  const marker = buildIntegrationValidationMarker(SLUG, 'abc123', ['unit', 'integration-ci', 'unit']);
  assert.deepEqual(marker.hooks, ['unit', 'integration-ci']);
  assert.equal(marker.sha, 'abc123');
  assert.throws(() => buildIntegrationValidationMarker(SLUG, 'abc', []), /at least one validated hook/);
  assert.throws(() => buildIntegrationValidationMarker(SLUG, '', ['unit']), /validating sha/);
  assert.throws(() => buildIntegrationValidationMarker('', 'sha', ['unit']), /mission id/);
});

// ── parseIntegrationValidationMarker ──────────────────────────────────────────

test('parseIntegrationValidationMarker accepts a well-formed marker and rejects every malformed shape', () => {
  const good = parseIntegrationValidationMarker({
    eventType: EVENT,
    eventData: JSON.stringify({ missionId: SLUG, sha: 'deadbeef', hooks: ['unit', 'integration-ci'] }),
  });
  assert.equal(good?.sha, 'deadbeef');
  assert.deepEqual(good?.hooks, ['unit', 'integration-ci']);

  assert.equal(parseIntegrationValidationMarker({ eventType: 'other', eventData: '{}' }), null);
  assert.equal(parseIntegrationValidationMarker({ eventType: EVENT, eventData: 'not json' }), null);
  assert.equal(parseIntegrationValidationMarker({ eventType: EVENT, eventData: JSON.stringify({ sha: 'x', hooks: ['unit'] }) }), null); // no missionId
  assert.equal(parseIntegrationValidationMarker({ eventType: EVENT, eventData: JSON.stringify({ missionId: SLUG, sha: 'x' }) }), null); // no hooks
  assert.equal(parseIntegrationValidationMarker({ eventType: EVENT, eventData: JSON.stringify({ missionId: SLUG, sha: 'x', hooks: [] }) }), null); // empty whitelist
  assert.equal(parseIntegrationValidationMarker(null), null);
});

// ── validationSkipApplies ─────────────────────────────────────────────────────

test('validationSkipApplies is true only when the validating sha still covers the current branch', () => {
  const marker = buildIntegrationValidationMarker(SLUG, 'validating-sha', ['unit', 'integration-ci']);
  assert.equal(validationSkipApplies(marker, 'validating-sha'), true);
  assert.equal(validationSkipApplies(marker, 'moved-sha'), false, 'branch moved -> fallback');
  assert.equal(validationSkipApplies(marker, null), false, 'no current head -> fallback');
  assert.equal(validationSkipApplies(null, 'validating-sha'), false, 'no marker -> fallback');
  // A marker is never built with an empty whitelist (buildIntegrationValidationMarker rejects it),
  // so an empty whitelist also falls back; assert via the guarded predicate directly.
  assert.equal(validationSkipApplies({ missionId: SLUG, sha: 's', hooks: [] } as never, 's'), false, 'empty whitelist -> fallback');
});

// ── partitionGatesForSkip ─────────────────────────────────────────────────────

test('partitionGatesForSkip splits whitelisted (skip) from unvalidated (run) hooks', () => {
  const marker = buildIntegrationValidationMarker(SLUG, 's', ['unit']);
  const { skip, run } = partitionGatesForSkip(['unit', 'integration-ci', 'quality-gate'], marker);
  assert.deepEqual(skip, ['unit']);
  assert.deepEqual(run, ['integration-ci', 'quality-gate']);
});

// ── resolveSkippableGates (the wired skip decision) ───────────────────────────

function markerEntry(sha: string, hooks: string[]) {
  return { eventType: EVENT, eventData: JSON.stringify({ missionId: SLUG, sha, hooks }) };
}

type ChangedPathsResult = { ok: true; paths: string[] } | { ok: false; error: string };

function makeStep(overrides: {
  loadLatest?: () => Promise<unknown> | unknown;
  runPhaseGates?: () => Promise<unknown>;
  changedPaths?: (_from: string, _to: string) => ChangedPathsResult;
} = {}) {
  const recorded: Array<{ missionId: string; sha: string; hooks: string[] }> = [];
  const diffCalls: Array<{ rootDir: string; from: string; to: string }> = [];
  const step = createIntegrationGateStep({
    gates: {
      listChangedPathsBetween: (rootDir: string, from: string, to: string) => {
        diffCalls.push({ rootDir, from, to });
        return overrides.changedPaths ? overrides.changedPaths(from, to) : { ok: false, error: 'no diff seam configured' };
      },
      resolveIntegrationVerificationWorktree: () => '/fw',
      captureFinalIntegrationTree: () => ({ ok: true, rootDir: '/fw', commit: 'final', tree: 't' }),
      loadPhaseGates: () => [{ key: 'unit', command: 'u', order: 1 }, { key: 'integration-ci', command: 'i', order: 2 }],
      loadRequirePreIntegration: () => false,
      runPhaseGates: overrides.runPhaseGates
        ? overrides.runPhaseGates
        : async () => ({ ok: true, skipped: false, gates: [{ key: 'unit' }, { key: 'integration-ci' }], executed: 2 }),
    },
    landing: { createAbort: () => Object.assign(new Error('aborted'), { name: 'IntegrationAbort' }) },
    verification: { formatVerificationCommand: () => 'verify' },
  } as never);
  const operationalHistory = {
    async loadLatestByTypeForMission(type: string, missionId: string) {
      assert.equal(type, EVENT);
      assert.equal(missionId, SLUG);
      return overrides.loadLatest ? overrides.loadLatest() : null;
    },
    async recordIntegrationValidation(marker: { missionId: string; sha: string; hooks: string[] }) {
      recorded.push({ missionId: marker.missionId, sha: marker.sha, hooks: [...marker.hooks] });
    },
  } as unknown as OperationalHistoryService;
  return { step, operationalHistory, recorded, diffCalls };
}

test('resolveSkippableGates runs the full set when no marker exists (SC3 fallback)', async () => {
  const { step, operationalHistory } = makeStep();
  const { gates, skippedAll } = await step.resolveSkippableGates({
    configured: [{ key: 'unit' }, { key: 'integration-ci' }],
    slug: SLUG,
    checkout: '/fw',
    finalizedCommit: 'validating-sha',
    operationalHistory,
    log: () => {},
  });
  assert.equal(skippedAll, false);
  assert.deepEqual(gates.map(gate => gate.key), ['unit', 'integration-ci']);
});

test('resolveSkippableGates runs the full set when the validating sha no longer covers the branch (SC3 fallback)', async () => {
  const { step, operationalHistory } = makeStep({
    loadLatest: () => markerEntry('old-sha', ['unit']),
  });
  const { gates, skippedAll } = await step.resolveSkippableGates({
    configured: [{ key: 'unit' }, { key: 'integration-ci' }],
    slug: SLUG,
    checkout: '/fw',
    finalizedCommit: 'current-sha',
    operationalHistory,
    log: () => {},
  });
  assert.equal(skippedAll, false);
  assert.deepEqual(gates.map(gate => gate.key), ['unit', 'integration-ci']);
});

// ── SC4 end-to-end: validated hooks skipped on integrate, fallback when absent ─

test('integrate skips validated hooks after a green bounce-verify and falls back when the marker is absent or the branch moved (SC4)', async () => {
  const configured = [{ key: 'unit' }, { key: 'integration-ci' }, { key: 'quality-gate' }];
  // (a) prior bounce-verify recorded a marker for the current validating sha -> skip the whitelisted hook
  const withMarker = makeStep({ loadLatest: () => markerEntry('validating-sha', ['unit', 'integration-ci']) });
  const skipped = await withMarker.step.resolveSkippableGates({
    configured, slug: SLUG, checkout: '/fw', finalizedCommit: 'validating-sha', operationalHistory: withMarker.operationalHistory, log: () => {},
  });
  assert.deepEqual(skipped.gates.map(gate => gate.key), ['quality-gate'], 'only the unvalidated hook runs');
  // (b) marker absent -> fall back to the full suite
  const noMarker = makeStep();
  const fallback = await noMarker.step.resolveSkippableGates({
    configured, slug: SLUG, checkout: '/fw', finalizedCommit: 'validating-sha', operationalHistory: noMarker.operationalHistory, log: () => {},
  });
  assert.deepEqual(fallback.gates.map(gate => gate.key), ['unit', 'integration-ci', 'quality-gate']);
  // (c) branch moved past the validating sha -> fall back to the full suite
  const moved = makeStep({ loadLatest: () => markerEntry('moved-past', ['unit']) });
  const movedResult = await moved.step.resolveSkippableGates({
    configured, slug: SLUG, checkout: '/fw', finalizedCommit: 'current-sha', operationalHistory: moved.operationalHistory, log: () => {},
  });
  assert.deepEqual(movedResult.gates.map(gate => gate.key), ['unit', 'integration-ci', 'quality-gate']);
});

test('resolveSkippableGates skips the whitelisted hook when the validating sha still covers the branch (SC2/SC4)', async () => {
  const { step, operationalHistory } = makeStep({
    loadLatest: () => markerEntry('validating-sha', ['unit']),
  });
  const { gates, skippedAll } = await step.resolveSkippableGates({
    configured: [{ key: 'unit' }, { key: 'integration-ci' }],
    slug: SLUG,
    checkout: '/fw',
    finalizedCommit: 'validating-sha',
    operationalHistory,
    log: () => {},
  });
  assert.equal(skippedAll, false);
  assert.deepEqual(gates.map(gate => gate.key), ['integration-ci'], 'only the unvalidated hook runs');
});

test('resolveSkippableGates marks skippedAll when every configured hook is whitelisted', async () => {
  const { step, operationalHistory } = makeStep({
    loadLatest: () => markerEntry('validating-sha', ['unit', 'integration-ci']),
  });
  const result = await step.resolveSkippableGates({
    configured: [{ key: 'unit' }, { key: 'integration-ci' }],
    slug: SLUG,
    checkout: '/fw',
    finalizedCommit: 'validating-sha',
    operationalHistory,
    log: () => {},
  });
  assert.equal(result.skippedAll, true);
  assert.deepEqual(result.gates, []);
});

test('resolveSkippableGates falls back to the full set when the history is unreadable', async () => {
  const { step, operationalHistory } = makeStep({
    loadLatest: async () => { throw new Error('db locked'); },
  });
  const { gates } = await step.resolveSkippableGates({
    configured: [{ key: 'unit' }, { key: 'integration-ci' }],
    slug: SLUG,
    checkout: '/fw',
    finalizedCommit: 'validating-sha',
    operationalHistory,
    log: () => {},
  });
  assert.deepEqual(gates.map(gate => gate.key), ['unit', 'integration-ci']);
});

// ── round-2 F2: the skip keys on the finalized (post-rebase) tree, not the pre-rebase HEAD ─

test('resolveSkippableGates skips only when the finalized tree commit matches the validating sha, else full suite (round-2 F2)', async () => {
  const { step, operationalHistory } = makeStep({
    loadLatest: () => markerEntry('fixsha', ['unit', 'integration-ci']),
  });
  // The gates run against the finalized (post-rebase) tree. When that tree is
  // exactly the validating commit, the whitelisted hooks skip.
  const sameTree = await step.resolveSkippableGates({
    configured: [{ key: 'unit' }, { key: 'integration-ci' }, { key: 'quality-gate' }],
    slug: SLUG, checkout: '/fw', finalizedCommit: 'fixsha', operationalHistory, log: () => {},
  });
  assert.deepEqual(sameTree.gates.map(gate => gate.key), ['quality-gate']);
  // A rebase that changes the integration tree yields a different finalized
  // commit. The skip must NOT apply: the whitelisted hooks ran against the old
  // tree, so the new tree runs the full suite (this is the round-2 F2 bypass).
  const rebasedTree = await step.resolveSkippableGates({
    configured: [{ key: 'unit' }, { key: 'integration-ci' }, { key: 'quality-gate' }],
    slug: SLUG, checkout: '/fw', finalizedCommit: 'rebased-fixsha', operationalHistory, log: () => {},
  });
  assert.deepEqual(rebasedTree.gates.map(gate => gate.key), ['unit', 'integration-ci', 'quality-gate'], 'rebase-changed tree runs the full suite');
});

// ── TASK-2646: bookkeeping-only movement past the validated sha ─────────────

const TASK_FILE = 'backlog/tasks/task-9001 - Example-task.md';
const VALIDATED_SHA = 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678';
const FINALIZED_SHA = 'f0e1d2c3b4a5968778695a4b3c2d1e0f98765432';

test('a finalized commit advanced only by a backlog task-file commit skips the validated hooks and logs the validated sha (TASK-2646 SC1/SC2)', async () => {
  const { step, operationalHistory, diffCalls } = makeStep({
    loadLatest: () => markerEntry(VALIDATED_SHA, ['unit', 'integration-ci']),
    changedPaths: () => ({ ok: true, paths: [TASK_FILE] }),
  });
  const logs: string[] = [];
  const result = await step.resolveSkippableGates({
    configured: [{ key: 'unit' }, { key: 'integration-ci' }, { key: 'quality-gate' }],
    slug: SLUG,
    checkout: '/fw',
    finalizedCommit: FINALIZED_SHA,
    operationalHistory,
    log: message => logs.push(message),
  });
  assert.deepEqual(result.gates.map(gate => gate.key), ['quality-gate'], 'only the unvalidated hook runs');
  assert.deepEqual(diffCalls, [{ rootDir: '/fw', from: VALIDATED_SHA, to: FINALIZED_SHA }]);
  assert.equal(logs.length, 1);
  assert.ok(logs[0].includes(`validated at ${VALIDATED_SHA.slice(0, 12)}`), 'names the validated sha');
  assert.match(logs[0], /unit, integration-ci/, 'names the skipped hooks');
});

test('isBookkeepingPath accepts only Backlog task records and validationSkipApplies rejects any other diff (TASK-2646 SC3)', () => {
  for (const bookkeeping of [TASK_FILE, 'backlog/completed/task-9001 - Example-task.md']) {
    assert.equal(isBookkeepingPath(bookkeeping), true, bookkeeping);
  }
  for (const substantive of ['src/a.ts', 'test/a.test.ts', 'config/integration-pipelines.json', 'workflow.config.json', 'package.json',
    'backlog/config.yml', 'backlog/docs/note.md', 'backlog/tasks/nested/task.md', 'backlog/tasks/task-1.txt', 'docs/backlog/tasks/x.md']) {
    assert.equal(isBookkeepingPath(substantive), false, substantive);
  }
  const marker = buildIntegrationValidationMarker(SLUG, VALIDATED_SHA, ['unit']);
  assert.equal(validationSkipApplies(marker, FINALIZED_SHA, { ok: true, paths: [TASK_FILE] }), true, 'bookkeeping only');
  assert.equal(validationSkipApplies(marker, FINALIZED_SHA, { ok: true, paths: [] }), true, 'identical tree');
  assert.equal(validationSkipApplies(marker, FINALIZED_SHA, { ok: true, paths: [TASK_FILE, 'src/a.ts'] }), false, 'mixed diff');
  assert.equal(validationSkipApplies(marker, FINALIZED_SHA, { ok: false, error: 'bad object' }), false, 'git failure');
  assert.equal(validationSkipApplies(marker, FINALIZED_SHA), false, 'no diff evidence');
});

test('any non-bookkeeping path in the validated-to-finalized diff selects the full configured suite (TASK-2646 SC3)', async () => {
  const configured = [{ key: 'unit' }, { key: 'integration-ci' }];
  for (const substantive of ['src/application/integrate/gates.ts', 'test/a.test.ts', 'config/integration-pipelines.json', 'workflow.config.json']) {
    const { step, operationalHistory } = makeStep({
      loadLatest: () => markerEntry(VALIDATED_SHA, ['unit', 'integration-ci']),
      changedPaths: () => ({ ok: true, paths: [TASK_FILE, substantive] }),
    });
    const logs: string[] = [];
    const result = await step.resolveSkippableGates({
      configured, slug: SLUG, checkout: '/fw', finalizedCommit: FINALIZED_SHA, operationalHistory, log: message => logs.push(message),
    });
    assert.deepEqual(result.gates.map(gate => gate.key), ['unit', 'integration-ci'], substantive);
    assert.deepEqual(logs, [], `${substantive}: nothing reported as skipped`);
  }
});

test('missing history, an unreachable marker sha, and every git-diff failure fall back to the full suite (TASK-2646 SC5)', async () => {
  const configured = [{ key: 'unit' }, { key: 'integration-ci' }];
  const marker = () => markerEntry(VALIDATED_SHA, ['unit', 'integration-ci']);
  const cases: Array<[string, Parameters<typeof makeStep>[0], boolean]> = [
    ['no marker row', { changedPaths: () => ({ ok: true, paths: [TASK_FILE] }) }, true],
    ['unreadable history', { loadLatest: async () => { throw new Error('db locked'); }, changedPaths: () => ({ ok: true, paths: [TASK_FILE] }) }, true],
    ['malformed marker row', { loadLatest: () => ({ eventType: EVENT, eventData: '{' }), changedPaths: () => ({ ok: true, paths: [TASK_FILE] }) }, true],
    ['unreachable marker sha', { loadLatest: marker, changedPaths: () => ({ ok: false, error: `fatal: bad object ${VALIDATED_SHA}` }) }, true],
    ['git diff throws', { loadLatest: marker, changedPaths: () => { throw new Error('spawn git ENOENT'); } }, true],
  ];
  for (const [label, overrides] of cases) {
    const { step, operationalHistory } = makeStep(overrides);
    const result = await step.resolveSkippableGates({
      configured, slug: SLUG, checkout: '/fw', finalizedCommit: FINALIZED_SHA, operationalHistory, log: () => {},
    });
    assert.deepEqual(result.gates.map(gate => gate.key), ['unit', 'integration-ci'], label);
  }
  const { step } = makeStep({ loadLatest: marker, changedPaths: () => ({ ok: true, paths: [TASK_FILE] }) });
  const noStore = await step.resolveSkippableGates({
    configured, slug: SLUG, checkout: '/fw', finalizedCommit: FINALIZED_SHA, operationalHistory: null, log: () => {},
  });
  assert.deepEqual(noStore.gates.map(gate => gate.key), ['unit', 'integration-ci'], 'history store unavailable');
});

// ── TASK-2646: real git movement through the gates-port adapter ──────────────

/**
 * A throwaway repository with hermetic git config (no user/system config,
 * hooks, signing, or auto-gc) so each case spends its CPU budget only on the
 * git operations it asserts on.
 */
function openGitRepo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'px-validation-skip-'));
  const env = {
    ...process.env,
    GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: os.devNull,
    GIT_CONFIG_COUNT: '2', GIT_CONFIG_KEY_0: 'commit.gpgsign', GIT_CONFIG_VALUE_0: 'false', GIT_CONFIG_KEY_1: 'gc.auto', GIT_CONFIG_VALUE_1: '0',
    GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@example.invalid', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@example.invalid',
  };
  const git = (...args: string[]) => execFileSync('git', ['-C', root, ...args], { env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  const head = () => git('rev-parse', 'HEAD');
  const commit = (files: Record<string, string>, message: string) => {
    for (const [file, content] of Object.entries(files)) {
      fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
      fs.writeFileSync(path.join(root, file), content);
    }
    git('add', '-A');
    git('commit', '-q', '--no-verify', '-m', message);
  };
  git('init', '-q', '-b', 'main');
  commit({ 'src/a.ts': 'export const a = 1;\n', [TASK_FILE]: 'status: active\n' }, 'base');
  return { root, git, head, commit, close: () => fs.rmSync(root, { recursive: true, force: true }) };
}

/** Rebase the mission branch onto main and resolve the gates against the post-rebase HEAD. */
async function resolveAfterRebase(repo: ReturnType<typeof openGitRepo>, validatedSha: string) {
  repo.git('rebase', '-q', 'main', 'mission');
  const finalized = repo.head();
  const { step, operationalHistory } = makeStep({
    loadLatest: () => markerEntry(validatedSha, ['unit', 'integration-ci']),
    changedPaths: (from, to) => listChangedPathsBetween(repo.root, from, to),
  });
  const result = await step.resolveSkippableGates({
    configured: [{ key: 'unit' }, { key: 'integration-ci' }], slug: SLUG, checkout: repo.root, finalizedCommit: finalized, operationalHistory, log: () => {},
  });
  return { finalized, keys: result.gates.map(gate => gate.key) };
}

test('listChangedPathsBetween reports moved task records and fails open for unreachable or malformed commits (TASK-2646 SC2/SC5)', () => {
  const repo = openGitRepo();
  try {
    const validated = repo.head();
    fs.mkdirSync(path.join(repo.root, 'backlog/completed'), { recursive: true });
    repo.git('mv', TASK_FILE, 'backlog/completed/task-9001 - Example-task.md');
    repo.commit({}, 'backlog(task-9001): transition to done');
    const moved = repo.head();
    const diff = listChangedPathsBetween(repo.root, validated, moved);
    assert.equal(diff.ok, true);
    assert.deepEqual(diff.ok && [...diff.paths].sort(), ['backlog/completed/task-9001 - Example-task.md', TASK_FILE]);
    assert.equal(listChangedPathsBetween(repo.root, 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef', moved).ok, false, 'unreachable marker sha');
    assert.equal(listChangedPathsBetween(repo.root, '--output=/tmp/x', moved).ok, false, 'malformed id never reaches git');
  } finally { repo.close(); }
});

test('a post-rebase finalized commit reuses validation when main moved only by bookkeeping (TASK-2646 SC4)', async () => {
  const repo = openGitRepo();
  try {
    repo.git('checkout', '-q', '-b', 'mission');
    repo.commit({ 'src/a.ts': 'export const a = 2;\n' }, 'fix');
    const validated = repo.head();
    repo.git('checkout', '-q', 'main');
    repo.commit({ 'backlog/tasks/task-9002 - Other.md': 'status: review\n' }, 'backlog(task-9002): transition to review');
    const { finalized, keys } = await resolveAfterRebase(repo, validated);
    assert.notEqual(finalized, validated, 'rebase moved the commit');
    assert.deepEqual(keys, [], 'every validated hook is skipped');
  } finally { repo.close(); }
});

test('a post-rebase finalized commit runs the full suite when main brought a non-bookkeeping change (TASK-2646 SC4)', async () => {
  const repo = openGitRepo();
  try {
    repo.git('checkout', '-q', '-b', 'mission');
    repo.commit({ 'src/a.ts': 'export const a = 2;\n' }, 'fix');
    const validated = repo.head();
    repo.git('checkout', '-q', 'main');
    repo.commit({ 'backlog/tasks/task-9002 - Other.md': 'status: review\n', 'src/b.ts': 'export const b = 1;\n' }, 'feat: other mission');
    const { finalized, keys } = await resolveAfterRebase(repo, validated);
    assert.notEqual(finalized, validated);
    assert.deepEqual(keys, ['unit', 'integration-ci'], 'full configured suite');
  } finally { repo.close(); }
});

// ── SC1: the rebound green-validation path persists the skip marker ──────────

test('rebound verify rerun green records the skip marker keyed on the fix commit (SC1)', async () => {
  let recorded: { missionId: string; sha: string; hooks: string[] } | null = null;
  const route = await routeIntegrationGateFailure({
    slug: SLUG,
    missionWorktree: '/fw',
    failedGate: { key: 'integration-ci', command: 'int', exitCode: 1, stdout: '', stderr: '' },
    gates: [{ key: 'unit', command: 'u' }, { key: 'integration-ci', command: 'i' }],
    implementer: 'custom',
    repositoryId: 'unknown',
    // The kernel bounces the mission active, the implementer fixes, and the
    // verify seam re-runs the identical gate set green. Replaying context.verify()
    // drives the real verify seam (my injected runPhaseGatesFn + captureFinalTreeFn)
    // so the marker is recorded, then report the bounce fixed.
    runPhaseGatesFn: async () => ({ ok: true }),
    captureFinalTreeFn: () => ({ ok: true, rootDir: '/fw', commit: 'fixsha123', tree: 't' }),
    reboundFn: async (_reason, ctx) => { await (ctx as { verify: () => Promise<unknown> }).verify(); return { attempts: 1, outcome: 'fixed' }; },
    startAgent: async () => ({ status: 'completed' }),
    transitionTaskFn: async () => true,
    recordIntegrationValidationFn: async (input) => {
      recorded = { missionId: input.missionId, sha: input.sha, hooks: [...input.hooks] };
    },
  } as never);
  assert.equal(route.route, 'fixed', 'routing reports the bounce fixed');
  assert.ok(recorded, 'the rebound green-validation path persisted the skip marker');
  assert.equal(recorded!.missionId, SLUG);
  assert.equal(recorded!.sha, 'fixsha123', 'keyed on the fix commit, not the pre-rebase head');
  assert.deepEqual(recorded!.hooks.sort(), ['integration-ci', 'unit'], 'every validated hook is whitelisted');
});

test('rebound verify rerun green with no recording store leaves the full suite to run next time', async () => {
  const route = await routeIntegrationGateFailure({
    slug: SLUG,
    missionWorktree: '/fw',
    failedGate: { key: 'integration-ci', command: 'int', exitCode: 1, stdout: '', stderr: '' },
    gates: [{ key: 'unit', command: 'u' }, { key: 'integration-ci', command: 'i' }],
    implementer: 'custom',
    repositoryId: 'unknown',
    runPhaseGatesFn: async () => ({ ok: true }),
    captureFinalTreeFn: () => ({ ok: true, rootDir: '/fw', commit: 'fixsha123', tree: 't' }),
    // Replaying verify drives the real seam; with no recordIntegrationValidationFn
    // injected the seam short-circuits the record, so an unavailable store is inert.
    reboundFn: async (_reason, ctx) => { await (ctx as { verify: () => Promise<unknown> }).verify(); return { attempts: 1, outcome: 'fixed' }; },
  } as never);
  assert.equal(route.route, 'fixed');
});

// ── durable round-trip through the real operational_history table (SC1) ───────

test('the integration-validation marker persists and reads back through the real SQLite operational_history table', async () => {
  const fixture = await openRepairFixture({ slug: 'task-2625-durable' });
  try {
    const repo = new SqliteOperationalHistoryRepository(fixture.database);
    await repo.append({
      eventType: EVENT,
      eventData: JSON.stringify({ missionId: fixture.slug, sha: fixture.approvedRevision, hooks: ['unit', 'integration-ci'] }),
      createdAt: new Date().toISOString(),
    });
    const entries = await repo.findByTypeForMission!(EVENT, fixture.slug);
    assert.equal(entries.length, 1, 'exactly one marker row for the mission');
    const marker = parseIntegrationValidationMarker(entries[0]);
    assert.equal(marker?.sha, fixture.approvedRevision, 'marker reads back the validating sha');
    assert.deepEqual(marker?.hooks, ['unit', 'integration-ci']);
    assert.equal(validationSkipApplies(marker, fixture.approvedRevision), true, 'current branch covers the validating sha');
    assert.equal(validationSkipApplies(marker, 'unrelated-sha'), false, 'a moved branch falls back to the full suite');
  } finally {
    await fixture.close();
  }
});

test('runRequiredLocalGates does not record when the suite fails', async () => {
  const { step, operationalHistory, recorded } = makeStep({
    runPhaseGates: async () => ({ ok: false, skipped: false, failedGate: { key: 'unit' }, error: 'red' }),
  });
  const previous = setLogger({ log: () => {}, error: () => {} });
  try {
    await assert.rejects(
      step.runRequiredLocalGates({
        slug: SLUG,
        context: { missionHeadSha: 'validating-sha', baseWorktree: '/fw', area: 'all', branch: `mission/${SLUG}` },
        missionLoad: { kind: 'found', mission: { status: 'integration', review: null } },
        missionServices: { operationalHistory },
        dryRun: false,
        noIntegrationGates: false,
        realAgent: null,
        realAgentModel: null,
        seams: {
          transitionTaskFn: async () => true,
          startAgentFn: async () => { throw new Error('no launch'); },
          applyAgentFallbackFn: async () => 'custom',
          routeIntegrationGateFailureFn: async () => Object.assign(new Error('red gate'), { name: 'IntegrationAbort' }),
        } as never,
      }),
      (error: Error) => error.name === 'IntegrationAbort',
    );
    assert.equal(recorded.length, 0, 'no marker recorded on a red suite');
  } finally { setLogger(previous); }
});
