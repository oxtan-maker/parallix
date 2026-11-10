// task-2624: drafting `task-2623.04` silently resolved the existing TASK-2623
// through the base-id fallback and created a duplicate mission with the wrong
// scope. An explicit dotted task id must identify that exact task; ad hoc
// drafts keep going through the DB-owned identity allocation path.
import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { createTaskScanCache, resolveTaskFile } from '../../../../../src/adapters/backlog/task-file-io.js';
import { createDraftWorkflowAdapter } from '../../../../../src/adapters/cli/commands/draft-stats.js';
import { resolveDraftTarget } from '../../../../../src/adapters/cli/commands/draft-setup.js';
import { isDbOwnedPxIdentity, isMissionSlugCandidate, isPxIdentityReference, missionId } from '../../../../../src/domain/mission.js';
import { mkdtemp } from '../../../../helpers/temp-dir.js';

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) { fs.rmSync(root, { recursive: true, force: true }); }
});

function seedBacklog(files: Record<string, string>): string {
  const root = fs.realpathSync(mkdtemp('parallix-task-2624-'));
  roots.push(root);
  const tasksDir = path.join(root, 'backlog', 'tasks');
  fs.mkdirSync(tasksDir, { recursive: true });
  for (const [name, id] of Object.entries(files)) {
    fs.writeFileSync(path.join(tasksDir, name), `---\nid: ${id}\ntitle: ${name}\nstatus: backlog\n---\n`);
  }
  return root;
}

async function draftPreflight(root: string, input: string, stored?: { waveParentId?: string }, storeKind: 'found' | 'missing' | 'unavailable' = 'found') {
  const errors: string[] = [];
  const logs: string[] = [];
  const exits: number[] = [];
  const sideEffects: string[] = [];
  const adapter = createDraftWorkflowAdapter({
    exitFn: (code?: number) => { exits.push(code ?? 0); },
    logFn: (msg: string) => { logs.push(String(msg)); },
    errorFn: (msg: string) => { errors.push(msg); },
    cwdFn: () => root,
    resolveMainRepoFn: () => root,
    ensureRepoExistsFn: () => true,
    ensureStandaloneMissionBaselineFn: () => ({ committed: false }),
    ensureDraftRepoConfigCommittedFn: () => true,
    detectLaunchBaseBranchFn: () => null,
    allocateAdhocIdentityFn: () => {
      sideEffects.push('allocate');
      return { slug: 'px-0042', taskId: 'PX-0042' };
    },
    missionServicesFn: async () => ({
      store: {
        load: async () => storeKind === 'found'
          ? { kind: 'found', mission: { id: input, waveParentId: stored?.waveParentId ?? null } }
          : { kind: storeKind, reason: 'operator store unavailable' },
      },
    } as never),
  });
  const ctx = await adapter.preflight([input], {});
  return { ctx, errors: errors.join('\n'), logs: logs.join('\n'), exits, sideEffects };
}

test('explicit dotted task id with no task file is missing, not the base task', () => {
  const root = seedBacklog({ 'task-2623 - Base task.md': 'TASK-2623' });

  const result = resolveTaskFile('task-2623.04', root);

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'missing');
  assert.equal(result.taskFile, undefined);
});

test('existing dotted task id still resolves exactly', () => {
  const root = seedBacklog({
    'task-2623 - Base task.md': 'TASK-2623',
    'task-2623.05 - Subtask.md': 'TASK-2623.05',
  });

  const result = resolveTaskFile('task-2623.05', root);

  assert.equal(result.ok, true);
  assert.equal(path.basename(result.taskFile || ''), 'task-2623.05 - Subtask.md');
});

test('hyphenated suffixed slug keeps the base-id fallback', () => {
  const root = seedBacklog({ 'task-2623 - Base task.md': 'TASK-2623' });

  const result = resolveTaskFile('task-2623-legacy', root);

  assert.equal(result.ok, true);
  assert.equal(path.basename(result.taskFile || ''), 'task-2623 - Base task.md');
});

