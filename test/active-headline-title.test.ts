/**
 * TASK-2606 reproduction: Mission directories are retired, so a Mission has no
 * MISSION.md. `px active <slug>` must still open with the authoritative title
 * `px status` reports, never the `<Title>` scaffold placeholder and never the
 * slug repeated from a trailing `(slug)` identifier.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import active from '../src/adapters/cli/commands/active.js';
import { createStatusBoardFor, statusMissionTitle } from '../src/composition/status-board.js';
import { mkdtemp } from './helpers/temp-dir.js';

const SLUG = 'task-2606';

function servicesWith(recordedTitle: string, cardTitle: string | null) {
  const mission = {
    id: SLUG, title: recordedTitle, status: 'active', assignee: 'claude', checkpoints: [],
    brief: null, declaredGates: [], successCriteria: [], dependencies: [], externalTaskRef: null, closedAt: null,
  };
  return {
    presentationCapabilities: {
      boardProjection: { buildMissionCard: async () => (cardTitle === null ? null : { id: SLUG, title: cardTitle, status: 'active' }) },
    },
    mission: { store: { load: async () => ({ kind: 'found', mission, version: 3 }) } },
  } as never;
}

async function headline(services: never, rootDir: string): Promise<string> {
  const logs: string[] = [];
  await active([SLUG], {
    inferSlugFn: () => SLUG,
    rootDir,
    missionTitleFn: (slug: string) => statusMissionTitle(services, slug, rootDir),
    serviceFactory: async () => ({ execute: async () => ({ status: 'completed', value: { agent: 'claude' }, durableEvidence: [] }) }),
    exitFn: (code: number) => { throw new Error(`unexpected exit ${code}`); },
    logFn: (message: string) => logs.push(message),
    errorFn: (message: string) => { throw new Error(`unexpected error: ${message}`); },
  });
  return logs[0];
}

test('px active headline shows the recorded Mission title when no MISSION.md exists', async () => {
  const rootDir = mkdtemp('task-2606-');
  try {
    assert.equal(fs.existsSync(path.join(rootDir, 'missions')), false, 'fixture must have no Mission directory');
    const services = servicesWith('Show the recorded Mission title (task-2606)', null);
    const line = await headline(services, rootDir);
    assert.equal(line, 'Mission task-2606: Show the recorded Mission title');
    assert.ok(!line.includes('<Title>'), line);
    assert.equal(line.split(SLUG).length - 1, 1, `slug must appear once: ${line}`);
    const status = await createStatusBoardFor(services).getMissionData(SLUG, rootDir);
    assert.equal(status?.title, 'Show the recorded Mission title (task-2606)', 'px status reports the same authority');
  } finally {
    fs.rmSync(rootDir, { recursive: true, force: true });
  }
});

test('px active headline never shows the <Title> scaffold placeholder', async () => {
  const rootDir = mkdtemp('task-2606-');
  try {
    const line = await headline(servicesWith('<Title> (task-2606)', null), rootDir);
    assert.equal(line, 'Mission task-2606');
  } finally {
    fs.rmSync(rootDir, { recursive: true, force: true });
  }
});
