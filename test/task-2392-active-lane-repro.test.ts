import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { ConcreteMissionReadAdapter } from '../src/adapters/backlog/concrete-mission-read-adapter.js';
import { buildBoardMetrics, buildBoardProjection } from '../src/application/projections/board.js';
import { projectMissionCard } from '../src/application/projections/mission-board.js';
import { missionId } from '../src/domain/mission.js';
import { repositoryId } from '../src/domain/repository.js';

const id = missionId('task-2392');
const repo = repositoryId('task-2392-repro');

function task(status: string, title: string, labels: string, assignee: string): string {
  return `---\nid: TASK-2392\ntitle: ${title}\nstatus: ${status}\nassignee: [${assignee}]\nlabels: [${labels}]\n---\n`;
}

test('task-2392: active task appears in active stage, not backlog', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'px-2392-'));
  const base = path.join(root, 'base');
  const worktree = path.join(root, 'worktree');
  const writeTask = (dir: string, content: string) => {
    const file = path.join(dir, 'backlog', 'tasks', 'task-2392 - test.md');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content, 'utf8');
    return file;
  };
  writeTask(base, task('active', 'authoritative title', 'bug', 'codex'));
  writeTask(worktree, task('backlog', 'worktree description wins', 'ai_sdlc, bug', 'custom'));

  try {
    const adapter = new ConcreteMissionReadAdapter({
      rootDir: worktree,
      repositoryId: repo,
      getTaskStorage: (dir = worktree) => ({
        tasksDir: path.join(dir, 'backlog', 'tasks'),
        completedDir: path.join(dir, 'backlog', 'completed'),
        archiveTasksDir: path.join(dir, 'backlog', 'archive', 'tasks'),
      }),
      findMissionDir: () => null,
      findCheckpoints: () => [],
      resolveWorktree: () => worktree,
      resolveBaseWorktree: () => base,
    });
    const materialized = await adapter.loadMission(id);
    assert.ok(materialized, 'mission did not materialize');
    assert.equal(materialized.status, 'active');

    const card = projectMissionCard(materialized, {
      latestGate: 'unknown', reviewApproval: null, currentWork: null, blockingReason: null, flags: [],
    });
    const projection = buildBoardProjection(
      repo, [card], [], [],
      buildBoardMetrics({
        cumulativeFlow: { series: [], missingHistoryFallback: 'skip' },
        medianStateTimes: { series: [], missingHistoryFallback: 'skip' },
        throughput: { series: [], missingHistoryFallback: 'skip' },
        reviewBounceRate: { series: [], missingHistoryFallback: 'skip' },
      }), [],
    );

    const idsIn = (lane: 'active' | 'backlog') => projection.stages
      .find((stage) => stage.lane === lane)!.cards
      .filter((candidate) => candidate.id === id);
    assert.equal(idsIn('active').length, 1);
    assert.equal(idsIn('backlog').length, 0);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
