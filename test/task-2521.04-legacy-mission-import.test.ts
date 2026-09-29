import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { mkdtemp } from './helpers/temp-dir.js';

import {
  importLegacyMissions,
  LEGACY_TASK_SOURCE,
  type MissionImportServices,
} from '../src/adapters/backlog/legacy-mission-import.js';
import { parseLegacyMissionDocument } from '../src/adapters/backlog/legacy-mission-document.js';
import { MissionIntakeService } from '../src/application/mission-intake-service.js';
import { MissionBriefService } from '../src/application/mission-brief-service.js';
import { failure } from '../src/application/contracts.js';
import type { MissionDependenciesResult } from '../src/application/mission-brief-service.js';
import {
  missionVersion,
  type MissionTransitionStore,
  type MissionVersion,
} from '../src/application/domain-ports.js';
import type { LaneTransitionEvent } from '../src/domain/board-event.js';
import { agentFamily } from '../src/domain/agents.js';
import { missionLabel, type Mission, type MissionId } from '../src/domain/mission.js';
import { repositoryId } from '../src/domain/repository.js';

const REPOSITORY = repositoryId('parallix');

/** A stand-in for the commit the legacy files were read at. */
const COMMIT = '0123456789abcdef0123456789abcdef01234567';

/**
 * In-memory `MissionTransitionStore` with the real compare-and-swap contract,
 * so the importer exercises the production `MissionIntakeService` and
 * `MissionLifecycleService` rather than a stand-in write path.
 */
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

interface LegacyFile {
  readonly dir?: 'tasks' | 'completed' | 'archive';
  readonly name: string;
  readonly body: string;
}

function workspace(files: readonly LegacyFile[]): string {
  const root = mkdtemp('task-2521.04-');
  for (const file of files) {
    const dir = path.join(root, 'backlog', file.dir ?? 'tasks');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, file.name), file.body);
  }
  return root;
}

/** A block-style frontmatter list, the form the legacy files wrote. */
function listField(field: string, entries: readonly string[]): string {
  return `${field}:\n${entries.map(entry => `  - ${entry}`).join('\n')}`;
}

function frontmatter(fields: Readonly<Record<string, string>>): string {
  const lines = Object.entries(fields).map(([key, value]) => `${key}: ${value}`);
  return `---\n${lines.join('\n')}\n---\n\nBody text.\n`;
}

const OPEN_TASK = frontmatter({
  id: 'TASK-9001',
  title: 'Open legacy record',
  status: 'open',
  labels: '[ai_sdlc]',
});

it('does not turn a native landed Mission into a closed Mission during import', async () => {
  const root = workspace([]);
  const store = new RecordingStore();
  const mission = {
    id: 'task-9007' as MissionId, repositoryId: REPOSITORY, title: 'Landed, closeout pending',
    labels: [missionLabel('ai_sdlc')], assignee: null, checkpoints: [], review: null,
    netEngineeringLines: null, status: 'done' as const, closedAt: null,
  };
  store.missions.set(mission.id, { mission, version: missionVersion(1) });
  let historyReads = 0;
  const withHistory = Object.assign(store, {
    loadByRepository: async () => [mission],
    findTransitions: async () => { historyReads++; return [{ trigger: 'integrate', toStatus: 'done', occurredAt: '2026-09-27T20:50:33Z' }]; },
  });

  const report = await importLegacyMissions(services(withHistory), { rootDir: root, commit: COMMIT });
  assert.equal(report.importable, 0);
  assert.equal(historyReads, 0);
  assert.equal(store.missions.get(mission.id)?.mission.closedAt, null);
});

it('parses bounded historical contract fields without treating templates as current data', () => {
  const parsed = parseLegacyMissionDocument(`## Goal\nShip the fix.\n## Why Now\nThe old path fails.\n## Scope\n- Fix import.\n## Out of Scope\n- Rewrite review.\n## Success Criteria\n> Falsifiability rule\n- Import preserves old text.\n## Checkpoints\n- CP 1: Verify import.\n## Gates\n- [ ] npm test\n`);
  assert.equal(parsed.brief?.goal, 'Ship the fix.');
  assert.deepEqual(parsed.successCriteria, ['Import preserves old text.']);
  assert.deepEqual(parsed.declaredGates, ['npm test']);
  assert.deepEqual(parsed.checkpoints, [{ name: 'CP-1', description: 'Verify import.' }]);
  assert.equal(parseLegacyMissionDocument('## Goal\n<Goal>\n## Why Now\n<Why Now>').brief, undefined);
  assert.equal(parseLegacyMissionDocument('## Goal\n<Goal>\n## Why Now\n<Why Now>\n## Gates\n- [ ] ./scripts/verify-local.sh docs').declaredGates, undefined);
  assert.equal(parseLegacyMissionDocument('## Success Criteria\n- Good.\nUnowned prose.').successCriteria, undefined);
});

