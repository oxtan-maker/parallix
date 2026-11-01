import { projectExecutionActivity, isWorkInProgress } from '../../../src/domain/execution-activity.js';
import { SqliteExecutionActivityStore } from '../../../src/adapters/sqlite/execution-activity-store.js';
import { repositoryId } from '../../../src/domain/repository.js';
import { ExecutionActivityRecorder } from '../../../src/application/recording/execution-activity-recorder.js';
// TASK-2375 regression: A starts, B replaces it, then late A terminal reports
// must leave B standing. Drive the production recorder, current snapshot store
// and projection over migrated SQLite, including reload and durable ordering.
import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { SqliteDatabaseAdapter } from '../../../src/adapters/sqlite/database-adapter.js';
import { copyMigratedSchema, prepareMigratedSchema } from '../../fixtures/migrated-database.js';
import { type ExecutionActivityIntent } from '../../../src/application/recording/execution-activity-recorder.js';
import { agentFamily } from '../../../src/domain/agents.js';
import { missionId } from '../../../src/domain/mission.js';

const MISSION = missionId('task-9101');
const NOW = Date.parse('2026-08-14T09:00:00.000Z');

// Exercise activity persistence, not repeated migration setup. Only the empty,
// closed schema is shared; every case owns and removes its writable database.
before(prepareMigratedSchema);

interface Fixture {
  readonly db: SqliteDatabaseAdapter;
  readonly recorder: ExecutionActivityRecorder;
  readonly readAdapter: SqliteExecutionActivityStore;
  dispose(): Promise<void>;
}

/** The production write/read pair over a real migrated operator database. */
async function fixture(): Promise<Fixture> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'parallix-2375-current-work-'));
  const db = new SqliteDatabaseAdapter();
  try {
    const databasePath = path.join(dir, 'operator.db');
    copyMigratedSchema(databasePath);
    await db.open({ path: databasePath });
  } catch (error) {
    await db.close();
    fs.rmSync(dir, { recursive: true, force: true });
    throw error;
  }
  const activity = new SqliteExecutionActivityStore(db, repositoryId('parallix'));
  let tick = 0;
  return {
    db,
    // A live publisher: the pid is this process, so reconciliation resolves the
    // surviving fact as `live` rather than aging it out on the TTL.
    recorder: new ExecutionActivityRecorder(activity, {
      processId: process.pid,
      now: () => new Date(NOW + (tick += 1_000)),
    }),
    readAdapter: activity,
    dispose: async () => {
      await db.close();
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}

function publication(operationId: string): ExecutionActivityIntent {
  return {
    missionId: MISSION,
    operationId,
    phase: 'execute' as const,
    summary: `px active ${MISSION} (${operationId})`,
    agent: agentFamily('codex'),
  };
}

/** Read the mission's current work exactly as `BoardProjectionBuilder` does. */
async function readCurrentWork(subject: Fixture) {
  const events = await subject.readAdapter.loadCurrentWork();
  return projectExecutionActivity(events, {
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
    const reviewPreparation = { ...publication(opId), phase: 'review' as const };

    await subject.recorder.running(exec);
    await subject.recorder.running(reviewPreparation);

    const facts = await readCurrentWork(subject);

    assert.equal(facts?.currentWork?.operationId, opId, "nested review preparation must carry same operationId as parent execute");
    assert.equal(facts?.currentWork?.phase, 'review', 'phase updates within same operation');
  } finally {
    await subject.dispose();
  }
});

test('worker identity replaces a live independent publisher and audit cannot change current activity (TASK-2822)', async () => {
  const subject = await fixture();
  try {
    await subject.recorder.running(publication('lead'));
    const worker = new ExecutionActivityRecorder(new SqliteExecutionActivityStore(subject.db, repositoryId('parallix')), { processId: process.pid + 100 });
    await worker.running({ ...publication('worker'), summary: 'reviewer running', agent: agentFamily('claude') });
    assert.equal((await readCurrentWork(subject))?.currentWork?.operationId, 'worker');
    await subject.recorder.ended(publication('lead'));
    await subject.recorder.blocked(publication('lead'), 'late supervisor failure');
    await subject.db.execute('INSERT INTO operational_history (event_type, event_data, created_at) VALUES (?, ?, ?)',
      ['mission.current-work', JSON.stringify({ ...publication('invented'), state: 'blocked', blockedReason: 'audit only' }), new Date().toISOString()]);
    const reloaded = new SqliteExecutionActivityStore(subject.db, repositoryId('parallix'));
    await subject.db.execute('INSERT INTO execution_activity (repository_id, mission_id, snapshot_json) VALUES (?, ?, ?)', ['parallix', 'task-unrelated-corrupt', '{}']);
    const work = projectExecutionActivity(await reloaded.loadMissionCurrentWork(MISSION), { nowMs: NOW + 60_000, ttlMs: 300_000, isProcessAlive: () => true }).get(MISSION);
    assert.equal(work?.currentWork?.agent, 'claude');
    assert.equal(work?.currentWork?.operationId, 'worker');
    assert.equal(work?.blockingReason, null);
    assert.deepEqual(await reloaded.loadMissionCurrentWork(missionId('task-absent')), []);
    await subject.db.execute('UPDATE execution_activity SET snapshot_json = ? WHERE mission_id = ?', ['{}', MISSION]);
    await assert.rejects(() => reloaded.loadMissionCurrentWork(MISSION), /Invalid stored execution activity/);
  } finally { await subject.dispose(); }
});

test('overlapping publications on one SQLite connection retain both active sources (TASK-2822)', async () => {
  const subject = await fixture();
  try {
    const first = new SqliteExecutionActivityStore(subject.db, repositoryId('parallix'));
    const second = new SqliteExecutionActivityStore(subject.db, repositoryId('parallix'));
    await subject.recorder.running(publication('parent'));
    const event = { ...publication('parent'), state: 'running' as const, processId: process.pid, blockedReason: null,
      agent: agentFamily('claude'), occurredAt: '2026-11-01T00:00:00Z' };
    await Promise.all([first.publish(event, 'first'), second.publish({ ...event, agent: agentFamily('codex') }, 'later')]);
    await first.publish({ ...event, state: 'ended' }, 'first');
    const snapshot = (await second.loadMissionCurrentWork(MISSION))[0];
    assert.deepEqual(snapshot.frames.map(frame => frame.sourceId), ['parent', 'later']);
    assert.equal(snapshot.frames.at(-1)?.event.agent, 'codex');
  } finally { await subject.dispose(); }
});
