/**
 * TASK-2375 CP-1 — the bounded current-work read can lose the standing operation.
 *
 * This is the red reproduction for SC1 / AC #1. It drives the *production*
 * composition of the current-work read path — the real SQLite operational
 * history, `ConcreteCurrentWorkReadAdapter`, and `reconcileCurrentWork` — with
 * the ordering the mission specifies:
 *
 *   1  op-A running
 *   2  op-B running   <- the mission's actual current work
 *   3  op-A ended
 *   4  op-A blocked
 *
 * The reconciler already refuses a terminal event from a superseded operation,
 * but it never sees `op-B running`: the read adapter asks the repository for a
 * fixed number of latest rows per mission, and the two late `op-A` events fill
 * that window. The board then shows a mission with a live operation as not
 * being worked at all.
 *
 * The scenario must not be relaxed to make this pass — the fix belongs in the
 * read path, not in the ordering.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { SqliteDatabaseAdapter } from '../src/adapters/sqlite/database-adapter.js';
import { SqliteMigrationRunner, loadDefaultMigrations } from '../src/adapters/sqlite/migration-runner.js';
import { SqliteOperationalHistoryRepository } from '../src/adapters/sqlite/operational-history-repository.js';
import { ConcreteCurrentWorkReadAdapter } from '../src/adapters/backlog/concrete-current-work-read-adapter.js';
import { CurrentWorkRecorder, type CurrentWorkPublication } from '../src/application/recording/current-work-recorder.js';
import { isWorkInProgress, reconcileCurrentWork } from '../src/application/projections/current-work.js';
import { agentFamily } from '../src/domain/agents.js';
import { missionId } from '../src/domain/mission.js';

const MISSION = missionId('task-9101');
const NOW = Date.parse('2026-08-14T09:00:00.000Z');

interface Fixture {
  readonly db: SqliteDatabaseAdapter;
  readonly recorder: CurrentWorkRecorder;
  readonly readAdapter: ConcreteCurrentWorkReadAdapter;
  dispose(): Promise<void>;
}

/** The production write/read pair over a real migrated operator database. */
async function fixture(): Promise<Fixture> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'parallix-2375-current-work-'));
  const db = new SqliteDatabaseAdapter();
  await db.open({ path: path.join(dir, 'operator.db') });
  await new SqliteMigrationRunner(db).applyPending(loadDefaultMigrations());
  const repo = new SqliteOperationalHistoryRepository(db);
  let tick = 0;
  return {
    db,
    // A live publisher: the pid is this process, so reconciliation resolves the
    // surviving fact as `live` rather than aging it out on the TTL.
    recorder: new CurrentWorkRecorder(repo, {
      processId: process.pid,
      now: () => new Date(NOW + (tick += 1_000)),
    }),
    readAdapter: new ConcreteCurrentWorkReadAdapter(repo),
    dispose: async () => {
      await db.close();
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}

function publication(operationId: string): CurrentWorkPublication {
  return {
    missionId: MISSION,
    operationId,
    phase: 'execute',
    summary: `px active ${MISSION} (${operationId})`,
    agent: agentFamily('codex'),
  };
}

/** Read the mission's current work exactly as `BoardProjectionBuilder` does. */
async function readCurrentWork(subject: Fixture) {
  const events = await subject.readAdapter.loadCurrentWork();
  return reconcileCurrentWork(events, {
    nowMs: NOW + 60_000,
    ttlMs: 5 * 60 * 1000,
    isProcessAlive: () => true,
  }).get(MISSION) ?? null;
}

test('TASK-2375 SC1: the production current-work read keeps operation B standing after late op-A terminal events', async () => {
  const subject = await fixture();
  try {
    const opA = publication('op-A');
    const opB = publication('op-B');

    await subject.recorder.running(opA);
    await subject.recorder.running(opB);
    await subject.recorder.ended(opA);
    await subject.recorder.blocked(opA, 'op-A exhausted its eligible families');

    const facts = await readCurrentWork(subject);

    assert.equal(facts?.currentWork?.operationId, 'op-B', 'the newest standing operation must survive late op-A events');
    assert.equal(facts?.blockingReason, null, 'a superseded operation must not post a blocking reason over live work');
    assert.equal(isWorkInProgress(facts?.currentWork ?? null), true, 'the mission must still read as WORKING');
  } finally {
    await subject.dispose();
  }
});

test('TASK-2375 SC1: op-B survives an unbounded number of late terminal events from older operations', async () => {
  const subject = await fixture();
  try {
    const opB = publication('op-B');
    await subject.recorder.running(publication('op-A'));
    await subject.recorder.running(opB);
    // Older operations keep reporting long after B took over. No fixed window
    // of latest events can absorb this; the read must be bounded by the
    // standing operation instead.
    for (let index = 0; index < 25; index += 1) {
      const older = publication(`op-old-${index}`);
      await subject.recorder.ended(older);
      await subject.recorder.blocked(older, `op-old-${index} gave up`);
    }

    const facts = await readCurrentWork(subject);

    assert.equal(facts?.currentWork?.operationId, 'op-B');
    assert.equal(isWorkInProgress(facts?.currentWork ?? null), true);
  } finally {
    await subject.dispose();
  }
});

test('TASK-2375 SC1: the standing operation is still cleared by its own terminal event', async () => {
  const subject = await fixture();
  try {
    const opA = publication('op-A');
    const opB = publication('op-B');
    await subject.recorder.running(opA);
    await subject.recorder.running(opB);
    await subject.recorder.ended(opA);
    await subject.recorder.ended(opB);

    const facts = await readCurrentWork(subject);

    assert.equal(facts?.currentWork, null, 'B ending its own operation clears the mission');
    assert.equal(facts?.blockingReason, null);
  } finally {
    await subject.dispose();
  }
});

// ---------------------------------------------------------------------------
// SC2 — invocation correlation (unique operationId per invocation)
// ---------------------------------------------------------------------------

test('TASK-2375 SC2: two overlapping same-type invocations on one mission have distinct operationId and cannot cross-terminate', async () => {
  const subject = await fixture();
  try {
    // Two review invocations on the same mission, each with unique operationId.
    // First invocation starts, second starts (supersedes first on board), then
    // first ends — second must remain standing.
    const review1 = publication('review:task-9101:a1b2c3');
    const review2 = publication('review:task-9101:d4e5f6');

    await subject.recorder.running(review1);
    await subject.recorder.running(review2);
    await subject.recorder.ended(review1); // late end from first invocation

    const facts = await readCurrentWork(subject);

    assert.equal(facts?.currentWork?.operationId, 'review:task-9101:d4e5f6', 'late ended from first invocation must not clear second');
    assert.equal(isWorkInProgress(facts?.currentWork ?? null), true, 'mission must still read as WORKING');
  } finally {
    await subject.dispose();
  }
});

test('TASK-2375 SC2: blocked event from older invocation does not replace newer running work', async () => {
  const subject = await fixture();
  try {
    const review1 = publication('review:task-9101:first');
    const review2 = publication('review:task-9101:second');

    await subject.recorder.running(review1);
    await subject.recorder.running(review2);
    await subject.recorder.blocked(review1, 'first invocation exhausted');

    const facts = await readCurrentWork(subject);

    assert.equal(facts?.currentWork?.operationId, 'review:task-9101:second');
    assert.equal(facts?.blockingReason, null, 'blocked from superseded operation must not appear');
  } finally {
    await subject.dispose();
  }
});

test('TASK-2375 SC2: nested phases retain the same operationId', async () => {
  const subject = await fixture();
  try {
    const opId = 'execute:task-9101:xyz';
    const exec = { ...publication(opId), phase: 'execute' as const };
    const handoff = { ...publication(opId), phase: 'handoff' as const };

    await subject.recorder.running(exec);
    await subject.recorder.running(handoff);

    const facts = await readCurrentWork(subject);

    assert.equal(facts?.currentWork?.operationId, opId, 'nested handoff must carry same operationId as parent execute');
    assert.equal(facts?.currentWork?.phase, 'handoff', 'phase updates within same operation');
  } finally {
    await subject.dispose();
  }
});
