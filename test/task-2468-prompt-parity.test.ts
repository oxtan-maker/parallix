// TASK-2468 prompt parity: the one common draft prompt must render the same
// intake-independent body for both intakes, differing only in the substituted
// intake block (the classification instructions). The adhoc rendering must not
// carry a Backlog task-file instruction, because an adhoc mission has no such
// file — its intent comes from the free-text draft and its labels live in the
// operator database, not a Backlog task.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

import { buildDraftPrompt, resolveClassificationInstructions } from '../src/adapters/cli/commands/draft-prompts.js';

function writeTask(rootDir, slug, body) {
  const tasksDir = path.join(rootDir, 'backlog', 'tasks');
  fs.mkdirSync(tasksDir, { recursive: true });
  const file = path.join(tasksDir, `${slug} - ${slug.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.md`);
  fs.writeFileSync(file, body, 'utf8');
  return file;
}

function backlogTaskPath() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'parallix-bg-'));
  // A real Backlog task: classified, no synthetic marker.
  const file = writeTask(
    root,
    'task-1000',
    ['---', 'id: TASK-1000', 'title: x', 'status: backlog', 'assignee: []', 'labels: [ai_sdlc]', '---', ''].join('\n'),
  );
  return { root, file, cleanup: () => fs.rmSync(root, { recursive: true, force: true }) };
}

function syntheticTaskPath() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'parallix-ah-'));
  // An adhoc draft's synthetic task: source marker present, unknown label.
  const file = writeTask(
    root,
    'adhoc-fix-hello',
    [
      '---',
      'id: ADHOC-FIX-HELLO',
      'title: fix hello',
      'status: backlog',
      'assignee: []',
      'labels: [unknown]',
      'source: synthetic',
      '---',
      '',
    ].join('\n'),
  );
  return { root, file, cleanup: () => fs.rmSync(root, { recursive: true, force: true }) };
}

test('the substituted intake block differs between intakes and names the right authority', () => {
  const bg = backlogTaskPath();
  const ah = syntheticTaskPath();
  try {
    const bgInstructions = resolveClassificationInstructions(bg.file);
    const ahInstructions = resolveClassificationInstructions(ah.file);

    assert.notEqual(bgInstructions, ahInstructions, 'the two intakes must substitute different intake blocks');
    // Backlog intake still targets the Backlog task labels it owns.
    assert.match(bgInstructions, /Backlog task labels/);
    // Adhoc intake must not instruct through a Backlog task file it has no such file for.
    assert.doesNotMatch(ahInstructions, /Backlog task labels/);
  } finally {
    bg.cleanup();
    ah.cleanup();
  }
});

test('the common draft prompt body is intake-independent modulo identity and the intake block', () => {
  const bg = backlogTaskPath();
  const ah = syntheticTaskPath();
  try {
    const bgPrompt = buildDraftPrompt('task-1000', { rootDir: bg.root });
    const ahPrompt = buildDraftPrompt('adhoc-fix-hello', { rootDir: ah.root });
    const bgInstructions = resolveClassificationInstructions(bg.file);
    const ahInstructions = resolveClassificationInstructions(ah.file);

    // Normalize away the per-mission identity (slug + absolute paths) and the
    // substituted intake block, then the instruction bodies must match: the
    // intake difference is confined to that one block.
    const normalize = (prompt, instructions) =>
      prompt
        .replace(instructions, '{{classificationInstructions}}')
        .replace(/\/tmp\/[^\s`]+/g, '<root>')
        .replace(/(?:task-1000|adhoc-fix-hello)/g, '<slug>');
    assert.equal(normalize(ahPrompt, ahInstructions), normalize(bgPrompt, bgInstructions));
    // The adhoc rendering must not instruct through a Backlog task file it has no such file for.
    assert.doesNotMatch(ahInstructions, /Backlog task labels/);
  } finally {
    bg.cleanup();
    ah.cleanup();
  }
});
