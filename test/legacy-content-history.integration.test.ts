// Historical regression provenance: task-2521.06.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readLegacyTaskContent } from '../src/adapters/backlog/legacy-task-content.js';
import { readLegacyMissionContent, readLegacyReviewSnapshot } from '../src/adapters/backlog/legacy-mission-content.js';
import type { GitResult } from '../src/adapters/git/git.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';

const commit = 'a'.repeat(40);
const ref = { source: 'backlog-md', id: 'TASK-7', url: `backlog/completed/task-7.md@${commit}` };
const result = (stdout: string): GitResult => ({ status: 0, signal: null, stdout, stderr: '' });

test('task-2521.06: px status can read a pinned legacy task body after its current-tree file is gone', () => {
  const body = '---\nid: TASK-7\n---\n\n## Description\nDurable context.\n';
  const calls: string[][] = [];
  const read = readLegacyTaskContent(ref, '/repo', (args) => {
    calls.push(args);
    return result(body);
  });
  assert.deepEqual(read, { content: body, error: null });
  assert.deepEqual(calls, [['show', `${commit}:backlog/completed/task-7.md`]]);
});

test('task-2521.06: pinned legacy task reads fail closed on an unsafe path or different identity', () => {
  const gitFn = () => result('---\nid: TASK-8\n---\n');
  assert.match(readLegacyTaskContent(ref, '/repo', gitFn).error ?? '', /identity differs/);
  assert.match(readLegacyTaskContent({ ...ref, url: `backlog/tasks/../../secret@${commit}` }, '/repo', gitFn).error ?? '', /Invalid pinned/);
});

test('task-2521.06: committed task archive survives an unreachable import commit', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'task-2521-06-body-'));
  const body = '---\nid: TASK-7\n---\n\nFull historical body.\n';
  const file = path.join(root, 'missions/task-2521.06/artifacts/task-bodies.json');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ entries: [{ id: ref.id, url: ref.url,
    sha256: createHash('sha256').update(body).digest('hex'), content: body,
  }] }));
  const run = (...args: string[]) => execFileSync('git', ['-C', root, ...args]);
  run('init', '-q'); run('add', '.');
  run('-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-qm', 'archive');
  assert.deepEqual(readLegacyTaskContent(ref, root), { content: body, error: null });
  fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('Full historical body', 'Tampered'));
  assert.match(readLegacyTaskContent(ref, root).error ?? '', /differs from the working tree/);
});

test('task-2521.06: historical mission document remains queryable after its source path is removed', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'task-2521-06-mission-doc-'));
  const body = '# Mission: Historical (task-9008)\n\n## Goal\nPreserve context.\n';
  const template = '# Mission: Placeholder (task-9009)\n\n## Goal\n<Goal>\n\n## Why Now\n<Why Now>\n\n## Gates\n- [ ] ./scripts/verify-local.sh docs\n';
  const file = path.join(root, 'missions/task-2521.06/artifacts/mission-documents.json');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ sourceCommit: commit, entries: [{
    file: 'missions/task-9008/MISSION.md', sha256: createHash('sha256').update(body).digest('hex'), content: body,
  }, {
    file: 'missions/task-9009/MISSION.md', sha256: createHash('sha256').update(template).digest('hex'), content: template,
  }] }));
  const run = (...args: string[]) => execFileSync('git', ['-C', root, ...args]);
  run('init', '-q'); run('add', '.');
  run('-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-qm', 'archive');
  assert.deepEqual(readLegacyMissionContent('task-9008', root), { content: body, error: null });
  assert.deepEqual(readLegacyMissionContent('task-9009', root), { content: null, error: null });
  const review = '{"round":1,"phase":"approved"}\n';
  fs.writeFileSync(path.join(path.dirname(file), 'review-state-discrepancies.json'), JSON.stringify({
    sourceCommit: commit, entries: [{ file: 'missions/task-9008/review-state.json',
      sha256: createHash('sha256').update(review).digest('hex'), content: review }],
  }));
  run('add', '.'); run('-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-qm', 'review archive');
  assert.deepEqual(readLegacyReviewSnapshot('task-9008', root), { content: review, error: null });
});
