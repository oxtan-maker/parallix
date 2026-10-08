// Fresh repair proof (TASK-2665): Goal Check rows remember the review round they were recorded in, and
// an open repair (reviewer-requested changes or an integration bounceback) owes fresh rows for the
// criteria its findings or failed gate name. Owns the record-time half of that contract; handoff's half
// lives in the handoff use-case suite.

import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { MissionCheckpointService } from '../../../src/application/mission-checkpoint-service.js';
import { missionVersion, type MissionStore } from '../../../src/application/domain-ports.js';
import { missionId, type Mission } from '../../../src/domain/mission.js';
import { repositoryId } from '../../../src/domain/repository.js';
import { reviewFindingId } from '../../../src/domain/review.js';

describe('Checkpoint repair freshness', () => {
  // Rows remember the review round they were recorded in; repair rounds owe fresh rows.
  function repairFixture(kind: 'finding-F4' | 'finding-F4-criterion-1' | 'classifier-criterion-1' | 'bounceback' | 'bounceback-gate', priorRound?: number) {
    const successCriteria = ['first', 'second'];
    const base = { subject: { change: {} as never, revision: 'rev' as never }, reviewer: 'claude' as never, implementer: 'custom' as never, startedAt: '2026-01-01T00:00:00Z', disposition: null, reviewerRetryCount: 0, implementerRetryCount: 0 };
    const requested = (id: string, summary = 'repair') => ({
      ...base, number: 1, phase: 'fixing' as never, response: null,
      decision: { kind: 'changes-requested', decidedAt: '2026-01-01T01:00:00Z', comment: null, findings: [
        { id: reviewFindingId(id), summary, location: null },
      ] },
    });
    const rounds = kind.startsWith('bounceback')
      ? [
        { ...base, number: 1, phase: 'approved' as never, response: null, decision: {
          kind: 'approved', decidedAt: '2026-01-01T01:00:00Z', comment: null, source: { kind: 'local' },
          revocation: { revokedAt: '2026-01-01T02:00:00Z', revokedBy: 'px', reason: 'gate', cause: { kind: 'integration-gate-failure', gate: kind === 'bounceback-gate' ? 'unit-first' : 'g' } },
        } },
        { ...base, number: 2, phase: 'reviewing' as never, response: null, decision: null },
      ]
      : [kind === 'finding-F4-criterion-1' ? requested('F4', 'Success criterion 1 has no fix evidence') : requested(kind === 'finding-F4' ? 'F4' : 'success-criterion-1')];
    const rowOf = (criterion: string, evidence: string) => ({ criterion, evidence, recordedRound: priorRound });
    let mission = {
      id: missionId('task-2662'), repositoryId: repositoryId('repo'), status: 'active',
      successCriteria, completedSuccessCriteria: [0, 1],
      checkpoints: [{ missionId: missionId('task-2662'), name: 'CP-1', firstLine: 'cp', nextActionText: 'review', goalCheck: [
        rowOf('first', '`test/unit/example.test.ts` via unit-first'), rowOf('second', 'test/unit/example.test.ts'),
      ] }],
      review: { rounds, intervention: null, stageLaunches: [], reviewEvents: [] },
    } as unknown as Mission;
    let saves = 0;
    const store: MissionStore = {
      load: async () => ({ kind: 'found', mission, version: missionVersion(1) }) as never,
      save: async (next) => { mission = next; saves += 1; return missionVersion(2); },
    };
    const existing = new Set(['/repo/test/unit/example.test.ts']);
    const service = new MissionCheckpointService(store, {
      fileSystem: { existsSync: (target) => existing.has(target), readText: () => '', listEntries: () => [], listNames: () => [] },
      rootFor: () => '/repo',
    });
    const record = (name: string, rows: readonly { readonly criterion: string; readonly evidence: string }[]) => service.record({
      operationId: 'op', missionId: missionId('task-2662'), capabilities: new Set(['checkpoint:record']), expectedVersion: missionVersion(1),
      checkpoint: { missionId: missionId('task-2662'), name, nextActionText: 'continue', goalCheck: rows },
    } as never);
    return { record, saves: () => saves, current: () => mission };
  }
  const ref = '`test/unit/example.test.ts`';

  test('record refuses a repair that omits fresh evidence for a criterion a finding names (TASK-2665)', async () => {
    const { record, saves, current } = repairFixture('classifier-criterion-1', 0);
    const stale = await record('CP-2', [{ criterion: 'second', evidence: ref }]);
    assert.equal(stale.status, 'failed');
    assert.match(stale.error?.message ?? '', /needs fresh fix evidence recorded in this review round for first/);
    assert.match(stale.error?.message ?? '', /px checkpoint record --name CP-2/);
    assert.equal(saves(), 0, 'a refused repair writes nothing');
    assert.equal((await record('CP-2', [{ criterion: 'first', evidence: ref }])).status, 'completed');
    assert.deepEqual(current().checkpoints.find((cp) => cp.name === 'CP-2')!.goalCheck.map((row) => row.recordedRound), [1]);
  });

  test('record refuses a fresh row for the wrong criterion when an F-id finding names another (TASK-2665)', async () => {
    const { record, saves } = repairFixture('finding-F4-criterion-1', 0);
    const wrong = await record('CP-2', [{ criterion: 'second', evidence: ref }]);
    assert.equal(wrong.status, 'failed');
    assert.match(wrong.error?.message ?? '', /fresh fix evidence recorded in this review round for first/);
    assert.equal(saves(), 0);
    assert.equal((await record('CP-2', [{ criterion: 'first', evidence: ref }])).status, 'completed');
  });

  test('record accepts a partial repair on ordinary F-id findings and keeps unrelated proof (TASK-2665)', async () => {
    const { record, current } = repairFixture('finding-F4', 0);
    assert.equal((await record('CP-1', [{ criterion: 'first', evidence: ref }])).status, 'completed');
    const rows = current().checkpoints.find((cp) => cp.name === 'CP-1')!.goalCheck;
    assert.deepEqual(rows.map((row) => [row.criterion, row.recordedRound]), [['first', 1], ['second', 0]]);
  });

  test('record refuses a bounceback repair that is fresh only for a criterion the failed gate does not touch (TASK-2665)', async () => {
    // The failed gate unit-first is cited by criterion first's proof, so that
    // criterion is affected; fresh proof for second alone does not repair it.
    const { record, saves } = repairFixture('bounceback-gate');
    const wrong = await record('CP-2', [{ criterion: 'second', evidence: ref }]);
    assert.equal(wrong.status, 'failed');
    assert.match(wrong.error?.message ?? '', /fresh fix evidence recorded in this review round for first/);
    assert.equal(saves(), 0);
    assert.equal((await record('CP-2', [{ criterion: 'first', evidence: ref }])).status, 'completed');
  });

  test('record accepts a bounceback repair and stamps it with the pending round (TASK-2665)', async () => {
    const { record, current } = repairFixture('bounceback');
    assert.equal((await record('CP-1', [{ criterion: 'second', evidence: ref }])).status, 'completed');
    const rows = current().checkpoints.find((cp) => cp.name === 'CP-1')!.goalCheck;
    assert.deepEqual(rows.map((row) => [row.criterion, row.recordedRound]), [['first', undefined], ['second', 2]]);
  });
});
