/**
 * task-2441 — the Ink board must show a mission's real title on every lane.
 *
 * The board catalog comes from the Backlog Markdown, which owns the title
 * (`MISSION_FIELD_AUTHORITY.title` is `target-repository`). The SQLite mission
 * aggregate owns lifecycle state only, but it is seeded at `px draft` intake
 * time from the still-unfilled mission scaffold, so its stored title is the
 * literal `<Title> (task-NNNN)` placeholder from `templates/mission-scaffold.md`.
 *
 * Before the repair `composeBoardProjection` replaced the whole Markdown
 * mission with the stored aggregate, so every persisted mission card rendered
 * the placeholder instead of its title.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import React from 'react';
import { renderToString } from 'ink';

import { SqliteDatabaseAdapter } from '../src/adapters/sqlite/database-adapter.js';
import { SqliteMigrationRunner, loadDefaultMigrations } from '../src/adapters/sqlite/migration-runner.js';
import { SqliteMissionStore } from '../src/adapters/sqlite/mission-store.js';
import { composeBoardProjection } from '../src/composition/board-projection.js';
import { MissionCard } from '../src/interfaces/tui/mission-card.js';
import { missionId, type Mission, type MissionStatus } from '../src/domain/mission.js';
import { repositoryId } from '../src/domain/repository.js';

const TITLE = 'Restore title visibility';
const PLACEHOLDER = '<Title>';
const CLOSED_AT = '2026-08-29T12:00:00.000Z';

/** One mission per board lane the regression was reported on. */
const LANES = [
  { id: 'task-4401', backlogStatus: 'active', domainStatus: 'active', lane: 'active', completed: false },
  { id: 'task-4402', backlogStatus: 'review', domainStatus: 'review', lane: 'review', completed: false },
  { id: 'task-4403', backlogStatus: 'approved', domainStatus: 'integration', lane: 'integration', completed: false },
  { id: 'task-4404', backlogStatus: 'done', domainStatus: 'done', lane: 'done', completed: true },
] as const;

/** The mission aggregate as `px draft` intake records it: scaffold title, real lifecycle. */
function persistedMission(id: string, status: MissionStatus, repository: ReturnType<typeof repositoryId>): Mission {
  return {
    id: missionId(id),
    repositoryId: repository,
    title: `${PLACEHOLDER} (${id})`,
    labels: [],
    assignee: null,
    checkpoints: [],
    review: null,
    netEngineeringLines: null,
    status,
    closedAt: null,
  } as Mission;
}

function writeTask(root: string, id: string, status: string, completed: boolean): void {
  const dir = path.join(root, 'backlog', completed ? 'completed' : 'tasks');
  const file = path.join(dir, `${id} - restore-title-visibility.md`);
  fs.mkdirSync(dir, { recursive: true });
  const closed = completed ? `closedAt: '${CLOSED_AT}'\n` : '';
  fs.writeFileSync(file, `---\nid: ${id.toUpperCase()}\ntitle: ${TITLE}\nstatus: ${status}\n${closed}---\n`, 'utf8');
}

async function openStore(databasePath: string): Promise<{ database: SqliteDatabaseAdapter; store: SqliteMissionStore }> {
  const database = new SqliteDatabaseAdapter();
  await database.open({ path: databasePath });
  await new SqliteMigrationRunner(database).applyPending(loadDefaultMigrations());
  return { database, store: new SqliteMissionStore(database) };
}

test('board cards render the backlog title, not the mission scaffold placeholder, on every lane', async () => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'task-2441-repository-')));
  const home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'task-2441-home-')));
  const oldHome = process.env.PARALLIX_HOME;
  const repository = repositoryId(path.basename(root));
  const databasePath = path.join(home, 'parallix.db');
  process.env.PARALLIX_HOME = home;

  try {
    childProcess.spawnSync('git', ['init'], { cwd: root, encoding: 'utf8' });
    childProcess.spawnSync('git', ['config', 'user.name', 'Task 2441'], { cwd: root, encoding: 'utf8' });
    childProcess.spawnSync('git', ['config', 'user.email', 'task-2441@example.test'], { cwd: root, encoding: 'utf8' });
    for (const lane of LANES) { writeTask(root, lane.id, lane.backlogStatus, lane.completed); }
    childProcess.spawnSync('git', ['add', '.'], { cwd: root, encoding: 'utf8' });
    childProcess.spawnSync('git', ['commit', '-m', 'seed tasks'], { cwd: root, encoding: 'utf8' });

    const seeded = await openStore(databasePath);
    for (const lane of LANES) {
      await seeded.store.save(persistedMission(lane.id, lane.domainStatus, repository), null);
    }
    await seeded.database.close();

    const opened = await openStore(databasePath);
    try {
      const board = composeBoardProjection({
        rootDir: root,
        missionStore: opened.store,
        repositoryId: repository,
        blocklistRepo: { async findAll() { return []; } } as never,
        historyRepo: { async findAll() { return []; }, async findByType() { return []; } } as never,
        laneEventRepo: { async findAll() { return []; } } as never,
        usageRepo: { async findAll() { return []; } } as never,
        knownAgentFamilies: [],
      });
      const projection = await board.builder.build();
      const cards = new Map(projection.stages.flatMap((stage) => stage.cards.map((card) => [String(card.id), card])));

      for (const lane of LANES) {
        const card = cards.get(lane.id);
        assert.ok(card, `${lane.id} must be on the board (${lane.lane} lane)`);
        assert.equal(card.lane, lane.lane, `${lane.id} lane`);
        assert.equal(card.title, TITLE, `${lane.id} card title comes from the Backlog task`);

        const output = await renderToString(
          React.createElement(MissionCard, { card, width: 60 } as never),
          { columns: 80 },
        );
        assert.ok(output.includes(TITLE), `${lane.lane} card must render "${TITLE}"; got:\n${output}`);
        assert.ok(!output.includes(PLACEHOLDER), `${lane.lane} card must not render "${PLACEHOLDER}"; got:\n${output}`);
        assert.ok(output.includes(lane.id), `${lane.lane} card must still render its slug`);
      }
    } finally {
      await opened.database.close();
    }
  } finally {
    if (oldHome === undefined) { delete process.env.PARALLIX_HOME; } else { process.env.PARALLIX_HOME = oldHome; }
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(home, { recursive: true, force: true });
  }
});
