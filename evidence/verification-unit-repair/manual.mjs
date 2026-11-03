// Run with: node --import tsx evidence/verification-unit-repair/manual.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runPhaseGates } from '../../src/adapters/config/repository-gates.ts';
import { createVerificationObservation } from '../../src/composition/verification-observation.ts';
import { configureVerificationObservation } from '../../src/application/ports/verification-observation.ts';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'px-gate-classification-'));
const entries = [];
const history = { async append(entry) { entries.push(JSON.parse(entry.eventData)); } };
configureVerificationObservation(createVerificationObservation(history,
  () => ({ repositoryId: 'disposable-repository', missionId: 'disposable-mission', revision: null })));
try {
  for (const status of [75, 1, 0]) {
    const result = await runPhaseGates('handoff', {
      slug: 'disposable-mission', checkoutPath: root, log() {}, error() {},
      gates: [{ key: 'check', command: `echo 'connection refused' >&2; exit ${status}`, order: 0 }],
    });
    assert.equal(result.executed, 1);
    assert.equal(result.ok, status === 0);
    const terminal = entries.at(-1);
    assert.equal(terminal.exitCode, status);
    assert.equal(terminal.failureReason?.code ?? null,
      status === 75 ? 'infrastructure' : status === 1 ? 'gate-failed' : null);
    assert.ok(terminal.startedAt);
    assert.ok(terminal.finishedAt);
    assert.equal(terminal.cpu.provenance, 'bash-time-waited-tree');
  }
  const terminals = entries.filter(entry => entry.finishedAt);
  assert.equal(new Set(terminals.map(entry => entry.id)).size, 3);
  console.log(JSON.stringify({ result: 'passed', boundary: 'Real Bash exits through runPhaseGates and observation capture; in-memory history, disposable directory, no operator statistics writes', entries }, null, 2));
} finally {
  configureVerificationObservation(null);
  fs.rmSync(root, { recursive: true, force: true });
}
