// Mission slug and activation contract: extraction boundaries, slug namespace and duplicate-closeout
// rules, direct Backlog activation guard, and classification preservation across closeout.
//
// Behavior-owned suite (TASK-2622.07). Legacy case names are unchanged; each section keeps its
// historical task provenance and the legacy file it replaced.
//   Draft concern modules: no task ID in the legacy file
//   Slug namespace: TASK-2468
//   Slug duplicate closeout: TASK-2524
//   Direct Backlog activation guard: TASK-2445
//   Classification preservation across closeout: TASK-2594

import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import * as setup from '../src/adapters/cli/commands/draft-setup.js';
import * as prompts from '../src/adapters/cli/commands/draft-prompts.js';
import * as conflicts from '../src/adapters/cli/commands/draft-conflicts.js';
import * as draftStats from '../src/adapters/cli/commands/draft-stats.js';
import { inferSlug, isMissionSlugCandidate } from '../src/adapters/filesystem/mission-paths.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { checkBacklogIntegrity, completeTask, resolveTaskFile } from '../src/adapters/backlog/backlog.js';
import { mkdtemp as registeredMkdtemp } from './helpers/temp-dir.js';
import { availableBoardCommands } from '../src/application/projections/mission-board.js';
import { agentFamily } from '../src/domain/agents.js';
import { triggerFromTransition } from '../src/domain/board-event.js';
import { missionId, missionLabels, MissionRuleViolation, type Mission, type MissionStatus } from '../src/domain/mission.js';
import { decideMission } from '../src/domain/mission-workflow.js';
import { repositoryId } from '../src/domain/repository.js';
import { recordIntegrationStats } from '../src/adapters/cli/commands/stats.js';
import { MissionBriefService } from '../src/application/mission-brief-service.js';

// no task ID in the legacy file (was test/draft-extraction.test.ts)
describe('Draft concern modules', () => {
  test('draft concern modules expose the extracted workflow boundaries', () => {
    for (const fn of [
      setup.ensureMissionBranch,
      setup.bootstrapBacklogTask,
      prompts.buildDraftPrompt,
      prompts.normalizeDraftClassification,
      conflicts.classifyDraftEntries,
      conflicts.enforceDraftCommitSafety,
      draftStats.recordDraftStats,
      draftStats.createDraftWorkflowAdapter,
    ]) {
      assert.equal(typeof fn, 'function');
    }
  });
});

// TASK-2468 (was test/task-2468-slug-namespace.test.ts)
describe('Slug namespace', () => {
  // TASK-2468 namespace coverage. The reviewer (round 1, F3) flagged that
  // `px integrate` — the highest-risk lifecycle command — had zero adhoc coverage:
  // its slug/task handling had not been shown to tolerate the new
  // `parallix-adhoc-<NNNN>` namespace.
  //
  // integrate resolves its target through `inferSlug` (the single shared validator
  // now owned by the domain layer, task-2468 F7) and then loads the mission record
  // from the operator database. This test pins the entry point: the shared
  // validator must recognize the DB-owned adhoc namespace exactly as it recognizes
  // the `task-` and legacy `adhoc-` namespaces, and reject the non-namespaced
  // free-text argument that used to fall through to a bogus `adhoc-<slug>`.

  test('adhoc-lifecycle: the shared validator recognizes the DB-owned adhoc namespace at the integrate entry', () => {
    // integrate's first line: inferSlug(explicitSlug). It must return the adhoc
    // identity unchanged so the mission-store load downstream resolves it.
    assert.equal(inferSlug('parallix-adhoc-0001'), 'parallix-adhoc-0001');
    assert.equal(inferSlug('parallix-adhoc-12345'), 'parallix-adhoc-12345');

    // The other recognized backings still validate — one shared validator, no
    // second classifier (Restricted Area honored).
    assert.equal(inferSlug('task-architecture-migration'), 'task-architecture-migration');
    assert.equal(inferSlug('adhoc-fix-hello'), 'adhoc-fix-hello');

    // A non-namespaced free-text argument is not a slug candidate: it is rejected
    // at the intake boundary (resolveDraftTarget), not silently coerced into a
    // bogus `adhoc-<free-text>` downstream.
    assert.equal(isMissionSlugCandidate('fix hello world greeting'), false);
  });
});

