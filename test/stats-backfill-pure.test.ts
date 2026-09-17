// @ts-nocheck -- TASK-2535: partial test doubles for the stats-backfill pure
// exports (extractDateOnly + inferHistoricalClassificationFromMissionDoc).
// Mirrors the established mockModule/@ts-nocheck pattern in test/stats-backfill.test.ts.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { extractDateOnly, inferHistoricalClassificationFromMissionDoc } from '../src/adapters/cli/commands/stats-backfill.js';

function writeMission(rootDir: string, slug: string, body: string) {
  const year = '2024';
  const missionDir = path.join(rootDir, 'docs', 'missions', year, slug);
  fs.mkdirSync(missionDir, { recursive: true });
  fs.writeFileSync(path.join(missionDir, 'MISSION.md'), body);
  fs.writeFileSync(path.join(missionDir, 'CP-1.md'), '# cp1');
  return missionDir;
}

test('extractDateOnly parses an ISO date prefix', () => {
  assert.equal(extractDateOnly('2024-03-01'), '2024-03-01');
  assert.equal(extractDateOnly('2024-03-01T12:00:00Z'), '2024-03-01');
});

test('extractDateOnly returns null for non-matching or nullish input', () => {
  assert.equal(extractDateOnly('not a date'), null);
  assert.equal(extractDateOnly(''), null);
  assert.equal(extractDateOnly(null), null);
  assert.equal(extractDateOnly(undefined), null);
});

test('inferHistoricalClassificationFromMissionDoc scores workflow-heavy docs as ai_sdlc', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-wf-'));
  try {
    writeMission(root, 'task-100', `# Review loop\n\nWe drive the forgejo review loop, backlog, draft, integrate and rebase checkpoints with the CLI and git coverage.`);
    assert.equal(inferHistoricalClassificationFromMissionDoc('task-100', root), 'ai_sdlc');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('inferHistoricalClassificationFromMissionDoc scores product-heavy docs as user_value', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-prod-'));
  try {
    writeMission(root, 'task-101', `# Web client cart\n\nPrice and store shopping delta for the android and wearos and ios clients and auth-server.`);
    assert.equal(inferHistoricalClassificationFromMissionDoc('task-101', root), 'user_value');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('inferHistoricalClassificationFromMissionDoc falls back to the title line when scores are balanced', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-title-'));
  try {
    writeMission(root, 'task-102', `# Fix the review board\n\nboard and sync and store with agent and backlog and forgejo.`);
    assert.equal(inferHistoricalClassificationFromMissionDoc('task-102', root), 'ai_sdlc');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('inferHistoricalClassificationFromMissionDoc returns null when the doc has no signal', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-none-'));
  try {
    writeMission(root, 'task-103', `# Random notes\n\nNothing relevant here at all.`);
    assert.equal(inferHistoricalClassificationFromMissionDoc('task-103', root), null);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('inferHistoricalClassificationFromMissionDoc returns null when the mission doc is missing', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-missing-'));
  try {
    fs.mkdirSync(path.join(root, 'docs', 'missions', '2024', 'task-104'), { recursive: true });
    assert.equal(inferHistoricalClassificationFromMissionDoc('task-104', root), null);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('inferHistoricalClassificationFromMissionDoc classifies web-client titles as user_value', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-web-'));
  try {
    writeMission(root, 'task-105', `# web client checkout\n\nfresh fruit and apples.`);
    assert.equal(inferHistoricalClassificationFromMissionDoc('task-105', root), 'user_value');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
