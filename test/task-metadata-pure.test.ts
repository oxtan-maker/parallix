// @ts-nocheck -- TASK-2535: branch coverage for the pure `task-metadata.ts`
// helpers. Every function here is pure text/fs surgery on temp task files — no
// spawn, no network, no forgejo, no mock.module — so it runs to completion and
// its coverage is flushed (unlike the ~30 installModuleMocks files that abort
// at import without --experimental-test-module-mocks).
import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import * as tm from '../src/adapters/backlog/task-metadata.js';

function writeTask(body: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tm-'));
  const file = path.join(dir, 'task-1.md');
  fs.writeFileSync(file, body);
  return file;
}

test('getSupportedAgents returns the workflow agent families', () => {
  assert.deepEqual([...tm.getSupportedAgents()].sort(), ['claude', 'codex', 'custom', 'qwen', 'vibe']);
});

test('parseAssigneeFamilies handles inline array, simple inline, and block forms', () => {
  assert.deepEqual(tm.parseAssigneeFamilies('assignee: [codex, claude]\n').families.sort(), ['claude', 'codex']);
  assert.equal(tm.parseAssigneeFamilies('assignee: codex\n').matched, true);
  assert.deepEqual(tm.parseAssigneeFamilies('assignee: codex\n').families, ['codex']);
  const block = tm.parseAssigneeFamilies('assignee:\n  - codex\n  - @claude\n');
  assert.equal(block.matched, true);
  assert.deepEqual(block.families, ['codex', 'claude']);
  assert.deepEqual(tm.parseAssigneeFamilies('no assignee here\n').families, []);
});

test('getTaskAssignee returns the first family or null', () => {
  const f = writeTask('assignee: [codex, claude]\n');
  assert.equal(tm.getTaskAssignee(f), 'codex');
  const f2 = writeTask('id: task-9\n');
  assert.equal(tm.getTaskAssignee(f2), null);
});

test('getTaskImplementer returns the first recognized agent family', () => {
  const f = writeTask('assignee: [human, qwen]\n');
  assert.equal(tm.getTaskImplementer(f), 'qwen');
  const f2 = writeTask('assignee: [human]\n');
  assert.equal(tm.getTaskImplementer(f2), null);
});

test('parseTaskLabels handles block and inline label formats', () => {
  assert.deepEqual(tm.parseTaskLabels('labels:\n  - ai_sdlc\n  - bug\n').sort(), ['ai_sdlc', 'bug']);
  assert.deepEqual(tm.parseTaskLabels('labels: [user_value, bug]\n'), ['user_value', 'bug']);
  assert.deepEqual(tm.parseTaskLabels('no labels\n'), []);
});

test('classificationFromLabels returns the single mission classification or null', () => {
  assert.equal(tm.classificationFromLabels(['ai_sdlc']), 'ai_sdlc');
  assert.equal(tm.classificationFromLabels(['ai_sdlc', 'user_value']), null);
  assert.equal(tm.classificationFromLabels(['bug']), null);
});

test('getTaskClassification and hasBugLabel read frontmatter labels', () => {
  const f = writeTask('labels:\n  - ai_sdlc\n  - bug\n');
  assert.equal(tm.getTaskClassification(f), 'ai_sdlc');
  assert.equal(tm.hasBugLabel(f), true);
  const f2 = writeTask('labels:\n  - ai_sdlc\n');
  assert.equal(tm.hasBugLabel(f2), false);
});

test('setTaskLabels replaces an existing inline labels field', () => {
  const f = writeTask('id: task-1\nlabels: [user_value]\n');
  assert.equal(tm.setTaskLabels(f, ['ai_sdlc', 'bug']), true);
  assert.match(fs.readFileSync(f, 'utf8'), /labels: \[ai_sdlc, bug\]/);
});

test('setTaskLabels replaces an existing block labels field preserving style', () => {
  const f = writeTask('id: task-1\nlabels:\n  - user_value\n');
  assert.equal(tm.setTaskLabels(f, ['ai_sdlc']), true);
  const out = fs.readFileSync(f, 'utf8');
  assert.match(out, /labels:\n  - ai_sdlc/);
  assert.doesNotMatch(out, /user_value/);
});

test('setTaskLabels inserts after created_date when no labels field exists', () => {
  const f = writeTask('id: task-1\ncreated_date: 2024-01-01\n');
  assert.equal(tm.setTaskLabels(f, ['ai_sdlc']), true);
  assert.match(fs.readFileSync(f, 'utf8'), /created_date: 2024-01-01\nlabels: \[ai_sdlc\]/);
});

test('setTaskLabels inserts after id when neither labels nor created_date exist', () => {
  const f = writeTask('id: task-1\n');
  assert.equal(tm.setTaskLabels(f, ['ai_sdlc']), true);
  assert.match(fs.readFileSync(f, 'utf8'), /id: task-1\nlabels: \[ai_sdlc\]/);
});

test('setTaskLabels returns false when there is no labels field and no id field', () => {
  const f = writeTask('title: no id here\n');
  assert.equal(tm.setTaskLabels(f, ['ai_sdlc']), false);
});

test('setTaskAssignee promotes an existing agent to the front of an inline list', () => {
  const f = writeTask('id: task-1\nassignee: [claude, codex]\n');
  assert.equal(tm.setTaskAssignee(f, 'codex'), true);
  assert.match(fs.readFileSync(f, 'utf8'), /assignee: \[codex, claude\]/);
});