// TASK-2524 (was test/task-2524-slug-duplicate-closeout-repro.test.ts)
describe('Slug duplicate closeout', () => {
  test('TASK-2524: completeTask closes the sole open slug-prefix twin without hiding ambiguity', () => {
    const root = registeredMkdtemp('task-2524-');
    const tasksDir = path.join(root, 'backlog', 'tasks');
    const completedDir = path.join(root, 'backlog', 'completed');
    const openFile = path.join(tasksDir, 'task-2524 - open.md');
    const completedFile = path.join(completedDir, 'task-2524 - renamed.md');

    try {
      fs.mkdirSync(tasksDir, { recursive: true });
      fs.mkdirSync(completedDir, { recursive: true });
      fs.writeFileSync(openFile, 'id: TASK-2524\nstatus: backlog\n');
      fs.writeFileSync(completedFile, 'id: TASK-2524\nstatus: done\n');

      assert.deepEqual(resolveTaskFile('task-2524', root), {
        ok: false,
        reason: 'ambiguous',
        matches: [openFile, completedFile],
      });
      assert.equal(completeTask('task-2524', root), true);
      assert.equal(fs.existsSync(openFile), false);
      assert.deepEqual(fs.readdirSync(completedDir), [path.basename(completedFile)]);
      assert.deepEqual(resolveTaskFile('task-2524', root), {
        ok: true,
        taskFile: completedFile,
        matches: [completedFile],
      });
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test('TASK-2524: backlog integrity rejects renamed slug-prefix twins', () => {
    const root = registeredMkdtemp('task-2524-');
    const tasksDir = path.join(root, 'backlog', 'tasks');
    const completedDir = path.join(root, 'backlog', 'completed');

    try {
      fs.mkdirSync(tasksDir, { recursive: true });
      fs.mkdirSync(completedDir, { recursive: true });
      fs.writeFileSync(path.join(tasksDir, 'task-2524 - open.md'), 'id: TASK-2524\nstatus: backlog\n');
      fs.writeFileSync(path.join(completedDir, 'task-2524 - renamed.md'), 'id: TASK-2524\nstatus: done\n');

      assert.deepEqual(checkBacklogIntegrity(root, 'task-2524'), [{
        file: 'backlog/tasks/task-2524 - open.md',
        type: 'duplicate-completed',
        taskId: 'TASK-2524',
        canonicalFile: 'backlog/completed/task-2524 - renamed.md',
      }]);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});

// TASK-2445 (was test/task-2445-prevent-direct-backlog-activation.test.ts)
describe('Direct Backlog activation guard', () => {
  const id = missionId('task-2445');
  const repo = repositoryId('parallix');
  const implementer = agentFamily('configured-implementer');

  function mission(status: MissionStatus): Mission {
    return {
      id,
      repositoryId: repo,
      title: 'Prevent direct backlog activation',
      labels: missionLabels(['ai_sdlc']),
      status,
      rawStatus: status,
      closedAt: null,
      assignee: null,
      checkpoints: [{ missionId: id, name: 'CP-1', firstLine: 'Do the work', goalCheck: [], nextActionText: '' }],
      brief: { goal: 'g', why: 'w', scope: 's', outOfScope: [] },
      declaredGates: ['npm test'],
      successCriteria: ['The mission is done'],
      predictedNelBucket: 'Small',
      review: null,
      netEngineeringLines: null,
    };
  }

  test('activate rejects an open backlog mission', () => {
    assert.throws(
      () => decideMission(mission('backlog'), { type: 'activate', agent: implementer }),
      MissionRuleViolation,
    );
  });

  test('activate accepts a refined mission and records the agent as assignee', () => {
    const activated = decideMission(mission('refined'), { type: 'activate', agent: implementer });
    assert.equal(activated.status, 'active');
    assert.equal(activated.assignee, implementer);
  });

  test('board projection offers draft for backlog and active for refined', () => {
    const backlog = availableBoardCommands(mission('backlog'), { reviewApproval: null });
    assert.equal(backlog.find(({ command }) => command === 'draft')?.enabled, true);
    assert.deepEqual(backlog.find(({ command }) => command === 'active'), {
      command: 'active',
      enabled: false,
      reason: 'Mission must be refined before it can be activated',
      targetLane: 'active',
      label: 'power ▸',
    });

    const refined = availableBoardCommands(mission('refined'), { reviewApproval: null });
    assert.equal(refined.find(({ command }) => command === 'active')?.enabled, true);
    assert.equal(refined.find(({ command }) => command === 'draft')?.enabled, false);
  });

  test('refine is the transition that carries a backlog mission to refined', () => {
    const refined = decideMission(mission('backlog'), { type: 'refine' });
    assert.equal(refined.status, 'refined');
    // Idempotent, so a re-run of `px draft` records the same lane once.
    assert.equal(decideMission(refined, { type: 'refine' }).status, 'refined');
    assert.equal(triggerFromTransition('backlog', 'refined'), 'refine');
  });

  test('a backlog to active lane move is not a recognised activation trigger', () => {
    assert.equal(triggerFromTransition('backlog', 'active'), null);
  });

  test('refined and intake lane moves to active stay activation triggers', () => {
    assert.equal(triggerFromTransition('refined', 'active'), 'activate');
    assert.equal(triggerFromTransition(null, 'active'), 'activate');
  });
});

// TASK-2594 (was test/task-2594-repro.test.ts)
describe('Classification preservation across closeout', () => {
  // TASK-2594 — TASK-2521.07 kept its classification only in the provider
  // task.  Once closeout removed that task, integration statistics could no
  // longer record the completed Mission even though the aggregate remained.


  const slug = 'task-2521.07';

  function missionWithLabels(labels: readonly string[]): Mission {
    return {
      id: missionId(slug), repositoryId: repositoryId('parallix'), title: 'classification regression',
      labels: missionLabels(labels), status: 'done', assignee: agentFamily('codex'),
      checkpoints: [], closedAt: '2026-09-27T12:00:00.000Z', netEngineeringLines: null,
      review: {
        rounds: [{ number: 1, implementer: agentFamily('codex'), reviewer: agentFamily('claude'),
          subject: { revision: 'landed' }, decision: { kind: 'approved', decidedAt: '2026-09-27T11:00:00.000Z', comment: null, source: { kind: 'local' } } }],
        reviewEvents: [], stageLaunches: [], intervention: null,
      } as unknown as Mission['review'],
    };
  }

  function missionStore(mission: Mission) {
    return {
      async load(id: ReturnType<typeof missionId>) {
        return String(id) === slug
          ? { kind: 'found' as const, mission, version: 1 as never }
          : { kind: 'missing' as const };
      },
    };
  }

  test('TASK-2594: classification writes preserve labels for native and imported Mission identities', async () => {
    for (const origin of ['native', 'imported'] as const) {
      let mission = missionWithLabels([origin, 'bug', 'ai_sdlc']);
      let version = 4;
      const service = new MissionBriefService({
        async load() { return { kind: 'found' as const, mission, version: version as never }; },
        async save(next: Mission, expected: number) {
          assert.equal(expected, version, `${origin} write uses the loaded version`);
          mission = next; version += 1; return version as never;
        },
      } as never);
      const result = await service.setClassification({
        operationId: `test-${origin}`, missionId: missionId(slug), expectedVersion: version as never,
        capabilities: new Set(['mission:context']), classification: 'user_value',
      });
      assert.equal(result.status, 'completed');
      assert.deepEqual(mission.labels.map(String).sort(), ['bug', origin, 'user_value'].sort());
      const invalid = await service.setClassification({
        operationId: `invalid-${origin}`, missionId: missionId(slug), expectedVersion: version as never,
        capabilities: new Set(['mission:context']), classification: 'other',
      });
      assert.equal(invalid.status, 'failed');
    }
  });

  test('TASK-2594: TASK-2521.07 requires stored classification before draft completion and after provider-file closeout', async () => {
    const root = registeredMkdtemp('task-2594-');
    const taskFile = path.join(root, 'backlog', 'tasks', `${slug} - provider.md`);
    try {
      fs.mkdirSync(path.dirname(taskFile), { recursive: true });
      fs.writeFileSync(taskFile, [
        '---', 'id: TASK-2521.07', 'labels: [ai_sdlc, migration]', 'status: review', '---', '',
      ].join('\n'));

      const staleStore = missionStore(missionWithLabels(['migration', 'workflow']));
      await assert.rejects(
        recordIntegrationStats({ slug, rootDir: root, date: '2026-09-27', store: inMemoryMeasurements(), missionStore: staleStore as never }),
        /requires exactly one classification|px state/i,
        'provider-only ai_sdlc must not allow draft/closeout to treat an unclassified Mission as valid',
      );

      const classifiedStore = missionStore(missionWithLabels(['migration', 'workflow', 'ai_sdlc']));
      const measurements = inMemoryMeasurements();
      fs.rmSync(taskFile);
      const first = await recordIntegrationStats({ slug, rootDir: root, date: '2026-09-27', store: measurements, missionStore: classifiedStore as never });
      const second = await recordIntegrationStats({ slug, rootDir: root, date: '2026-09-27', store: measurements, missionStore: classifiedStore as never });

      assert.equal(first.row.classification, 'ai_sdlc');
      assert.equal(first.metadataSource.classification, 'mission-aggregate');
      assert.equal(second.changed, false, 'post-landing statistics repair is idempotent');
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  function inMemoryMeasurements() {
    const rows: any[] = [];
    return {
      upsertMeasurement(row: any) {
        const existing = rows.findIndex(candidate => candidate.repo === row.repo && candidate.mission === row.mission && candidate.stage === row.stage);
        if (existing >= 0) { return { changed: false }; }
        rows.push(row);
        return { changed: true };
      },
      listMeasurements() { return rows; },
    };
  }
});
