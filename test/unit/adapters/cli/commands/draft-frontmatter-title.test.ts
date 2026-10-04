// TASK-2612: draft intake must record the folded title text, never `>-`.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { createDraftWorkflowAdapter } from '../../../../../src/adapters/cli/commands/draft-stats.js';
import { intakeMission, missionId } from '../../../../../src/domain/mission.js';
import { repositoryId } from '../../../../../src/domain/repository.js';
import { mkdtemp } from '../../../../helpers/temp-dir.js';

const SLUG = 'task-2612';
const TITLE = 'Draft intake records the folded YAML title';

test('TASK-2612: draft intake records a folded frontmatter title', async () => {
  const root = mkdtemp('task-2612-');
  const taskFile = path.join(root, 'backlog', 'tasks', `${SLUG} - folded-title.md`);
  fs.mkdirSync(path.dirname(taskFile), { recursive: true });
  fs.writeFileSync(taskFile, [
    '---',
    `id: ${SLUG.toUpperCase()}`,
    'title: >-',
    '  Draft intake records the',
    '  folded YAML title',
    'status: backlog',
    '---',
    '',
  ].join('\n'));

  let recordedTitle: string | undefined;
  const missionServicesFn = async () => ({
      repositoryId: 'parallix',
      intake: { execute: async (request: { title: string }) => {
        recordedTitle = request.title;
        return { status: 'completed', value: { version: 1 }, durableEvidence: [] };
      } },
    });
  const workflow = createDraftWorkflowAdapter({
    resolveTaskFileFn: () => ({ ok: true, taskFile }),
  });

  try {
    await workflow.intake({
      slug: SLUG,
      targetWorktree: root,
      syntheticTask: null,
      options: {},
      missionServicesFn,
    } as never);
    assert.equal(recordedTitle, TITLE);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('TASK-2612: YAML block-scalar headers fall back to the Mission slug', () => {
  for (const marker of ['>', '>-', '|', '|-']) {
    const mission = intakeMission({
      id: missionId(SLUG),
      repositoryId: repositoryId('parallix'),
      title: marker,
    });
    assert.equal(mission.title, SLUG, `${marker} must not enter the Mission store as a title`);
  }
});
