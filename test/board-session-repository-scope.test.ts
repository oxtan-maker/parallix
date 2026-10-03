import test from 'node:test';
import assert from 'node:assert/strict';
import type { MissionId } from '../src/domain/mission.js';
import { agentFamily } from '../src/domain/agents.js';
import { detectRunningMissionSessions } from '../src/adapters/agents/running-sessions.js';
import { boardFingerprint } from '../src/application/projections/board-subscription.js';
import { makeProjection, makeCard } from './fixtures/board-projection.js';
import type { BoardProjection } from '../src/application/projections/board.js';
import type { RunningAgentSession } from '../src/application/projections/agent-status.js';

// ---------------------------------------------------------------------------
// task-2388 regression coverage.
//
// These three scenarios encode the unsafe recovery, the nested-CWD miss, and
// the fingerprint-only-refresh gap. They must be red against the mission parent
// commit and green after the implementation.
// ---------------------------------------------------------------------------

const NOW_MS = Date.parse('2026-08-21T12:00:00Z');

// The board repository: its root plus one mission worktree.
const BOARD_ROOT = '/home/dev/parallix';
const BOARD_WORKTREES = new Map<string, MissionId>([
  [BOARD_ROOT, 'parallix' as MissionId],
  ['/home/dev/parallix-task-5000', 'task-5000' as MissionId],
]);

// An explicit-slug draft launched from an unrelated checkout that happens to
// share the mission slug. Same slug, different repository.
const DRAFT_IN_OTHER_REPO = 'node /home/other/parallix/node_modules/.bin/tsx src/entry/px.ts draft task-5000 --agent custom';
// The same command, but launched from inside the board repository root.
const DRAFT_IN_BOARD_REPO = 'node /home/dev/parallix/node_modules/.bin/tsx src/entry/px.ts draft task-5000 --agent custom';
// A slug-less review loop whose arguments do not name the worktree path, so
// only its nested working directory identifies the mission.
const NESTED_REVIEW = 'node /usr/local/bin/px.ts review --continue --max-attempts 8';

test('SC1: an explicit-slug process outside the board repository is not reported as local', () => {
  const sessions = detectRunningMissionSessions({
    rootDir: BOARD_ROOT,
    now: () => NOW_MS,
    listWorktrees: () => BOARD_WORKTREES,
    // The process runs in a sibling checkout that only shares the slug.
    resolveCwd: () => '/home/other/parallix',
    listProcesses: () => [{ pid: 100, elapsedSeconds: 30, args: DRAFT_IN_OTHER_REPO }],
  });

  assert.deepEqual(sessions, [], 'a same-named mission in another checkout must not appear on this board');
});

test('SC1: an explicit-slug process inside the board repository is reported', () => {
  const sessions = detectRunningMissionSessions({
    rootDir: BOARD_ROOT,
    now: () => NOW_MS,
    listWorktrees: () => BOARD_WORKTREES,
    resolveCwd: () => BOARD_ROOT,
    listProcesses: () => [{ pid: 100, elapsedSeconds: 30, args: DRAFT_IN_BOARD_REPO }],
  });

  assert.deepEqual(sessions?.map((session) => [session.missionId, session.pinnedAgent]), [
    ['task-5000', 'custom'],
  ], 'the process runs inside the board repository, so the explicit slug is trustworthy');
});

test('SC2: a slug-less command from a nested directory under a worktree resolves to that mission', () => {
  const sessions = detectRunningMissionSessions({
    rootDir: BOARD_ROOT,
    now: () => NOW_MS,
    listWorktrees: () => BOARD_WORKTREES,
    // The working directory is a descendant of the mission worktree.
    resolveCwd: () => '/home/dev/parallix-task-5000/subtasks/nested',
    listProcesses: () => [{ pid: 100, elapsedSeconds: 60, args: NESTED_REVIEW }],
  });

  assert.deepEqual(sessions?.map((session) => [session.missionId, session.worktree]), [
    ['task-5000', '/home/dev/parallix-task-5000'],
  ], 'the nested CWD resolves to its registered mission worktree');
});

test('SC4: a liveSession change repaints the board', () => {
  const session: RunningAgentSession = { missionId: 'task-5000' as MissionId, family: agentFamily('custom') };
  const base = makeProjection({ active: [makeCard({ id: 'task-5000' as MissionId, liveSession: null })] });
  const withSession = makeProjection({ active: [makeCard({ id: 'task-5000' as MissionId, liveSession: session })] });

  assert.notEqual(boardFingerprint(base), boardFingerprint(withSession), 'liveSession must move the fingerprint');
});

test('SC4: an unattributedRunningSessions change repaints the board', () => {
  const withMetrics = (count: number | null): BoardProjection => {
    const projection = makeProjection();
    (projection as { metrics: BoardProjection['metrics'] }).metrics = {
      ...projection.metrics,
      unattributedRunningSessions: count,
    };
    return projection;
  };

  assert.notEqual(
    boardFingerprint(withMetrics(null)),
    boardFingerprint(withMetrics(2)),
    'unattributedRunningSessions must move the fingerprint',
  );
});
