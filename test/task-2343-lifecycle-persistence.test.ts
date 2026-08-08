/**
 * task-2343: the write paths behind the board's projections.
 *
 * Every test here is a unit test over injected doubles — no database, no
 * Forgejo, no agent launch and no CLI subprocess.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { ConcreteGateReadAdapter } from '../src/adapters/backlog/concrete-gate-read-adapter.js';
import { ConcreteOperationLogReadAdapter } from '../src/adapters/backlog/concrete-operation-log-read-adapter.js';
import { ConcreteReviewReadAdapter } from '../src/adapters/backlog/concrete-review-read-adapter.js';
import {
  OperationEventRecorder,
  operationEventToEntry,
  operationEventType,
} from '../src/application/recording/operation-event-recorder.js';
import { applyReviewStateToReview, reviewStateDataFrom } from '../src/adapters/review/review-state-mapping.js';
import { GATE_RESULT_RELATIVE_PATH, recordGateResult } from '../src/adapters/verification/verification.js';
import { missionId } from '../src/domain/mission.js';
import { agentFamily } from '../src/domain/agents.js';
import { changeRevision } from '../src/domain/review.js';
import type { Review } from '../src/domain/review.js';
import type { OperationalHistoryEntry, OperationalHistoryRepository } from '../src/application/ports/operation-history.js';

const MISSION = missionId('task-2343');

class MemoryHistoryRepo implements OperationalHistoryRepository {
  readonly entries: OperationalHistoryEntry[] = [];
  async findAll() { return this.entries as readonly OperationalHistoryEntry[]; }
  async findByType(type: string) { return this.entries.filter(e => e.eventType === type); }
  async append(entry: OperationalHistoryEntry) { this.entries.push({ id: this.entries.length + 1, ...entry }); }
  async clear() { this.entries.length = 0; }
}

// ---------------------------------------------------------------------------
// SC6 — lifecycle operations reach operational_history and come back out
// ---------------------------------------------------------------------------

test('operationEventToEntry maps a lifecycle operation onto the operational_history shape', () => {
  const entry = operationEventToEntry({
    missionId: MISSION,
    trigger: 'submit-for-review',
    toStatus: 'review',
    agent: 'codex',
    occurredAt: '2026-08-01T09:00:00.000Z',
  });

  assert.equal(entry.eventType, 'mission.submit-for-review');
  assert.equal(entry.createdAt, '2026-08-01T09:00:00.000Z');
  const data = JSON.parse(entry.eventData);
  assert.equal(data.missionId, 'task-2343');
  assert.equal(data.agent, 'codex');
  assert.match(data.message, /review/);
});

test('operationEventType namespaces every lifecycle trigger under mission.', () => {
  assert.equal(operationEventType('activate'), 'mission.activate');
  assert.equal(operationEventType('integrate'), 'mission.integrate');
});

test('recorded lifecycle events reach operational_history and the operation-log adapter', async () => {
  const history = new MemoryHistoryRepo();
  const recorder = new OperationEventRecorder(history);

  await recorder.append({
    missionId: MISSION, trigger: 'activate', toStatus: 'active',
    agent: 'codex', occurredAt: '2026-07-31T09:00:00.000Z',
  });
  await recorder.append({
    missionId: MISSION, trigger: 'submit-for-review', toStatus: 'review',
    agent: 'codex', occurredAt: '2026-08-01T09:00:00.000Z',
  });

  const adapter = new ConcreteOperationLogReadAdapter({ historyRepo: history });
  const log = await adapter.loadOperationLog();

  assert.equal(log.length, 2);
  assert.deepEqual(log.map(e => e.phase), ['mission.activate', 'mission.submit-for-review']);
  assert.equal(log[0].agent, 'codex');
  assert.equal(log[1].timestamp, '2026-08-01T09:00:00.000Z');
});

test('a lifecycle operation that changes no lane still records its own entry', async () => {
  const history = new MemoryHistoryRepo();
  await new OperationEventRecorder(history).append({
    missionId: MISSION, trigger: 'checkpoint' as never, toStatus: 'CP-3',
    agent: 'codex', occurredAt: '2026-08-02T09:00:00.000Z',
  });

  const recorded = await history.findByType('mission.checkpoint');
  assert.equal(recorded.length, 1);
  assert.match(JSON.parse(recorded[0].eventData).message, /CP-3/);
});

// ---------------------------------------------------------------------------
// SC3 — the gate artifact carries the verifier exit code, not prose
// ---------------------------------------------------------------------------

test('recordGateResult writes the exit code and derives the status from it', () => {
  const missionDir = fs.mkdtempSync(path.join(os.tmpdir(), 'px-gate-'));
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
  const missionDir = fs.mkdtempSync(path.join(os.tmpdir(), 'px-gate-'));
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
  // `px checkpoint` runs in the mission worktree and writes the gitignored
  // artifact there; the board is composed from the primary checkout, which
  // never receives it.
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'px-gate-worktree-'));
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

// ---------------------------------------------------------------------------
// SC1 — the PR reference survives the Review aggregate round trip
// ---------------------------------------------------------------------------

function reviewWithLocalBranch(): Review {
  return {
    rounds: [{
      number: 1,
      subject: {
        change: { kind: 'local-branch', sourceBranch: 'mission/task-2343', targetBranch: 'main' },
        revision: changeRevision('abc123'),
      },
      reviewer: agentFamily('claude'),
      implementer: agentFamily('codex'),
      startedAt: '2026-08-01T10:00:00.000Z',
      decision: null,
      response: null,
      phase: 'reviewing',
      disposition: null,
      reviewerRetryCount: 0,
      implementerRetryCount: 0,
    }],
    intervention: null,
    stageLaunches: [],
    gateFailureRetryCount: 0,
    reviewEvents: [],
  } as unknown as Review;
}

test('a confirmed PR reference is written onto the round and flattened back out', () => {
  const applied = applyReviewStateToReview(reviewWithLocalBranch(), {
    pullRequest: {
      kind: 'pull-request', provider: 'forgejo', id: '4242',
      url: 'http://localhost:3300/px/px/pulls/4242',
      sourceBranch: 'mission/task-2343', targetBranch: 'main',
    },
  });

  const change = applied.rounds[applied.rounds.length - 1].subject.change;
  assert.equal(change.kind, 'pull-request');
  assert.equal(change.kind === 'pull-request' && change.id, '4242');

  const flattened = reviewStateDataFrom(applied);
  assert.equal(flattened.pullRequest?.id, '4242');
  assert.equal(flattened.pullRequest?.provider, 'forgejo');
});

test('a state carrying no PR reference leaves the aggregate change untouched', () => {
  const applied = applyReviewStateToReview(reviewWithLocalBranch(), { phase: 'approved' });
  assert.equal(applied.rounds[0].subject.change.kind, 'local-branch');
  assert.equal(reviewStateDataFrom(applied).pullRequest, null);
});

test('an invalid PR reference is refused rather than written onto the round', () => {
  const applied = applyReviewStateToReview(reviewWithLocalBranch(), {
    pullRequest: {
      kind: 'pull-request', provider: '', id: '', url: null,
      sourceBranch: 'mission/task-2343', targetBranch: 'main',
    },
  });
  assert.equal(applied.rounds[0].subject.change.kind, 'local-branch');
});

test('loadReview and loadReviewApproval agree on the reviewed change', async () => {
  const state = {
    slug: 'task-2343',
    reviewer: 'claude',
    implementer: 'codex',
    round: 1,
    startedAt: '2026-08-01T10:00:00.000Z',
    phase: 'approved',
    disposition: 'approved',
    reviewerRetryCount: 0,
    implementerRetryCount: 0,
    metadata: {},
    pullRequest: {
      kind: 'pull-request' as const, provider: 'forgejo', id: '4242',
      url: null, sourceBranch: 'mission/task-2343', targetBranch: 'main',
    },
  };
  const adapter = new ConcreteReviewReadAdapter({
    rootDir: '/tmp',
    missionStore: null,
    readReviewState: () => state as never,
    findMissionDir: () => '/tmp/missions/task-2343',
  });

  const review = await adapter.loadReview(MISSION);
  const approval = await adapter.loadReviewApproval(MISSION);
  assert.ok(review);
  assert.ok(approval);
  assert.deepEqual(review!.rounds[0].subject, approval!.subject);
  assert.equal(approval!.subject.change.kind, 'pull-request');
});