test('setTaskAssignee returns false when the agent is already authoritative (index 0)', () => {
  const f = writeTask('id: task-1\nassignee: [codex, claude]\n');
  assert.equal(tm.setTaskAssignee(f, 'codex'), false);
});

test('setTaskAssignee demotes (does not promote) when promote=false', () => {
  const f = writeTask('id: task-1\nassignee: [claude, codex]\n');
  assert.equal(tm.setTaskAssignee(f, 'codex', { promote: false }), false);
  assert.match(fs.readFileSync(f, 'utf8'), /assignee: \[claude, codex\]/);
});

test('setTaskAssignee inserts a new assignee after the id line when none exists', () => {
  const f = writeTask('id: task-1\n');
  assert.equal(tm.setTaskAssignee(f, 'codex'), true);
  assert.match(fs.readFileSync(f, 'utf8'), /id: task-1\nassignee: \[codex\]/);
});

test('setTaskAssignee converts a block assignee to a normalized inline array', () => {
  const f = writeTask('id: task-1\nassignee:\n  - claude\n');
  assert.equal(tm.setTaskAssignee(f, 'codex'), true);
  assert.match(fs.readFileSync(f, 'utf8'), /assignee: \[codex, claude\]/);
});

test('setTaskImplementer makes the new implementer authoritative and preserves humans', () => {
  const f = writeTask('id: task-1\nassignee: [human]\n');
  assert.equal(tm.setTaskImplementer(f, 'codex'), true);
  assert.match(fs.readFileSync(f, 'utf8'), /assignee: \[codex, human\]/);
  assert.equal(tm.getTaskImplementer(f), 'codex');
});

test('setTaskImplementer is a no-op when the requested agent is already first and identical', () => {
  const f = writeTask('id: task-1\nassignee: [codex, human]\n');
  assert.equal(tm.setTaskImplementer(f, 'codex'), false);
});

test('clearTaskAgentAssignee removes agent families and preserves human assignees inline', () => {
  const f = writeTask('id: task-1\nassignee: [codex, human]\n');
  assert.equal(tm.clearTaskAgentAssignee(f), true);
  const out = fs.readFileSync(f, 'utf8');
  assert.doesNotMatch(out, /codex/);
  assert.match(out, /human/);
});

test('clearTaskAgentAssignee returns false when all families are human (no change needed)', () => {
  const f = writeTask('id: task-1\nassignee: [human]\n');
  assert.equal(tm.clearTaskAgentAssignee(f), false);
});

test('clearTaskAgentAssignee returns false when there is no assignee field', () => {
  const f = writeTask('id: task-1\n');
  assert.equal(tm.clearTaskAgentAssignee(f), false);
});

test('clearTaskAgentAssignee handles block form by dropping agent lines and keeping human lines', () => {
  const f = writeTask('id: task-1\nassignee:\n  - codex\n  - human\n');
  assert.equal(tm.clearTaskAgentAssignee(f), true);
  const out = fs.readFileSync(f, 'utf8');
  assert.doesNotMatch(out, /codex/);
  assert.match(out, /- human/);
});

test('clearTaskAgentAssignee collapses to an empty assignee when all families are agents', () => {
  const f = writeTask('id: task-1\nassignee:\n  - codex\n  - claude\n');
  assert.equal(tm.clearTaskAgentAssignee(f), true);
  assert.match(fs.readFileSync(f, 'utf8'), /assignee: \[\]/);
});

test('enforceTaskAssignee is a no-op when the assignee already matches exactly', () => {
  const f = writeTask('id: task-1\nassignee: [codex]\n');
  assert.equal(tm.enforceTaskAssignee(f, 'codex'), true);
});

test('enforceTaskAssignee rewrites an inline assignee to the single-agent form', () => {
  const f = writeTask('id: task-1\nassignee: [claude, human]\n');
  assert.equal(tm.enforceTaskAssignee(f, 'codex'), true);
  assert.match(fs.readFileSync(f, 'utf8'), /assignee: \[codex\]/);
});

test('enforceTaskAssignee rewrites a block assignee to the single-agent inline form', () => {
  const f = writeTask('id: task-1\nassignee:\n  - claude\n');
  assert.equal(tm.enforceTaskAssignee(f, 'codex'), true);
  assert.match(fs.readFileSync(f, 'utf8'), /assignee: \[codex\]/);
});

test('enforceTaskAssignee inserts after id when no assignee line exists', () => {
  const f = writeTask('id: task-1\n');
  assert.equal(tm.enforceTaskAssignee(f, 'codex'), true);
  assert.match(fs.readFileSync(f, 'utf8'), /id: task-1\nassignee: \[codex\]/);
});

test('getters tolerate a missing file path', () => {
  assert.equal(tm.getTaskAssignee('/nonexistent/task.md'), null);
  assert.equal(tm.getTaskImplementer('/nonexistent/task.md'), null);
  assert.deepEqual(tm.getTaskLabels('/nonexistent/task.md'), []);
  assert.equal(tm.hasBugLabel('/nonexistent/task.md'), false);
  assert.equal(tm.setTaskLabels('/nonexistent/task.md', ['ai_sdlc']), false);
  assert.equal(tm.setTaskAssignee('/nonexistent/task.md', 'codex'), false);
  assert.equal(tm.clearTaskAgentAssignee('/nonexistent/task.md'), false);
});
