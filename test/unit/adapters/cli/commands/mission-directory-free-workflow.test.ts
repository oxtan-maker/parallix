import { fixtureMission } from '../../../../fixtures/mission-builders.js';
import { missionLabels } from '../../../../../src/domain/mission.js';
import { draftMissionServicesFixture } from '../../../../helpers/draft-mission-services.js';

import { repositoryId as fixtureRepositoryId } from '../../../../../src/domain/repository.js';
import { missionVersion as fixtureVersion } from '../../../../../src/application/domain-ports.js';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { parseTaskFrontmatterValue, taskIdFromFilename } from '../../../../../src/adapters/backlog/task-file-io.js';
import { ensureMissionFile } from '../../../../../src/adapters/cli/commands/draft-setup.js';
import { runDraftCommand } from '../../../../../src/adapters/cli/commands/draft.js';
import { HandoffCommandUseCase } from '../../../../../src/application/handoff-command-use-case.js';
import { SLUG, LEGACY_MISSION_LOAD, makePorts, makeRecorder, runOptions } from '../../../../helpers/handoff-ports.js';
import { mkdtemp as registeredMkdtemp } from '../../../../helpers/temp-dir.js';

function containsFile(directory: string): boolean {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    if (entry.isFile() || (entry.isDirectory() && containsFile(target))) { return true; }
  }
  return false;
}

