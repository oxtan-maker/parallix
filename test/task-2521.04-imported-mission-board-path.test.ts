import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { mkdtemp } from './helpers/temp-dir.js';

import {
  importLegacyMissions,
  type MissionImportServices,
} from '../src/adapters/backlog/legacy-mission-import.js';
import { MissionIntakeService } from '../src/application/mission-intake-service.js';
import { MissionBriefService } from '../src/application/mission-brief-service.js';
import { MissionLifecycleService } from '../src/application/mission-lifecycle-service.js';
import {
  missionVersion,
  type MissionTransitionStore,
  type MissionVersion,
} from '../src/application/domain-ports.js';
import {
  boardLane,
  projectMissionCard,
  wipCounts,
  type MissionOperationalFacts,
} from '../src/application/projections/mission-board.js';
import { buildBoardStage } from '../src/application/projections/board.js';
import type { LaneTransitionEvent } from '../src/domain/board-event.js';
import type { Mission, MissionId } from '../src/domain/mission.js';
import { repositoryId } from '../src/domain/repository.js';

const REPOSITORY = repositoryId('parallix');

/** The operational facts a board read supplies when nothing else is observed. */
const NO_FACTS: MissionOperationalFacts = {
  latestGate: 'unknown',
  liveSession: null,
  reviewApproval: null,
  currentWork: null,
  blockingReason: null,
  flags: [],
};

class RecordingStore implements MissionTransitionStore {
  readonly missions = new Map<string, { mission: Mission; version: MissionVersion }>();
  readonly events: LaneTransitionEvent[] = [];

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
    event: LaneTransitionEvent,
  ) {
    const version = await this.save(mission, expectedVersion);
    this.events.push(event);
    return version;
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

function frontmatter(fields: Readonly<Record<string, string>>): string {
  return `---\n${Object.entries(fields).map(([k, v]) => `${k}: ${v}`).join('\n')}\n---\n\nBody.\n`;
}

function workspace(files: readonly { name: string; body: string }[]): string {
    const root = mkdtemp('task-2521.04-board-');
  const dir = path.join(root, 'backlog', 'tasks');
  fs.mkdirSync(dir, { recursive: true });
  for (const file of files) { fs.writeFileSync(path.join(dir, file.name), file.body); }
  return root;
}

const repoRoot = path.resolve(import.meta.dirname, '..');

describe('imported Missions use the existing board and lifecycle path', () => {
  it('an imported Mission projects into the existing board lanes', async () => {
    const root = workspace([
      { name: 'a.md', body: frontmatter({ id: 'TASK-9101', title: 'Backlog record', status: 'open' }) },
      { name: 'b.md', body: frontmatter({ id: 'TASK-9102', title: 'Second record', status: 'backlog' }) },
    ]);
    const store = new RecordingStore();
    await importLegacyMissions(services(store), { rootDir: root, commit: '0123456789abcdef0123456789abcdef01234567' });

    const cards = [...store.missions.values()]
      .map(held => projectMissionCard(held.mission, NO_FACTS));

    // Import reaches intake only, so both records land in the existing backlog
    // lane — the board vocabulary, not an import-only lane.
    assert.deepEqual(
      cards.map(card => [card.id, card.lane]).sort(),
      [['task-9101', 'backlog'], ['task-9102', 'backlog']],
    );
    const counts = wipCounts(cards);
    assert.equal(counts.backlog, 2);
    assert.equal(counts.refined + counts.active + counts.review + counts.integration + counts.done, 0);

    const stage = buildBoardStage('backlog', cards.filter(card => card.lane === 'backlog'));
    assert.equal(stage.lane, 'backlog');
    assert.deepEqual(stage.cards.map(card => card.id).sort(), ['task-9101', 'task-9102']);
  });

  it('an imported Mission keeps the raw legacy status the board shows', async () => {
    const root = workspace([
      { name: 'a.md', body: frontmatter({ id: 'TASK-9104', title: 'Open record', status: 'backlog' }) },
    ]);
    const store = new RecordingStore();
    await importLegacyMissions(services(store), { rootDir: root, commit: '0123456789abcdef0123456789abcdef01234567' });

    const card = projectMissionCard(store.missions.get('task-9104')!.mission, NO_FACTS);
    assert.equal(card.lane, 'backlog');
    assert.equal(card.rawStatus, 'backlog', 'the legacy vocabulary survives import');
  });

  it('an imported Mission moves on through the normal lifecycle service', async () => {
    const root = workspace([
      { name: 'a.md', body: frontmatter({ id: 'TASK-9105', title: 'Open record', status: 'open' }) },
    ]);
    const store = new RecordingStore();
    await importLegacyMissions(services(store), { rootDir: root, commit: '0123456789abcdef0123456789abcdef01234567' });

    // The imported Mission is ordinary backlog material: the same lifecycle
    // service the normal path uses refines it, with no importer involvement.
    const refined = await new MissionLifecycleService(store).transition({
      operationId: 'normal-refine',
      missionId: 'task-9105' as MissionId,
      command: { type: 'refine' },
      actor: 'claude' as never,
      occurredAt: '2026-09-18T00:00:00.000Z',
      capabilities: new Set(['mission:transition'] as const),
    });

    // It is refused for the one reason every backlog Mission is refused: no
    // recorded contract yet. The importer neither supplies one nor bypasses the
    // check, so an imported Mission is drafted exactly like a local one.
    assert.equal(refined.status, 'failed');
    assert.match(String(refined.error?.message), /brief|contract|goal/i);
    assert.equal(boardLane(store.missions.get('task-9105')!.mission), 'backlog');
  });

  it('the legacy importer is reachable only from the px import-legacy command', () => {
    const callers = fs.readdirSync(path.join(repoRoot, 'src'), { recursive: true, encoding: 'utf8' })
      .filter(entry => entry.endsWith('.ts'))
      .filter(entry => {
        const content = fs.readFileSync(path.join(repoRoot, 'src', entry), 'utf8');
        return /\bimportLegacyMissions\b/.test(content);
      })
      .sort();

    assert.deepEqual(callers, [
      path.join('adapters', 'backlog', 'legacy-mission-import.ts'),
      path.join('composition', 'create-cli.ts'),
    ], 'only the importer itself and the CLI registration reference the importer');

    // And inside the registration it is bound to `import-legacy` alone: no
    // draft, active, board, review, or integrate path can reach it.
    const registry = fs.readFileSync(path.join(repoRoot, 'src', 'composition', 'create-cli.ts'), 'utf8');
    const binding = /'import-legacy': \(args\) => withGraph\(services => \{[\s\S]*?\n {4}\}\),/.exec(registry);
    assert.ok(binding, 'the import-legacy registry entry exists');
    assert.equal(
      (registry.match(/importLegacyMissions\(/g) ?? []).length,
      1,
      'the importer is invoked exactly once in the command registry',
    );
    assert.ok(binding[0].includes('importLegacyMissions('), 'that single call is the import-legacy binding');
  });

  it('no normal command module imports the legacy importer', () => {
    const normalCommands = ['draft.ts', 'active.ts', 'review.ts', 'integrate.ts', 'status.ts'];
    for (const file of normalCommands) {
      const full = path.join(repoRoot, 'src', 'interfaces', 'cli', file);
      if (!fs.existsSync(full)) { continue; }
      const content = fs.readFileSync(full, 'utf8');
      assert.ok(
        !content.includes('legacy-mission-import'),
        `${file} does not import the legacy importer`,
      );
    }
  });
});
