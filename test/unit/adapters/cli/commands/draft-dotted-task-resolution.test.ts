// task-2624: drafting `task-2623.04` silently resolved the existing TASK-2623
// through the base-id fallback and created a duplicate mission with the wrong
// scope. An explicit dotted task id must identify that exact task; ad hoc
// drafts keep going through the DB-owned identity allocation path.
import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { resolveTaskFile } from '../../../../../src/adapters/backlog/task-file-io.js';
import { createDraftWorkflowAdapter } from '../../../../../src/adapters/cli/commands/draft-stats.js';
import { resolveDraftTarget } from '../../../../../src/adapters/cli/commands/draft-setup.js';
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

function draftPreflight(root: string, input: string) {
  const errors: string[] = [];
  const exits: number[] = [];
  const sideEffects: string[] = [];
  const adapter = createDraftWorkflowAdapter({
    exitFn: (code?: number) => { exits.push(code ?? 0); },
    logFn: () => {},
    errorFn: (msg: string) => { errors.push(msg); },
    cwdFn: () => root,
    resolveMainRepoFn: () => root,
    ensureRepoExistsFn: () => true,
    ensureStandaloneMissionBaselineFn: () => ({ committed: false }),
    ensureDraftRepoConfigCommittedFn: () => true,
    detectLaunchBaseBranchFn: () => null,
    allocateAdhocIdentityFn: () => {
      sideEffects.push('allocate');
      return { slug: 'parallix-adhoc-0042', taskId: 'PARALLIX-ADHOC-0042' };
    },
  });
  const ctx = adapter.preflight([input], {});
  return { ctx, errors: errors.join('\n'), exits, sideEffects };
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

test('draft preflight rejects a nonexistent dotted task id before setup and names it', () => {
  const root = seedBacklog({ 'task-2623 - Base task.md': 'TASK-2623' });

  const { ctx, errors, exits, sideEffects } = draftPreflight(root, 'task-2623.04');

  assert.equal(ctx.exited, true);
  assert.deepEqual(exits, [1]);
  assert.match(errors, /task-2623\.04 not found/);
  assert.deepEqual(sideEffects, [], 'an explicit task id never allocates an ad hoc identity');
});

test('ad hoc drafts still allocate a DB-owned identity and resume by that identity', () => {
  const freeText = draftPreflight(seedBacklog({}), 'Fix the flaky board refresh');
  assert.equal(freeText.ctx.exited, false);
  assert.equal(freeText.ctx.slug, 'parallix-adhoc-0042');
  assert.deepEqual(freeText.sideEffects, ['allocate']);

  const dirRoot = seedBacklog({});
  fs.mkdirSync(path.join(dirRoot, 'some-project'));
  assert.equal(resolveDraftTarget('some-project', dirRoot)?.syntheticTask?.source, 'synthetic-directory');
  const directory = draftPreflight(dirRoot, path.join(dirRoot, 'some-project'));
  assert.equal(directory.ctx.exited, false);
  assert.deepEqual(directory.sideEffects, ['allocate']);

  const explicitAdhoc = draftPreflight(seedBacklog({}), 'adhoc-cleanup-logs');
  assert.equal(explicitAdhoc.ctx.exited, false);
  assert.deepEqual(explicitAdhoc.sideEffects, ['allocate']);

  const resumeRoot = seedBacklog({ 'parallix-adhoc-0007 - Existing.md': 'PARALLIX-ADHOC-0007' });
  const resumed = draftPreflight(resumeRoot, 'parallix-adhoc-0007');
  assert.equal(resumed.ctx.exited, false);
  assert.equal(resumed.ctx.slug, 'parallix-adhoc-0007');
  assert.deepEqual(resumed.sideEffects, [], 'resuming reuses the minted identity');
});
