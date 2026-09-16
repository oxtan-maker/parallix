import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

import { ConcreteMissionReadAdapter } from '../src/adapters/backlog/concrete-mission-read-adapter.js';
import { buildBoardProjection } from '../src/application/projections/board.js';
import { emptyMetrics } from './fixtures/board-projection.js';
import { projectMissionCard, type MissionOperationalFacts } from '../src/application/projections/mission-board.js';
import { toWebBoardSnapshot } from '../src/interfaces/web/transport.js';
import { agentFamily } from '../src/domain/agents.js';
import { missionId, missionLabels } from '../src/domain/mission.js';
import { repositoryId } from '../src/domain/repository.js';

const repo = repositoryId('parallix');

/** Build the WebBoardSnapshot for a single mission loaded from a task file. */
async function webTitleFor(taskFile: string, titleFrontmatter: string): Promise<string | null> {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'px-2526-'));
  try {
    const tasksDir = path.join(tmp, 'backlog', 'tasks');
    fs.mkdirSync(tasksDir, { recursive: true });
    fs.writeFileSync(
      path.join(tasksDir, path.basename(taskFile)),
      [
        '---',
        `id: TASK-2526`,
        titleFrontmatter,
        'status: backlog',
        'assignee: [custom]',
        'labels: [user_value]',
        '---',
        '',
        '## Description',
        '',
        'body',
        '',
      ].join('\n'),
      'utf8',
    );

    const adapter = new ConcreteMissionReadAdapter({
      rootDir: tmp,
      repositoryId: repo,
      getTaskStorage: () => ({
        tasksDir,
        completedDir: path.join(tmp, 'backlog', 'completed'),
        archiveTasksDir: path.join(tmp, 'backlog', 'archive', 'tasks'),
      }),
      findMissionDir: () => null,
      findCheckpoints: () => [],
      resolveWorktree: () => null,
    });

    const missions = await adapter.loadAllMissions();
    const mission = missions.find((m) => m.id === missionId('task-2526'));
    assert.ok(mission, 'mission should load from the task file');

    const facts: MissionOperationalFacts = {
      latestGate: 'passed',
      reviewApproval: null,
      currentWork: null,
      blockingReason: null,
      flags: [],
    };
    const card = projectMissionCard(mission, facts);
    const projection = buildBoardProjection(
      repo,
      [card],
      [],
      [],
      emptyMetrics,
      [{ source: 'task-markdown', status: 'fresh', value: 'test' }],
    );
    const snapshot = toWebBoardSnapshot(projection);
    const card2526 = snapshot.stages
      .flatMap((stage) => stage.cards)
      .find((c) => c.id === mission.id);
    return card2526?.title ?? null;
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

test('web mission summary renders folded YAML description text', async () => {
  const foldedTitle = 'title: >-\n  Web does not display a good summary of a mission';
  const title = await webTitleFor(
    path.join(os.tmpdir(), 'task-2526-folded.md'),
    foldedTitle,
  );
  assert.notEqual(title, '>-', 'folded scalar must not leak the YAML marker');
  assert.equal(title, 'Web does not display a good summary of a mission');
});

test('web mission summary preserves an ordinary single-line description', async () => {
  const title = await webTitleFor(
    path.join(os.tmpdir(), 'task-2526-plain.md'),
    'title: Split mission importer parsing',
  );
  assert.equal(title, 'Split mission importer parsing');
});