it('recognizes nonempty placeholders while accepting unmatched angle brackets', () => {
  for (const value of ['<pending>', '<<>', '<line\nbreak>', '<> <pending>']) {
    assert.equal(parseLegacyMissionDocument(`## Success Criteria\n- ${value}`).successCriteria, undefined);
  }
  for (const value of ['<>', '<>text>', 'text > before <']) {
    assert.deepEqual(parseLegacyMissionDocument(`## Gates\n- [ ] ${value}`).declaredGates, [value]);
  }
  const large = parseLegacyMissionDocument(`## Success Criteria\n- ${'<'.repeat(100_000)}\n## Gates\n- [ ] npm test`);
  assert.equal(large.successCriteria, undefined);
  assert.deepEqual(large.declaredGates, ['npm test']);
});

it('imports missing typed fields from a historical mission document once', async () => {
  const root = workspace([{ name: 'task-9001 - Open.md', body: OPEN_TASK }]);
  const directory = path.join(root, 'missions', 'task-9001');
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, 'MISSION.md'), `## Goal\nShip the fix.\n## Why Now\nOld path fails.\n## Scope\n- Fix import.\n## Out of Scope\n- Rewrite review.\n## Success Criteria\n- Old text remains queryable.\n## Checkpoints\n- CP 1: Verify import.\n## Gates\n- [ ] npm test\n`);
  const store = new RecordingStore();
  const first = await importLegacyMissions(services(store), { rootDir: root, commit: COMMIT });
  assert.equal(first.conflicting, 0);
  const mission = store.missions.get('task-9001')?.mission;
  assert.equal(mission?.brief?.goal, 'Ship the fix.');
  assert.deepEqual(mission?.successCriteria, ['Old text remains queryable.']);
  assert.deepEqual(mission?.declaredGates, ['npm test']);
  assert.equal(mission?.checkpoints[0]?.name, 'CP-1');
  assert.equal((await importLegacyMissions(services(store), { rootDir: root, commit: COMMIT })).importable, 0);
});