test('draft preflight rejects a nonexistent dotted task id before setup and names it', async () => {
  const root = seedBacklog({ 'task-2623 - Base task.md': 'TASK-2623' });

  const { ctx, errors, exits, sideEffects } = await draftPreflight(root, 'task-2623.04');

  assert.equal(ctx.exited, true);
  assert.deepEqual(exits, [1]);
  assert.match(errors, /task-2623\.04 not found/);
  assert.deepEqual(sideEffects, [], 'an explicit task id never allocates an ad hoc identity');
});

test('ad hoc drafts still allocate a DB-owned identity and resume by that identity', async () => {
  const freeText = await draftPreflight(seedBacklog({}), 'Fix the flaky board refresh');
  assert.equal(freeText.ctx.exited, false);
  assert.equal(freeText.ctx.slug, 'px-0042');
  assert.deepEqual(freeText.sideEffects, ['allocate']);

  const dirRoot = seedBacklog({});
  fs.mkdirSync(path.join(dirRoot, 'some-project'));
  assert.equal(resolveDraftTarget('some-project', dirRoot)?.syntheticTask?.source, 'synthetic-directory');
  const directory = await draftPreflight(dirRoot, path.join(dirRoot, 'some-project'));
  assert.equal(directory.ctx.exited, false);
  assert.deepEqual(directory.sideEffects, ['allocate']);

  const explicitAdhoc = await draftPreflight(seedBacklog({}), 'adhoc-cleanup-logs');
  assert.equal(explicitAdhoc.ctx.exited, false);
  assert.deepEqual(explicitAdhoc.sideEffects, ['allocate']);

  const resumeRoot = seedBacklog({ 'px-0007 - Existing.md': 'PX-0007' });
  const resumed = await draftPreflight(resumeRoot, 'px-0007');
  assert.equal(resumed.ctx.exited, false);
  assert.equal(resumed.ctx.slug, 'px-0007');
  assert.deepEqual(resumed.sideEffects, [], 'resuming reuses the minted identity');
});

// PX-0045: `px-0041.01` is a persisted wave child minted by `split`. An
// explicit reference to it must stay that exact identity; the undotted-only
// predicates used to classify it as free text, so preflight minted a fresh
// counter identity (px-0043/px-0044) and drafted the wrong Mission.
test('an explicit px wave child keeps its exact identity in draft target resolution (PX-0045)', () => {
  const target = resolveDraftTarget('px-0041.01');

  assert.equal(target?.slug, 'px-0041.01');
  assert.equal(target?.syntheticTask, null, 'a stored child never carries a synthetic Backlog task');
  assert.equal(target?.existingDbOwnedIdentity, true, 'a stored child is an existing DB-owned identity reference');
});

test('draft preflight drafts a persisted px wave child under its exact id and never allocates (PX-0045)', async () => {
  const root = seedBacklog({});

  const { ctx, errors, exits, sideEffects } = await draftPreflight(root, 'px-0041.01', { waveParentId: 'px-0041' });

  assert.equal(ctx.exited, false, errors);
  assert.deepEqual(exits, []);
  assert.equal(ctx.slug, 'px-0041.01');
  assert.equal(ctx.dbOwned, true, 'a persisted wave child is DB-authoritative and needs no Backlog mirror');
  assert.equal(ctx.syntheticTask, null);
  assert.deepEqual(sideEffects, [], 'drafting a stored child never consumes the ad hoc counter');
});

// PX-0045: syntax and stored existence stay separate decisions. A well-formed
// child reference with no stored aggregate is an unknown identity, not free
// text, so it fails closed instead of minting a counter identity.
test('draft preflight rejects an unknown px wave child without allocating (PX-0045)', async () => {
  const root = seedBacklog({});

  const { ctx, errors, logs, exits, sideEffects } = await draftPreflight(root, 'px-0041.99', undefined, 'missing');

  assert.equal(ctx.exited, true);
  assert.deepEqual(exits, [1]);
  assert.match(errors, /px-0041\.99/);
  assert.match(logs, /Repair:/);
  assert.deepEqual(sideEffects, [], 'an unknown px child never allocates');
});

