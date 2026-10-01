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
import path from 'node:path';
import { createHash } from 'node:crypto';

import { mkdtemp } from './helpers/temp-dir.js';

import {
  importLegacyMissions,
  type MissionImportServices,
} from '../src/adapters/backlog/legacy-mission-import.js';
import { MissionIntakeService } from '../src/application/mission-intake-service.js';
import { MissionBriefService } from '../src/application/mission-brief-service.js';
import { readLegacyTaskContent } from '../src/adapters/backlog/legacy-task-content.js';
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

describe('legacy import trace pins its commit (task-2521.04)', () => {
  it('pins the trace to the checkout HEAD when no commit is passed', async () => {
    const root = mkdtemp('task-2521.04-commit-');
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

    const committed = fs.readFileSync(path.join(root, file), 'utf8');
    fs.writeFileSync(path.join(root, file), committed.replace('Body text.', 'Changed after commit.'));
    const dirty = await importLegacyMissions(services(store), { rootDir: root });
    assert.match(dirty.conflicts[0], /source differs from pinned Git commit/);
    assert.equal(store.missions.size, 0, 'a dirty source cannot get a misleading commit pin');
    fs.writeFileSync(path.join(root, file), committed);

    await importLegacyMissions(services(store), { rootDir: root });

    const url = store.missions.get('task-9001')?.mission.externalTaskRef?.url;
    assert.equal(url, `${file}@${head}`);
    // The pin is what keeps the source text recoverable once the file is gone.
    fs.rmSync(path.join(root, file));
    assert.match(run('show', `${head}:${file}`), /Open legacy record/);
  });

  it('refreshes a changed canonical task body from its committed source', async () => {
    const root = mkdtemp('task-2521.06-refresh-');
    const file = path.join('backlog', 'tasks', 'task-9006.md');
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    const run = (...args: readonly string[]) => execFileSync('git', args, {
      cwd: root,
      env: { ...process.env, GIT_AUTHOR_NAME: 'Test', GIT_AUTHOR_EMAIL: 'test@example.invalid',
        GIT_COMMITTER_NAME: 'Test', GIT_COMMITTER_EMAIL: 'test@example.invalid' },
      encoding: 'utf8',
    });
    run('init', '--quiet', '--initial-branch', 'main');
    const body = (text: string) => `---\nid: TASK-9006\ntitle: Canonical task\nstatus: refined\n---\n\n${text}\n`;
    fs.writeFileSync(path.join(root, file), body('Original'));
    run('add', '.'); run('commit', '--quiet', '-m', 'original');
    const store = new RecordingStore();
    await importLegacyMissions(services(store), { rootDir: root });
    const archiveFile = path.join(root, 'missions/task-2521.06/artifacts/task-bodies.json');
    fs.mkdirSync(path.dirname(archiveFile), { recursive: true });
    const originalRef = store.missions.get('task-9006')!.mission.externalTaskRef!;
    const archiveRaw = JSON.stringify({ entries: [{ id: originalRef.id, url: originalRef.url,
      content: body('Original'), sha256: createHash('sha256').update(body('Original')).digest('hex'),
    }] });
    fs.writeFileSync(archiveFile, archiveRaw);
    run('add', '.'); run('commit', '--quiet', '-m', 'preserve original body');
    fs.writeFileSync(path.join(root, file), body('Updated'));
    fs.writeFileSync(path.join(root, 'backlog/tasks/task-9007.md'),
      '---\nid: TASK-9007\ntitle: Future task\nstatus: backlog\n---\n\nNot started.\n');
    fs.writeFileSync(path.join(root, 'backlog/tasks/task-9008.md'),
      '---\nid: TASK-9008\ntitle: Pending intake\nstatus: backlog\n---\n');
    store.missions.set('task-9008', { mission: {
      id: 'task-9008', status: 'refined', externalTaskRef: null,
    } as unknown as Mission, version: missionVersion(1) });
    run('add', '.'); run('commit', '--quiet', '-m', 'updated');
    const revision = run('rev-parse', 'HEAD').trim();
    await importLegacyMissions(services(store), { rootDir: root, dryRun: true, existingOnly: true });
    assert.equal(fs.readFileSync(archiveFile, 'utf8'), archiveRaw);
    const report = await importLegacyMissions(services(store), { rootDir: root, existingOnly: true });
    assert.equal(report.conflicting, 0);
    assert.equal(store.missions.get('task-9006')?.mission.externalTaskRef?.url, `${file}@${revision}`);
    assert.equal(store.missions.has('task-9007'), false);
    assert.equal(store.missions.get('task-9008')?.mission.externalTaskRef, null);
    assert.match(readLegacyTaskContent(store.missions.get('task-9006')!.mission.externalTaskRef!, root).error ?? '', /differs from the working tree/);
    run('add', '.'); run('commit', '--quiet', '-m', 'refresh preserved body');
    assert.deepEqual(readLegacyTaskContent(store.missions.get('task-9006')!.mission.externalTaskRef!, root), { content: body('Updated'), error: null });
    assert.equal((await importLegacyMissions(services(store), { rootDir: root, dryRun: true, existingOnly: true })).importable, 0);
  });

  it('preserves a historical completed lane with a Git-backed closedAt', async () => {
    const root = mkdtemp('task-2521.06-completed-');
    const file = path.join('backlog', 'completed', 'task-9002 - Done.md');
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), '---\nid: TASK-9002\ntitle: Completed legacy task\nstatus: done\n---\n\nTask body.\n');
    const run = (...args: readonly string[]) => execFileSync('git', args, {
      cwd: root,
      env: { ...process.env, GIT_AUTHOR_NAME: 'Test', GIT_AUTHOR_EMAIL: 'test@example.invalid',
        GIT_COMMITTER_NAME: 'Test', GIT_COMMITTER_EMAIL: 'test@example.invalid' },
      encoding: 'utf8',
    });
    run('init', '--quiet', '--initial-branch', 'main');
    run('add', '.');
    run('commit', '--quiet', '-m', 'completed legacy material');
    const store = new RecordingStore();

    const report = await importLegacyMissions(services(store), { rootDir: root });
    const mission = store.missions.get('task-9002')?.mission;
    assert.equal(report.deferred, 0);
    assert.equal(mission?.status, 'done');
    assert.equal(mission?.closedAt, new Date(run('log', '-1', '--format=%cI', '--', file).trim()).toISOString());
    assert.equal(mission?.review, null);
    assert.deepEqual(mission?.checkpoints, []);
  });

  it('dates a done task left in the tasks directory from its status transition', async () => {
    const root = mkdtemp('task-2521.06-done-in-tasks-');
    const file = path.join('backlog', 'tasks', 'task-9005.md');
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    const run = (...args: readonly string[]) => execFileSync('git', args, {
      cwd: root,
      env: { ...process.env, GIT_AUTHOR_NAME: 'Test', GIT_AUTHOR_EMAIL: 'test@example.invalid',
        GIT_COMMITTER_NAME: 'Test', GIT_COMMITTER_EMAIL: 'test@example.invalid' },
      encoding: 'utf8',
    });
    run('init', '--quiet', '--initial-branch', 'main');
    const body = (status: string) => `---\nid: TASK-9005\ntitle: Historical wave task\nstatus: ${status}\n---\n\nBody.\n`;
    fs.writeFileSync(path.join(root, file), body('backlog'));
    run('add', '.'); run('commit', '--quiet', '-m', 'open');
    fs.writeFileSync(path.join(root, file), body('done'));
    run('add', '.'); run('commit', '--quiet', '-m', 'close in place');
    const expected = new Date(run('log', '-1', '--format=%cI', '--', file).trim()).toISOString();
    const store = new RecordingStore();
    const report = await importLegacyMissions(services(store), { rootDir: root });
    assert.equal(report.deferred, 0);
    assert.equal(store.missions.get('task-9005')?.mission.closedAt, expected);
  });

  it('imports committed Goal Check rows once without inventing review evidence', async () => {
    const root = mkdtemp('task-2521.06-cp-');
    const task = path.join(root, 'backlog', 'tasks', 'task-9003.md');
    const checkpoint = path.join(root, 'missions', 'task-9003', 'CP-1.md');
    fs.mkdirSync(path.dirname(task), { recursive: true });
    fs.mkdirSync(path.dirname(checkpoint), { recursive: true });
    fs.writeFileSync(task, '---\nid: TASK-9003\ntitle: Legacy task\nstatus: backlog\n---\n\nBody.\n');
    fs.writeFileSync(checkpoint, '# CP-1: Proof\n\n## Goal Check\n\n| Criterion | Evidence | Status |\n|---|---|---|\n| Preserved | Source file | PASS |\n\nNext action: Continue\n');
    const run = (...args: readonly string[]) => execFileSync('git', args, {
      cwd: root,
      env: { ...process.env, GIT_AUTHOR_NAME: 'Test', GIT_AUTHOR_EMAIL: 'test@example.invalid',
        GIT_COMMITTER_NAME: 'Test', GIT_COMMITTER_EMAIL: 'test@example.invalid' },
      encoding: 'utf8',
    });
    run('init', '--quiet', '--initial-branch', 'main');
    run('add', '.');
    run('commit', '--quiet', '-m', 'legacy evidence');
    const store = new RecordingStore();
    const applied = await importLegacyMissions(services(store), { rootDir: root });
    assert.equal(applied.checkpointFilesImportable, 1);
    assert.deepEqual(store.missions.get('task-9003')?.mission.checkpoints[0]?.goalCheck,
      [{ criterion: 'Preserved', evidence: 'Source file' }]);
    assert.equal(store.missions.get('task-9003')?.mission.review, null);
    const second = await importLegacyMissions(services(store), { rootDir: root, dryRun: true });
    assert.equal(second.checkpointFilesImportable, 0);
  });

  it('replaces disputed checkpoint evidence only with a committed provenance artifact', async () => {
    const root = mkdtemp('task-2521.06-cp-reconcile-');
    const task = path.join(root, 'backlog/tasks/task-9004.md');
    const checkpoint = path.join(root, 'missions/task-9004/CP-1.md');
    const artifact = path.join(root, 'missions/task-2521.06/artifacts/legacy-checkpoint-reconciliation.json');
    fs.mkdirSync(path.dirname(task), { recursive: true });
    fs.mkdirSync(path.dirname(checkpoint), { recursive: true });
    fs.mkdirSync(path.dirname(artifact), { recursive: true });
    fs.writeFileSync(task, '---\nid: TASK-9004\ntitle: Legacy task\nstatus: backlog\n---\n\nBody.\n');
    const document = (evidence: string) => `# CP-1: Proof\n\n## Goal Check\n\n| Criterion | Evidence | Status |\n|---|---|---|\n| Preserved | ${evidence} | PASS |\n\nNext action: Continue\n`;
    fs.writeFileSync(checkpoint, document('Original'));
    const run = (...args: readonly string[]) => execFileSync('git', args, {
      cwd: root,
      env: { ...process.env, GIT_AUTHOR_NAME: 'Test', GIT_AUTHOR_EMAIL: 'test@example.invalid',
        GIT_COMMITTER_NAME: 'Test', GIT_COMMITTER_EMAIL: 'test@example.invalid' },
      encoding: 'utf8',
    });
    run('init', '--quiet', '--initial-branch', 'main');
    run('add', '.');
    run('commit', '--quiet', '-m', 'original');
    const store = new RecordingStore();
    await importLegacyMissions(services(store), { rootDir: root });
    const recorded = store.missions.get('task-9004')!.mission.checkpoints[0];
    fs.writeFileSync(checkpoint, document('Corrected'));
    run('add', '.');
    run('commit', '--quiet', '-m', 'corrected source');
    const sourceCommit = run('rev-parse', 'HEAD').trim();
    fs.writeFileSync(artifact, JSON.stringify({ sourceCommit, entries: [{
      file: 'missions/task-9004/CP-1.md',
      sha256: createHash('sha256').update(fs.readFileSync(checkpoint)).digest('hex'),
      recorded,
    }] }));
    run('add', '.');
    run('commit', '--quiet', '-m', 'preserved old evidence');

    const preview = await importLegacyMissions(services(store), { rootDir: root, dryRun: true, reconcileCheckpoints: true });
    assert.equal(preview.checkpointFilesImportable, 1);
    assert.equal(store.missions.get('task-9004')!.mission.checkpoints[0].goalCheck[0].evidence, 'Original');
    const applied = await importLegacyMissions(services(store), { rootDir: root, reconcileCheckpoints: true });
    assert.equal(applied.checkpointFilesImportable, 1);
    assert.equal(store.missions.get('task-9004')!.mission.checkpoints[0].goalCheck[0].evidence, 'Corrected');
    const second = await importLegacyMissions(services(store), { rootDir: root, dryRun: true, reconcileCheckpoints: true });
    assert.equal(second.checkpointFilesImportable, 0);
  });
});
