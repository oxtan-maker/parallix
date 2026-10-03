import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { getTaskLabels, getTaskClassification, setTaskLabels, } from '../src/adapters/backlog/backlog.js';

async function withTempDir(fn) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'workflow-labels-')));
  try {
    await fn(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

test('setTaskLabels writes inline format correctly', async () => {
  await withTempDir(async (root) => {
    const taskPath = path.join(root, 'inline.md');
    fs.writeFileSync(taskPath, '---\nid: TASK-201\nlabels: [old_label]\n---\n');
    assert.equal(setTaskLabels(taskPath, ['ai_sdlc', 'bug']), true);
    assert.match(fs.readFileSync(taskPath, 'utf8'), /labels: \[ai_sdlc, bug\]/);
  });
});

test('setTaskLabels writes block format correctly', async () => {
  await withTempDir(async (root) => {
    const taskPath = path.join(root, 'block.md');
    fs.writeFileSync(taskPath, '---\nid: TASK-202\nlabels:\n  - old_label\n  - another\n---\n');
    assert.equal(setTaskLabels(taskPath, ['ai_sdlc', 'bug']), true);
    assert.match(fs.readFileSync(taskPath, 'utf8'), /labels:\n  - ai_sdlc\n  - bug\n/);
  });
});

test('setTaskLabels inserts labels after created_date', async () => {
  await withTempDir(async (root) => {
    const taskPath = path.join(root, 'missing.md');
    fs.writeFileSync(taskPath, "---\nid: TASK-203\ncreated_date: '2026-07-25'\ndependencies: []\n---\n");
    assert.equal(setTaskLabels(taskPath, ['ai_sdlc', 'bug']), true);
    const content = fs.readFileSync(taskPath, 'utf8');
    assert.ok(content.indexOf('labels:') > content.indexOf('created_date'));
    assert.match(content, /labels: \[ai_sdlc, bug\]/);
  });
});

test('setTaskLabels and getTaskClassification round-trip', async () => {
  await withTempDir(async (root) => {
    const taskPath = path.join(root, 'roundtrip.md');
    fs.writeFileSync(taskPath, '---\nid: TASK-204\nlabels: []\n---\n');
    setTaskLabels(taskPath, ['ai_sdlc', 'bug']);
    assert.equal(getTaskClassification(taskPath), 'ai_sdlc');
    assert.deepEqual(getTaskLabels(taskPath), ['ai_sdlc', 'bug']);
  });
});
