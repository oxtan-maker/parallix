// TASK-2343: regression assertions routed to their owning write/read contract.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { GATE_RESULT_RELATIVE_PATH, recordGateResult } from '../../../../src/adapters/verification/verification.js';
import { mkdtemp as registeredMkdtemp } from '../../../helpers/temp-dir.js';

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