describe('legacy Backlog import into the existing Mission aggregate', () => {
  it('a dry run reads the legacy locations and writes no Mission rows', async () => {
    const root = workspace([{ name: 'task-9001 - Open.md', body: OPEN_TASK }]);
    const store = new RecordingStore();

    const report = await importLegacyMissions(services(store), { rootDir: root, dryRun: true, commit: COMMIT });

    assert.equal(report.dryRun, true);
    assert.equal(report.discovered, 1);
    assert.equal(report.importable, 1);
    assert.equal(store.missions.size, 0);
    assert.equal(store.events.length, 0);
  });

  it('a real import materializes the record through intake with source traceability', async () => {
    const root = workspace([{ name: 'task-9001 - Open.md', body: OPEN_TASK }]);
    const store = new RecordingStore();

    const report = await importLegacyMissions(services(store), { rootDir: root, commit: COMMIT });

    assert.equal(report.importable, 1);
    assert.deepEqual(report.imported, ['task-9001']);
    const held = store.missions.get('task-9001');
    assert.ok(held, 'the importer materialized a Mission');
    assert.equal(held.mission.title, 'Open legacy record');
    assert.equal(held.mission.status, 'backlog');
    assert.equal(held.mission.rawStatus, 'open');
    assert.equal(held.mission.repositoryId, REPOSITORY);
    assert.equal(held.mission.externalTaskRef?.source, LEGACY_TASK_SOURCE);
    assert.equal(held.mission.externalTaskRef?.id, 'TASK-9001');
    // The locator pins the source path to the commit it was read at, so
    // TASK-2521.07 can delete the file and `git show` still recovers its text.
    assert.equal(
      held.mission.externalTaskRef?.url,
      `${path.join('backlog', 'tasks', 'task-9001 - Open.md')}@${COMMIT}`,
    );
    // Intake is a lifecycle step: entry into `backlog` records its lane event.
    assert.deepEqual(store.events.map(event => event.to), ['backlog']);
  });

  it('repeating an unchanged import creates no duplicate Mission', async () => {
    const root = workspace([{ name: 'task-9001 - Open.md', body: OPEN_TASK }]);
    const store = new RecordingStore();

    await importLegacyMissions(services(store), { rootDir: root, commit: COMMIT });
    const second = await importLegacyMissions(services(store), { rootDir: root, commit: COMMIT });

    assert.equal(second.alreadyMaterialized, 1);
    assert.equal(second.importable, 0);
    assert.equal(second.conflicting, 0);
    assert.equal(store.missions.size, 1);
    assert.equal(store.events.length, 1, 'the rerun emitted no further lane events');
  });

  it('a legacy record already advanced by the normal lifecycle stays already materialized', async () => {
    const root = workspace([{ name: 'task-9001 - Open.md', body: OPEN_TASK }]);
    const store = new RecordingStore();
    await importLegacyMissions(services(store), { rootDir: root, commit: COMMIT });

    // The operator refines and activates the imported Mission through the
    // normal path; status and assignee are Parallix authority, not source drift.
    const held = store.missions.get('task-9001')!;
    store.missions.set('task-9001', {
      mission: { ...held.mission, status: 'active', assignee: agentFamily('claude'), closedAt: null },
      version: held.version,
    });

    const report = await importLegacyMissions(services(store), { rootDir: root, commit: COMMIT });

    assert.equal(report.alreadyMaterialized, 1);
    assert.equal(report.conflicting, 0);
    assert.equal(store.missions.get('task-9001')?.mission.status, 'active');
  });

  it('imports a historical refined record without inventing a contract', async () => {
    const root = workspace([{
      name: 'task-9002 - Ready.md',
      body: frontmatter({ id: 'TASK-9002', title: 'Ready record', status: 'ready' }),
    }]);
    const store = new RecordingStore();

    const report = await importLegacyMissions(services(store), { rootDir: root, commit: COMMIT });

    assert.equal(report.importable, 1);
    assert.equal(report.deferred, 0);
    assert.equal(report.conflicting, 0);
    assert.equal(store.missions.get('task-9002')?.mission.status, 'refined');
    assert.equal(store.missions.get('task-9002')?.mission.brief, null);
  });

  it('reports an active legacy record as needing a recorded contract', async () => {
    const root = workspace([{
      name: 'task-9003 - Active.md',
      body: frontmatter({
        id: 'TASK-9003', title: 'Active record', status: 'active', assignee: 'claude',
      }),
    }]);
    const store = new RecordingStore();

    const report = await importLegacyMissions(services(store), { rootDir: root, commit: COMMIT });

    assert.equal(report.importable, 0);
    assert.equal(report.deferred, 1);
    assert.match(report.deferredRecords[0], /TASK-9003: legacy lane "active" needs a recorded contract/);
    assert.equal(store.missions.size, 0);
  });

  it('a dry run categorizes backlog, refined and done records without writing', async () => {
    const root = workspace([
      { name: 'task-9001 - Open.md', body: OPEN_TASK },
      {
        name: 'task-9002 - Ready.md',
        body: frontmatter({ id: 'TASK-9002', title: 'Ready record', status: 'ready' }),
      },
      {
        dir: 'completed',
        name: 'task-9004 - Done.md',
        body: frontmatter({ id: 'TASK-9004', title: 'Completed record', status: 'done' }),
      },
    ]);
    const store = new RecordingStore();

    const report = await importLegacyMissions(
      services(store), { rootDir: root, dryRun: true, commit: COMMIT },
    );

    assert.equal(report.discovered, 3);
    assert.equal(report.importable, 2);
    assert.equal(report.deferred, 1);
    assert.equal(report.conflicting, 0);
    assert.equal(store.missions.size, 0);
  });

  it('a moved source file and a newer commit stay already materialized', async () => {
    const root = workspace([{ name: 'task-9001 - Open.md', body: OPEN_TASK }]);
    const store = new RecordingStore();
    await importLegacyMissions(services(store), { rootDir: root, commit: COMMIT });

    // TASK-2521.06 moves accepted records to `completed/`, and every later
    // import reads a newer commit. The locator is not the identity, so neither
    // reads as a conflict.
    const tasks = path.join(root, 'backlog', 'tasks');
    const completed = path.join(root, 'backlog', 'completed');
    fs.mkdirSync(completed, { recursive: true });
    fs.renameSync(
      path.join(tasks, 'task-9001 - Open.md'),
      path.join(completed, 'task-9001 - Open.md'),
    );
    const report = await importLegacyMissions(services(store), {
      rootDir: root,
      commit: 'fedcba9876543210fedcba9876543210fedcba98',
    });

    assert.equal(report.alreadyMaterialized, 1);
    assert.equal(report.conflicting, 0);
    assert.equal(store.missions.size, 1);
  });

  it('requires a source-backed date for a historical done record', async () => {
    const root = workspace([{
      dir: 'completed',
      name: 'task-9004 - Done.md',
      body: frontmatter({ id: 'TASK-9004', title: 'Completed record', status: 'done' }),
    }]);
    const store = new RecordingStore();

    const report = await importLegacyMissions(services(store), { rootDir: root, commit: COMMIT });

    assert.equal(report.importable, 0);
    assert.equal(report.deferred, 1);
    assert.equal(report.conflicting, 0);
    assert.match(
      report.deferredRecords[0],
      /TASK-9004: completed lane has no source-backed closure date/,
    );
    assert.equal(store.missions.size, 0);
  });

  it('reports duplicate legacy copies that disagree without choosing a winner', async () => {
    const root = workspace([
      { name: 'task-9005 - A.md', body: frontmatter({ id: 'TASK-9005', title: 'First', status: 'open' }) },
      {
        dir: 'completed',
        name: 'task-9005 - B.md',
        body: frontmatter({ id: 'TASK-9005', title: 'Second', status: 'open' }),
      },
    ]);
    const store = new RecordingStore();

    const report = await importLegacyMissions(services(store), { rootDir: root, commit: COMMIT });

    assert.equal(report.discovered, 2);
    assert.equal(report.conflicting, 1);
    assert.match(report.conflicts[0], /2 historical copies disagree/);
    assert.equal(store.missions.size, 0);
  });

  it('accepts duplicate copies that differ only in an unrepresented field', async () => {
    const root = workspace([
      {
        name: 'task-9006 - A.md',
        body: frontmatter({ id: 'TASK-9006', title: 'Same', status: 'open', priority: 'high' }),
      },
      {
        dir: 'completed',
        name: 'task-9006 - B.md',
        body: frontmatter({ id: 'TASK-9006', title: 'Same', status: 'open', priority: 'low' }),
      },
    ]);
    const store = new RecordingStore();

    const report = await importLegacyMissions(services(store), { rootDir: root, commit: COMMIT });

    assert.equal(report.conflicting, 0);
    assert.equal(report.importable, 1);
  });

  it('uses the completed copy when an archived copy has the same identity and title', async () => {
    const root = workspace([
      { dir: 'archive', name: 'task-9009 - Same.md',
        body: frontmatter({ id: 'TASK-9009', title: 'Same', status: 'backlog' }) },
      { dir: 'completed', name: 'task-9009 - Same.md',
        body: frontmatter({ id: 'TASK-9009', title: 'Same', status: 'done' }) },
    ]);
    const store = new RecordingStore();
    const report = await importLegacyMissions(services(store), { rootDir: root, dryRun: true, commit: COMMIT });
    assert.equal(report.conflicting, 0);
    assert.match(report.deferredRecords[0], /source-backed closure date/);
  });

  it('reports malformed identity and unmappable status without writing a Mission', async () => {
    const root = workspace([
      { name: 'no-id.md', body: '---\ntitle: Missing id\n---\n' },
      { name: 'bad-slug.md', body: frontmatter({ id: 'NOTASLUG', title: 'No slug', status: 'open' }) },
      {
        name: 'task-9007.md',
        body: frontmatter({ id: 'TASK-9007', title: 'Bad status', status: 'quantum' }),
      },
      { name: 'task-9008.md', body: frontmatter({ id: 'TASK-9008', title: '', status: 'open' }) },
    ]);
    const store = new RecordingStore();

    const report = await importLegacyMissions(services(store), { rootDir: root, commit: COMMIT });

    assert.equal(report.importable, 0);
    assert.equal(report.conflicting, 4);
    assert.ok(report.conflicts.some(line => /no task id in frontmatter/.test(line)));
    assert.ok(report.conflicts.some(line => /NOTASLUG: identity is not a valid Mission slug/.test(line)));
    assert.ok(report.conflicts.some(line => /TASK-9007: status "quantum" has no Mission lifecycle mapping/.test(line)));
    assert.ok(report.conflicts.some(line => /TASK-9008: no title to import/.test(line)));
    assert.equal(store.missions.size, 0);
  });

  it('reports an existing Mission that disagrees and leaves it unchanged', async () => {
    const root = workspace([{ name: 'task-9001 - Open.md', body: OPEN_TASK }]);
    const store = new RecordingStore();
    await importLegacyMissions(services(store), { rootDir: root, commit: COMMIT });

    fs.writeFileSync(
      path.join(root, 'backlog', 'tasks', 'task-9001 - Open.md'),
      frontmatter({ id: 'TASK-9001', title: 'Retitled after import', status: 'open', labels: '[ai_sdlc]' }),
    );
    const report = await importLegacyMissions(services(store), { rootDir: root, commit: COMMIT });

    assert.equal(report.conflicting, 1);
    assert.match(report.conflicts[0], /existing Mission disagrees with the legacy source material/);
    assert.equal(store.missions.get('task-9001')?.mission.title, 'Open legacy record');
  });

  it('pins matching native Missions to their legacy body without replacing current state', async () => {
    const root = workspace([{ name: 'task-9001 - Open.md', body: OPEN_TASK }]);
    const store = new RecordingStore();
    store.missions.set('task-9001', {
      mission: {
        id: 'task-9001' as MissionId, repositoryId: REPOSITORY, title: 'Open legacy record',
        labels: [missionLabel('ai_sdlc')], assignee: null, checkpoints: [], review: null, netEngineeringLines: null,
        status: 'backlog', closedAt: null,
      },
      version: missionVersion(1),
    });

    const dryRun = await importLegacyMissions(services(store), { rootDir: root, dryRun: true, commit: COMMIT });
    assert.equal(dryRun.importable, 1);
    assert.equal(store.missions.get('task-9001')?.mission.externalTaskRef, undefined);

    const report = await importLegacyMissions(services(store), { rootDir: root, commit: COMMIT });

    assert.equal(report.importable, 1);
    assert.equal(report.conflicting, 0);
    assert.equal(store.missions.get('task-9001')?.mission.externalTaskRef?.url,
      `backlog/tasks/task-9001 - Open.md@${COMMIT}`);
    const second = await importLegacyMissions(services(store), { rootDir: root, dryRun: true, commit: COMMIT });
    assert.equal(second.importable, 0);
    assert.equal(second.alreadyMaterialized, 1);
  });

  it('keeps current Mission labels when old task labels differ', async () => {
    const root = workspace([{ name: 'task-9001 - Open.md', body: OPEN_TASK }]);
    const store = new RecordingStore();
    store.missions.set('task-9001', {
      mission: {
        id: 'task-9001' as MissionId, repositoryId: REPOSITORY, title: 'Open legacy record',
        labels: [missionLabel('current')], assignee: null, checkpoints: [], review: null,
        netEngineeringLines: null, status: 'backlog', closedAt: null,
      }, version: missionVersion(1),
    });
    const report = await importLegacyMissions(services(store), { rootDir: root, commit: COMMIT });
    assert.equal(report.conflicting, 0);
    assert.deepEqual(store.missions.get('task-9001')?.mission.labels, [missionLabel('current')]);
    assert.equal(store.missions.get('task-9001')?.mission.externalTaskRef?.id, 'TASK-9001');
  });

  it('never attaches a task body to a Mission owned by another repository', async () => {
    const root = workspace([{ name: 'task-9001 - Open.md', body: OPEN_TASK }]);
    const store = new RecordingStore();
    store.missions.set('task-9001', {
      mission: {
        id: 'task-9001' as MissionId, repositoryId: repositoryId('fixture'), title: 'Fixture',
        labels: [], assignee: null, checkpoints: [], review: null, netEngineeringLines: null,
        status: 'active', closedAt: null,
      }, version: missionVersion(1),
    });
    const report = await importLegacyMissions(services(store), { rootDir: root, commit: COMMIT });
    assert.match(report.conflicts[0], /belongs to repository fixture/);
    assert.equal(store.missions.get('task-9001')?.mission.externalTaskRef, undefined);
  });

  it('repairs legacy placeholder title and encoded labels while pinning the source', async () => {
    const root = workspace([{ name: 'task-9001 - Open.md', body: OPEN_TASK }]);
    const store = new RecordingStore();
    store.missions.set('task-9001', {
      mission: {
        id: 'task-9001' as MissionId, repositoryId: REPOSITORY, title: 'task-9001',
        labels: [missionLabel('[ai_sdlc]')], assignee: null, checkpoints: [], review: null,
        netEngineeringLines: null, status: 'backlog', closedAt: null,
      },
      version: missionVersion(1),
    });

    const dryRun = await importLegacyMissions(services(store), { rootDir: root, dryRun: true, commit: COMMIT });
    assert.equal(dryRun.importable, 1);
    await importLegacyMissions(services(store), { rootDir: root, commit: COMMIT });
    assert.equal(store.missions.get('task-9001')?.mission.title, 'Open legacy record');
    assert.deepEqual(store.missions.get('task-9001')?.mission.labels, [missionLabel('ai_sdlc')]);
    assert.equal(store.missions.get('task-9001')?.mission.externalTaskRef?.id, 'TASK-9001');
  });

  it('repairs folded and quoted YAML titles recorded literally by old intake', async () => {
    for (const storedTitle of ['>-', "'Open legacy record'"]) {
      const root = workspace([{ name: 'task-9001 - Open.md', body: OPEN_TASK }]);
      const store = new RecordingStore();
      store.missions.set('task-9001', {
        mission: {
          id: 'task-9001' as MissionId, repositoryId: REPOSITORY, title: storedTitle,
          labels: [missionLabel('ai_sdlc')], assignee: null, checkpoints: [], review: null,
          netEngineeringLines: null, status: 'backlog', closedAt: null,
        },
        version: missionVersion(1),
      });
      const report = await importLegacyMissions(services(store), { rootDir: root, commit: COMMIT });
      assert.equal(report.conflicting, 0);
      assert.equal(store.missions.get('task-9001')?.mission.title, 'Open legacy record');
    }
  });

  it('reports a pre-existing Mission that disagrees without a source trace', async () => {
    const root = workspace([{ name: 'task-9001 - Open.md', body: OPEN_TASK }]);
    const store = new RecordingStore();
    store.missions.set('task-9001', {
      mission: {
        id: 'task-9001' as MissionId, repositoryId: REPOSITORY, title: 'Locally created',
        labels: [], assignee: null, checkpoints: [], review: null, netEngineeringLines: null,
        status: 'backlog', closedAt: null,
      },
      version: missionVersion(1),
    });

    const report = await importLegacyMissions(services(store), { rootDir: root, commit: COMMIT });

    assert.equal(report.conflicting, 1);
    assert.match(report.conflicts[0], /existing Mission disagrees with the legacy source material/);
    assert.equal(store.missions.get('task-9001')?.mission.title, 'Locally created');
  });

  it('records a legacy dependency that resolves to a Mission', async () => {
    const root = workspace([
      { name: 'task-9001 - Open.md', body: OPEN_TASK },
      {
        name: 'task-9010 - Dependent.md',
        body: `---\nid: TASK-9010\ntitle: Dependent record\nstatus: open\n${listField('dependencies', ['TASK-9001'])}\n---\n\nBody.\n`,
      },
    ]);
    const store = new RecordingStore();

    const report = await importLegacyMissions(services(store), { rootDir: root, commit: COMMIT });

    // TASK-9001 sorts first, so the Mission it names exists by the time the
    // dependent record is imported.
    assert.equal(report.importable, 2);
    assert.deepEqual(report.unresolvedDependencies, []);
    assert.deepEqual(store.missions.get('task-9010')?.mission.dependencies, ['task-9001']);
  });

  it('reads an inline dependency list as well as a block one', async () => {
    const root = workspace([
      { name: 'task-9001 - Open.md', body: OPEN_TASK },
      {
        name: 'task-9013 - Inline.md',
        body: frontmatter({
          id: 'TASK-9013', title: 'Inline dependencies', status: 'open',
          dependencies: '[TASK-9001, "TASK-9014"]',
        }),
      },
      {
        name: 'task-9014 - Later.md',
        body: frontmatter({ id: 'TASK-9014', title: 'Later record', status: 'open' }),
      },
    ]);
    const store = new RecordingStore();

    const report = await importLegacyMissions(services(store), { rootDir: root, commit: COMMIT });

    assert.deepEqual(report.unresolvedDependencies, []);
    assert.deepEqual(
      store.missions.get('task-9013')?.mission.dependencies,
      ['task-9001', 'task-9014'],
    );
  });

  it('records a dependency on a record imported later in the same run', async () => {
    // TASK-9015 sorts before the TASK-9016 it depends on, so a single pass that
    // resolved during import would report it unresolved and never retry: the
    // rerun sees TASK-9015 as already materialized.
    const root = workspace([
      {
        name: 'task-9015 - First.md',
        body: `---\nid: TASK-9015\ntitle: First record\nstatus: open\n${listField('dependencies', ['TASK-9016'])}\n---\n\nBody.\n`,
      },
      { name: 'task-9016 - Second.md', body: frontmatter({ id: 'TASK-9016', title: 'Second record', status: 'open' }) },
    ]);
    const store = new RecordingStore();

    const report = await importLegacyMissions(services(store), { rootDir: root, commit: COMMIT });

    assert.deepEqual(report.unresolvedDependencies, []);
    assert.deepEqual(store.missions.get('task-9015')?.mission.dependencies, ['task-9016']);
  });

  it('fills in a dependency on a rerun once the Mission it names exists', async () => {
    const dependent = {
      name: 'task-9017 - Dependent.md',
      body: `---\nid: TASK-9017\ntitle: Dependent record\nstatus: open\n${listField('dependencies', ['TASK-9018'])}\n---\n\nBody.\n`,
    };
    const root = workspace([dependent]);
    const store = new RecordingStore();

    const first = await importLegacyMissions(services(store), { rootDir: root, commit: COMMIT });
    assert.deepEqual(first.unresolvedDependencies, [
      'TASK-9017: dependency TASK-9018 resolves to no Mission',
    ]);

    // The record it names arrives in a later import; the rerun records the
    // reference even though TASK-9017 itself is already materialized.
    fs.writeFileSync(
      path.join(root, 'backlog', 'tasks', 'task-9018 - Named.md'),
      frontmatter({ id: 'TASK-9018', title: 'Named record', status: 'open' }),
    );
    const second = await importLegacyMissions(services(store), { rootDir: root, commit: COMMIT });

    assert.deepEqual(second.unresolvedDependencies, []);
    assert.equal(second.alreadyMaterialized, 1);
    assert.deepEqual(store.missions.get('task-9017')?.mission.dependencies, ['task-9018']);
  });

  it('an unchanged rerun leaves a dependency the operator removed removed', async () => {
    const root = workspace([
      { name: 'task-9001 - Open.md', body: OPEN_TASK },
      {
        name: 'task-9020 - Edited.md',
        body: `---\nid: TASK-9020\ntitle: Edited record\nstatus: open\n${listField('dependencies', ['TASK-9001'])}\n---\n\nBody.\n`,
      },
    ]);
    const store = new RecordingStore();
    await importLegacyMissions(services(store), { rootDir: root, commit: COMMIT });
    assert.deepEqual(store.missions.get('task-9020')?.mission.dependencies, ['task-9001']);

    // The operator drops it with `px depends remove`. The rerun imports nothing,
    // so it has no new Mission to record against and must not argue.
    const held = store.missions.get('task-9020')!;
    store.missions.set('task-9020', {
      mission: { ...held.mission, dependencies: [] },
      version: held.version,
    });
    const rerun = await importLegacyMissions(services(store), { rootDir: root, commit: COMMIT });

    assert.equal(rerun.importable, 0);
    assert.deepEqual(
      store.missions.get('task-9020')?.mission.dependencies,
      [],
      'the rerun did not restore what the operator removed',
    );
  });

  it('records the same predecessor named twice as one dependency', async () => {
    const root = workspace([
      { name: 'task-9001 - Open.md', body: OPEN_TASK },
      {
        name: 'task-9021 - Repeated.md',
        body: `---\nid: TASK-9021\ntitle: Repeated record\nstatus: open\n${listField('dependencies', ['TASK-9001', 'task-9001'])}\n---\n\nBody.\n`,
      },
    ]);
    const store = new RecordingStore();

    const report = await importLegacyMissions(services(store), { rootDir: root, commit: COMMIT });

    assert.equal(report.conflicting, 0, report.conflicts.join(' | '));
    assert.deepEqual(store.missions.get('task-9021')?.mission.dependencies, ['task-9001']);
  });

  it('reports dependencies the write refuses instead of dropping them', async () => {
    const root = workspace([
      { name: 'task-9001 - Open.md', body: OPEN_TASK },
      {
        name: 'task-9022 - Refused.md',
        body: `---\nid: TASK-9022\ntitle: Refused record\nstatus: open\n${listField('dependencies', ['TASK-9001'])}\n---\n\nBody.\n`,
      },
    ]);
    const store = new RecordingStore();
    const refusing = {
      ...services(store),
      dependencies: {
        setDependencies: async () => failure<MissionDependenciesResult>('validation', 'dependency write refused'),
      },
    };

    const report = await importLegacyMissions(refusing, { rootDir: root, commit: COMMIT });

    assert.equal(report.conflicting, 1);
    assert.match(
      report.conflicts[0],
      /TASK-9022: dependencies task-9001 were refused \(dependency write refused\)/,
    );
    assert.deepEqual(store.missions.get('task-9022')?.mission.dependencies, []);
  });

  it('leaves recorded dependencies alone when the Mission already has some', async () => {
    const root = workspace([
      { name: 'task-9001 - Open.md', body: OPEN_TASK },
      {
        name: 'task-9019 - Recorded.md',
        body: `---\nid: TASK-9019\ntitle: Recorded record\nstatus: open\n${listField('dependencies', ['TASK-9001'])}\n---\n\nBody.\n`,
      },
    ]);
    const store = new RecordingStore();
    await importLegacyMissions(services(store), { rootDir: root, commit: COMMIT });

    // The operator adds one of their own with `px depends add`.
    const held = store.missions.get('task-9019')!;
    store.missions.set('task-9019', {
      mission: { ...held.mission, dependencies: ['task-9016' as never] },
      version: held.version,
    });
    await importLegacyMissions(services(store), { rootDir: root, commit: COMMIT });

    assert.deepEqual(
      store.missions.get('task-9019')?.mission.dependencies,
      ['task-9016'],
      'the rerun did not overwrite what is already recorded',
    );
  });

  it('reports a legacy dependency that resolves to no Mission', async () => {
    const root = workspace([{
      name: 'task-9011 - Dangling.md',
      body: `---\nid: TASK-9011\ntitle: Dangling record\nstatus: open\n${listField('dependencies', ['TASK-8000', 'not a slug'])}\n---\n\nBody.\n`,
    }]);
    const store = new RecordingStore();

    const report = await importLegacyMissions(services(store), { rootDir: root, commit: COMMIT });

    assert.equal(report.importable, 1, 'the record still imports');
    assert.deepEqual(report.unresolvedDependencies, [
      'TASK-9011: dependency TASK-8000 resolves to no Mission',
      'TASK-9011: dependency not a slug resolves to no Mission',
    ]);
    assert.deepEqual(store.missions.get('task-9011')?.mission.dependencies, []);
  });

  it('classifies approved stale links as obsolete while retaining their source body', async () => {
    const root = workspace([{
      name: 'task-9013 - Stale.md',
      body: `---\nid: TASK-9013\ntitle: Stale link\nstatus: open\n${listField('dependencies', ['TASK-2500'])}\n---\n\nDepends on TASK-2500.\n`,
    }]);
    const report = await importLegacyMissions(services(new RecordingStore()), { rootDir: root, commit: COMMIT });
    assert.deepEqual(report.unresolvedDependencies, []);
    assert.deepEqual(report.obsoleteDependencies, [
      'TASK-9013: dependency TASK-2500 is obsolete; retained in pinned task body',
    ]);
  });

  it('no longer names dependencies as a field Mission cannot represent', async () => {
    const root = workspace([{
      name: 'task-9012 - Represented.md',
      body: `---\nid: TASK-9012\ntitle: Represented record\nstatus: open\n${listField('dependencies', ['TASK-8000'])}\n---\n\nBody.\n`,
    }]);
    const store = new RecordingStore();

    const report = await importLegacyMissions(services(store), { rootDir: root, commit: COMMIT });

    assert.equal(report.unrepresented, 0);
    assert.deepEqual(report.unrepresentedFields, []);
  });

  it('ignores explicitly retired metadata while flagging unknown fields', async () => {
    const root = workspace([{
      name: 'task-9009.md',
      body: frontmatter({
        id: 'TASK-9009', title: 'Extra fields', status: 'open',
        priority: 'high', ordinal: '4', created_date: '2026-01-01', milestone: 'M4',
        unexpected_key: 'unknown',
      }),
    }]);
    const store = new RecordingStore();

    const report = await importLegacyMissions(services(store), { rootDir: root, commit: COMMIT });

    assert.equal(report.unrepresented, 1);
    assert.equal(report.importable, 1);
    assert.deepEqual(report.unrepresentedFields, ['TASK-9009: unexpected_key']);
  });

  it('counts backlog.md for audit without treating it as a unique task record', async () => {
    const root = workspace([{ name: 'task-9001 - Open.md', body: OPEN_TASK }]);
    fs.writeFileSync(path.join(root, 'backlog.md'), '# Backlog\n\n- TASK-9001\n');
    const store = new RecordingStore();

    const report = await importLegacyMissions(services(store), { rootDir: root, commit: COMMIT });

    assert.equal(report.discovered, 2);
    assert.equal(report.unrepresented, 0);
  });

  it('never writes, renames, or deletes the legacy files it read', async () => {
    const root = workspace([{ name: 'task-9001 - Open.md', body: OPEN_TASK }]);
    const file = path.join(root, 'backlog', 'tasks', 'task-9001 - Open.md');
    const before = fs.readFileSync(file, 'utf8');

    await importLegacyMissions(services(new RecordingStore()), { rootDir: root, commit: COMMIT });

    assert.equal(fs.readFileSync(file, 'utf8'), before);
    assert.deepEqual(fs.readdirSync(path.join(root, 'backlog', 'tasks')), ['task-9001 - Open.md']);
  });
});
