// TASK-2343: regression assertions routed to their owning write/read contract.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { ConcreteGateReadAdapter } from '../src/adapters/backlog/concrete-gate-read-adapter.js';
import { GATE_RESULT_RELATIVE_PATH, recordGateResult } from '../src/adapters/verification/verification.js';
import { missionId } from '../src/domain/mission.js';
import { mkdtemp as registeredMkdtemp } from './helpers/temp-dir.js';

const MISSION = missionId('task-2343');
test('recordGateResult writes the exit code and derives the status from it', () => {
  const missionDir = registeredMkdtemp('px-gate-');
  try {
    const record = recordGateResult(missionDir, {
      area: 'all', command: './scripts/verify-local.sh all', exitCode: 0,
    });
    assert.ok(record);
    assert.equal(record!.status, 'passed');
    assert.equal(record!.exitCode, 0);

    const written = JSON.parse(fs.readFileSync(path.join(missionDir, GATE_RESULT_RELATIVE_PATH), 'utf8'));
    assert.equal(written.exitCode, 0);
    assert.equal(written.command, './scripts/verify-local.sh all');

    const failing = recordGateResult(missionDir, {
      area: 'all', command: './scripts/verify-local.sh all', exitCode: 1,
    });
    assert.equal(failing!.status, 'failed');
  } finally {
    fs.rmSync(missionDir, { recursive: true, force: true });
  }
});

test('a null gate exit code is recorded as failed, never as passed', () => {
  const missionDir = registeredMkdtemp('px-gate-');
  try {
    const record = recordGateResult(missionDir, { area: 'all', command: 'gate', exitCode: null });
    assert.equal(record!.status, 'failed');
  } finally {
    fs.rmSync(missionDir, { recursive: true, force: true });
  }
});

test('ConcreteGateReadAdapter reads the recorded exit code in preference to prose', async () => {
  // A recorded failure must win even when the surrounding text says "passed":
  // ADR 0048 class 1 — only the exit code is evidence.
  const adapter = new ConcreteGateReadAdapter({
    rootDir: '/tmp',
    findMissionDir: () => '/tmp/missions/task-2343',
    readGateFile: () => JSON.stringify({ exitCode: 1, status: 'failed', command: 'all tests passed' }),
  });

  assert.equal(await adapter.loadGateStatus(MISSION), 'failed');
});

test('ConcreteGateReadAdapter reads the gate artifact from the mission worktree', async () => {
  // Verification runs in the mission worktree and writes the gitignored
  // artifact there; the board is composed from the primary checkout, which
  // never receives it.
  const tmp = registeredMkdtemp('px-gate-worktree-');
  try {
    const primaryRoot = path.join(tmp, 'primary');
    const worktreeRoot = path.join(tmp, 'wt-task-2343');
    const worktreeMissionDir = path.join(worktreeRoot, 'missions', MISSION);
    fs.mkdirSync(path.join(primaryRoot, 'missions', MISSION), { recursive: true });
    fs.mkdirSync(worktreeMissionDir, { recursive: true });
    recordGateResult(worktreeMissionDir, { area: 'all', command: 'gate', exitCode: 0 });

    const adapter = new ConcreteGateReadAdapter({
      rootDir: primaryRoot,
      findMissionDir: (slug, rootDir) => path.join(rootDir ?? primaryRoot, 'missions', slug),
      resolveWorktree: () => worktreeRoot,
    });

    assert.equal(await adapter.loadGateStatus(MISSION), 'passed');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