// PX-0045: a malformed child reference must not fall through to free-text
// intake (which mints an unrelated counter identity) nor to worktree inference
// (which drafts the Mission of the current directory).
test('draft preflight rejects malformed px child references without allocating (PX-0045)', async () => {
  // A short parent is a mis-typed child reference, not free text (PX-0045 F1b):
  // falling through would consume the ad hoc counter, the incident failure class.
  // A zero position is refused too: convertMissionToWave numbers children 01-99
  // (PX-0045 round-4 F1).
  for (const malformed of ['px-0041.1', 'px-0041.abc', 'px-0041.01.02', 'px-0041.', 'px-41.01', 'px-041.01', 'px-0041.00']) {
    const root = seedBacklog({});

    const { ctx, errors, logs, exits, sideEffects } = await draftPreflight(root, malformed, { waveParentId: 'px-0041' });

    assert.equal(ctx.exited, true, `${malformed} must not draft`);
    assert.deepEqual(exits, [1], malformed);
    assert.match(errors, /not a Mission identity/, malformed);
    assert.match(logs, /Repair:/, malformed);
    assert.deepEqual(sideEffects, [], `${malformed} never allocates an identity`);
  }
});

// PX-0045: the dotted child grammar is decided once, in the domain owner, so
// every consumer agrees on what a px identity is.
test('the shared identity owner accepts px children and rejects malformed shapes (PX-0045)', () => {
  for (const valid of ['px-0041', 'px-0041.01', 'px-0041.99', 'PX-0041.01']) {
    assert.equal(isDbOwnedPxIdentity(valid), true, valid);
    assert.equal(isMissionSlugCandidate(valid), true, valid);
  }
  for (const lower of ['px-0041', 'px-0041.01']) {
    assert.equal(missionId(lower), lower);
  }
  for (const invalid of ['px-0041.1', 'px-0041.000', 'px-0041.01.02', 'px-0041.', 'px-41.01', 'px-0041.0a', 'px-0041.00']) {
    assert.equal(isDbOwnedPxIdentity(invalid), false, invalid);
    assert.equal(isMissionSlugCandidate(invalid), false, invalid);
  }
  // The reference predicate recognizes the attempt, so an interface can refuse
  // a malformed child instead of treating it as free text.
  for (const attempt of ['px-0041.1', 'px-0041.01.02', 'px-0041.', 'px-41.01', 'px-041.01', 'px-0041.00']) {
    assert.equal(isPxIdentityReference(attempt), true, attempt);
  }
  // Only a single token is a reference attempt; free text that merely starts
  // with a dotted px id keeps its preserved free-text intake (PX-0045 F1a).
  for (const notAReference of ['px-0041', 'task-2623.04', 'px is broken in draft', 'adhoc-px-0041-01', 'px-0041.01 draft crashes on the parent link', 'px-0041. fix retry']) {
    assert.equal(isPxIdentityReference(notAReference), false, notAReference);
  }
});

// PX-0045 review F1a: the malformed-reference boundary must not swallow free
// text. A sentence that merely starts with a dotted px id stays an ad hoc draft
// with a synthetic Backlog task, exactly as on the parent.
test('free text that starts with a dotted px id keeps ad hoc intake (PX-0045)', async () => {
  for (const intent of ['px-0041.01 draft crashes on the parent link', 'px-0041. fix retry']) {
    const target = resolveDraftTarget(intent);
    assert.equal(target?.invalidIdentity, undefined, intent);
    assert.ok(target?.syntheticTask, `${intent} stays a synthetic free-text draft`);

    const { ctx, errors, exits, sideEffects } = await draftPreflight(seedBacklog({}), intent);

    assert.equal(ctx.exited, false, errors);
    assert.deepEqual(exits, [], intent);
    assert.deepEqual(sideEffects, ['allocate'], `${intent} keeps the ad hoc allocation`);
  }
});

test('a shared scan cache resolves every slug exactly as an uncached resolution does (TASK-2681)', () => {
  const root = seedBacklog({
    'task-2623 - Base task.md': 'TASK-2623',
    'renamed-file.md': 'TASK-2700',
    'dup-a.md': 'TASK-2800',
    'dup-b.md': 'TASK-2800',
  });
  const cache = createTaskScanCache();
  const slugs = ['task-2623', 'task-2623.04', 'task-2623-modernized', 'task-2700', 'task-2800', 'task-9999'];
  for (const pass of [1, 2]) {
    for (const slug of slugs) {
      assert.deepEqual(resolveTaskFile(slug, root, cache), resolveTaskFile(slug, root), `${slug} (pass ${pass})`);
    }
  }
});
