/**
 * The imported trace's commit pin, against a real Git checkout (TASK-2521.04).
 *
 * The unit suite passes the commit in, so this is the one place the default is
 * exercised: `importLegacyMissions` reads `HEAD` itself, and the pinned locator
 * is what recovers the legacy source text with `git show` after TASK-2521.07
 * deletes the file. That needs a real repository, so it runs in the
 * integration layer.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  importLegacyMissions,
  type MissionImportServices,
} from '../src/adapters/backlog/legacy-mission-import.js';
import { MissionIntakeService } from '../src/application/mission-intake-service.js';
import { MissionBriefService } from '../src/application/mission-brief-service.js';
import {
  missionVersion,
  type MissionTransitionStore,
  type MissionVersion,
} from '../src/application/domain-ports.js';
import type { LaneTransitionEvent } from '../src/domain/board-event.js';
import type { Mission, MissionId } from '../src/domain/mission.js';
import { repositoryId } from '../src/domain/repository.js';

const REPOSITORY = repositoryId('parallix');

class RecordingStore implements MissionTransitionStore {
  readonly missions = new Map<string, { mission: Mission; version: MissionVersion }>();

  async load(id: MissionId) {
    const held = this.missions.get(id);
    return held === undefined
      ? ({ kind: 'missing' } as const)
      : ({ kind: 'found', mission: held.mission, version: held.version } as const);
  }

  async save(mission: Mission, expectedVersion: MissionVersion | null) {
    const next = missionVersion((expectedVersion ?? 0) + 1);
    this.missions.set(mission.id, { mission, version: next });
    return next;
  }

  async saveWithTransition(
    mission: Mission,
    expectedVersion: MissionVersion | null,
    _event: LaneTransitionEvent,
  ) {
    return this.save(mission, expectedVersion);
  }
}

function services(store: MissionTransitionStore): MissionImportServices {
  return {
    repositoryId: REPOSITORY,
    store,
    intake: new MissionIntakeService(store),
    dependencies: new MissionBriefService(store),
  };
}

describe('the imported trace pins the commit it was read at', () => {
  it('pins the trace to the checkout HEAD when no commit is passed', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'task-2521.04-commit-'));
    const file = path.join('backlog', 'tasks', 'task-9001 - Open.md');
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(
      path.join(root, file),
      '---\nid: TASK-9001\ntitle: Open legacy record\nstatus: open\n---\n\nBody text.\n',
    );
    const run = (...args: readonly string[]) => execFileSync('git', args, {
      cwd: root,
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: 'Test', GIT_AUTHOR_EMAIL: 'test@example.invalid',
        GIT_COMMITTER_NAME: 'Test', GIT_COMMITTER_EMAIL: 'test@example.invalid',
      },
      encoding: 'utf8',
    });
    run('init', '--quiet', '--initial-branch', 'main');
    run('add', '.');
    run('commit', '--quiet', '-m', 'legacy material');
    const head = run('rev-parse', 'HEAD').trim();
    const store = new RecordingStore();

    await importLegacyMissions(services(store), { rootDir: root });

    const url = store.missions.get('task-9001')?.mission.externalTaskRef?.url;
    assert.equal(url, `${file}@${head}`);
    // The pin is what keeps the source text recoverable once the file is gone.
    fs.rmSync(path.join(root, file));
    assert.match(run('show', `${head}:${file}`), /Open legacy record/);
  });
});