test('a new typed draft does not prepare a retired mission directory', () => {
  const root = registeredMkdtemp('parallix-typed-draft-');
  try {
    assert.equal(ensureMissionFile(root, 'task-2560-repro', { logFn: (message) => message }), '');
    assert.equal(fs.existsSync(path.join(root, 'missions')), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

function containsRetiredArchiveFile(directory: string): boolean {
  if (!fs.existsSync(directory)) { return false; }
  return fs.readdirSync(directory, { withFileTypes: true }).some(entry => {
    if (entry.name !== 'tasks' || !entry.isDirectory()) { return true; }
    return fs.readdirSync(path.join(directory, entry.name), { withFileTypes: true }).some(task => {
      // The provider's archive is flat. A task-looking directory must not hide
      // MISSION.md, checkpoints or other retired ledger files.
      if (!task.isFile() || !task.name.endsWith('.md')) { return true; }
      const id = taskIdFromFilename(task.name);
      const content = fs.readFileSync(path.join(directory, entry.name, task.name), 'utf8');
      return !id || parseTaskFrontmatterValue(content, 'id')?.toUpperCase() !== id;
    });
  });
}

function containsRetiredWorkflowMetadata(root: string): boolean {
  const missions = path.join(root, 'missions');
  return (fs.existsSync(missions) && containsFile(missions))
    || containsRetiredArchiveFile(path.join(root, 'backlog/archive'))
    || fs.existsSync(path.join(root, 'backlog.md'));
}

test('the self-hosted tree contains no retired workflow ledger roots', () => {
  // Completed and cancelled task-provider records remain history, not ledgers.
  assert.equal(containsRetiredWorkflowMetadata(process.cwd()), false);
});

test('the retired archive guard permits cancelled task history (TASK-2794)', () => {
  const root = registeredMkdtemp('parallix-cancelled-archive-');
  try {
    const tasks = path.join(root, 'backlog/archive/tasks');
    fs.mkdirSync(tasks, { recursive: true });
    fs.writeFileSync(path.join(tasks, 'task-1 - cancelled.md'),
      '---\nid: TASK-1\ntitle: Cancelled task\nstatus: active\n---\nPreserved cancellation history.\n');
    assert.equal(containsRetiredWorkflowMetadata(root), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('the retired archive guard rejects ledgers and malformed task stores (TASK-2794)', () => {
  const root = registeredMkdtemp('parallix-archive-guard-');
  try {
    for (const relative of [
      'backlog/archive/MISSION.md',
      'backlog/archive/missions/CP-1.md',
      'backlog/archive/other/tasks/ledger.md',
      'backlog/archive/tasks',
      'backlog/archive/tasks/MISSION.md',
      'backlog/archive/tasks/CP-1.md',
      'backlog/archive/tasks/mission-documents.json',
      'backlog/archive/tasks/task-1/MISSION.md',
      'backlog/archive/tasks/task-1 - ledger.md',
      'missions/task-1/CP-1.md',
      'backlog.md',
    ]) {
      const target = path.join(root, relative);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, 'Retired workflow ledger');
      assert.equal(containsRetiredWorkflowMetadata(root), true, relative);
      // Each negative stands alone; no accepted or rejected fixture can mask it.
      fs.rmSync(path.join(root, 'backlog'), { recursive: true, force: true });
      fs.rmSync(path.join(root, 'missions'), { recursive: true, force: true });
      fs.rmSync(path.join(root, 'backlog.md'), { force: true });
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('a normal typed draft workflow does not recreate the retired mission tree', async () => {
  const root = registeredMkdtemp('parallix-file-free-draft-');
  const slug = 'task-2560-repro';
  const taskFile = path.join(root, 'task.md');
  fs.writeFileSync(taskFile, '---\nid: TASK-2560-REPRO\ntitle: File-free draft\nstatus: backlog\nlabels: [ai_sdlc]\n---\n');
  try {
    const missionServices: NonNullable<NonNullable<Parameters<typeof runDraftCommand>[1]>["missionServicesFn"]> = async () => (draftMissionServicesFixture({
      repositoryId: fixtureRepositoryId('test-repository'),
      intake: { execute: async () => ({ durableEvidence: [],  status: 'completed' as const, value: { version: fixtureVersion(1), mission: fixtureMission(slug) } }) },
      lifecycle: { transition: async () => ({ durableEvidence: [],  status: 'completed' as const, value: { version: fixtureVersion(2), mission: fixtureMission(slug, { status: 'refined' }), previousAssignee: null, from: 'backlog', to: 'refined', laneChanged: true } }) },
      store: { load: async () => ({ kind: 'found' as const, mission: fixtureMission(slug, { title: 'File-free draft', labels: missionLabels(['ai_sdlc']) }), version: fixtureVersion(1) }) },
    }));
    await runDraftCommand([slug], {
      inferSlugFn: () => slug,
      resolveMainRepoFn: () => root,
      conventionalWorktreePathFn: () => root,
      ensureRepoExistsFn: () => true,
      resolveTaskFileFn: () => ({ ok: true, taskFile, matches: [taskFile] }),
      checkBacklogIntegrityFn: () => [],
      detectLaunchBaseBranchFn: () => null,
      ensureMissionBranchFn: () => {},
      ensureWorktreeFn: () => {},
      ensureGraphifyWorkspaceFn: () => {},
      ensureGraphifyIgnoreFn: () => {},
      bootstrapBacklogTaskFn: () => true,
      validateDraftClassificationFn: () => ({ ok: true as const }),
      normalizeDraftClassificationFn: () => ({ ok: true as const, classification: 'ai_sdlc' }),
      readAgentConfigOrExitFn: () => ({}),
      selectAgentFn: () => 'codex',
      startDraftAgentFn: async () => ({ agent: 'codex', result: { status: 0 } }),
      recordDraftImplementerFn: () => {},
      recordDraftStatsFn: () => {},
      enforceDraftCommitSafetyFn: () => false,
      transitionTaskFn: () => true,
      transitionVirtualFn: async (transition, target, status, options) => transition(target, status, options ?? {}),
      missionServicesFn: missionServices,
      exitFn: (code) => { throw new Error(`unexpected exit ${code}`); },
      logFn: () => {},
      errorFn: (message) => { throw new Error(`unexpected error: ${message}`); },
    });
    assert.equal(fs.existsSync(path.join(root, 'missions')), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('typed handoff succeeds without a mission directory or Markdown artifacts', async () => {
  const recorder = makeRecorder();
  const base = makePorts(recorder);
  const ports = makePorts(recorder, {
    fileSystem: {
      ...base.fileSystem,
      existsSync: (target: string) => !/(?:MISSION|CP-\d+)\.md$/.test(target),
      readText: (target: string) => {
        if (/(?:MISSION|CP-\d+)\.md$/.test(target)) { throw new Error(`retired document read: ${target}`); }
        return base.fileSystem.readText(target);
      },
    },
    missionUtils: { ...base.missionUtils, findMissionDir: () => null, findMissionArea: () => { throw new Error('missing directory scan'); }, findCheckpoints: () => { throw new Error('retired checkpoint scan'); } },
  });
  const result = await new HandoffCommandUseCase(ports).performHandoff(SLUG, runOptions(recorder));
  assert.equal(result.ok, true, recorder.errors.join('\n'));
  assert.deepEqual(recorder.transitions, ['review']);
});

for (const [name, load] of [
  ['missing mission', { kind: 'missing' }],
  ['legacy mission without directory', LEGACY_MISSION_LOAD],
  ['typed mission without evidence', { kind: 'found', mission: fixtureMission(SLUG, { brief: { goal: 'g', why: 'w', scope: 's', outOfScope: [] }, checkpoints: [] }), version: fixtureVersion(1) }],
] as const) {
  test(`directory-free handoff refuses ${name}`, async () => {
    const recorder = makeRecorder();
    const base = makePorts(recorder);
    const services = await base.missionServices!('/root', { missionDir: '/root' });
    const ports = makePorts(recorder, {
      missionUtils: { ...base.missionUtils, findMissionDir: () => null },
      missionServices: async () => ({ ...services, store: { load: async () => load } }),
    });
    const result = await new HandoffCommandUseCase(ports).performHandoff(SLUG, runOptions(recorder));
    assert.equal(result.ok, false);
    assert.deepEqual(recorder.transitions, []);
    assert.equal(recorder.gatekeeperCalls.length, 0);
  });
}

test('directory-free handoff fails closed when the database is unavailable', async () => {
  const recorder = makeRecorder();
  const base = makePorts(recorder);
  const ports = makePorts(recorder, {
    missionUtils: { ...base.missionUtils, findMissionDir: () => null },
    missionServices: async () => { throw new Error('database unavailable'); },
  });
  const result = await new HandoffCommandUseCase(ports).performHandoff(SLUG, runOptions(recorder));
  assert.equal(result.ok, false);
  assert.match(result.error!, /database unavailable/);
  assert.deepEqual(recorder.transitions, []);
});

test('directory-free typed handoff still requires the mission branch', async () => {
  const recorder = makeRecorder();
  const base = makePorts(recorder);
  const ports = makePorts(recorder, {
    missionUtils: { ...base.missionUtils, findMissionDir: () => null },
    git: { ...base.git, getCurrentBranch: () => 'main' },
  });
  const result = await new HandoffCommandUseCase(ports).performHandoff(SLUG, runOptions(recorder));
  assert.equal(result.ok, false);
  assert.match(result.error!, /Not on mission branch/);
  assert.deepEqual(recorder.transitions, []);
});
