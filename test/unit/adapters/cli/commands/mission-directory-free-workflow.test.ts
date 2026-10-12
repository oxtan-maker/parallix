import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { ensureMissionFile } from '../../../../../src/adapters/cli/commands/draft-setup.js';
import { runDraftCommand } from '../../../../../src/adapters/cli/commands/draft.js';
import { HandoffCommandUseCase } from '../../../../../src/application/handoff-command-use-case.js';
import { SLUG, LEGACY_MISSION_LOAD, makePorts, makeRecorder, runOptions } from '../../../../helpers/handoff-ports.js';
import { mkdtemp as registeredMkdtemp } from '../../../../helpers/temp-dir.js';

function containsFile(directory: string, allowedDirectory?: string): boolean {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory() && target === allowedDirectory) { continue; }
    if (entry.isFile() || (entry.isDirectory() && containsFile(target, allowedDirectory))) { return true; }
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

test('the self-hosted tree contains no retired workflow ledger roots', () => {
  // backlog/completed/ is not retired: landing archives each task file there
  // and the stale-copy guards check later landings against it (TASK-2613).
  // backlog/archive/tasks/ preserves cancellation history and hides cancelled
  // cards from the board. Only that task store is allowed (TASK-2725).
  const retiredDirectories = [
    'missions',
    'backlog/archive',
  ];
  for (const retiredRoot of retiredDirectories) {
    const directory = path.join(process.cwd(), retiredRoot);
    assert.equal(
      fs.existsSync(directory) && containsFile(directory, path.join(process.cwd(), 'backlog/archive/tasks')),
      false,
      `retired workflow metadata must not remain under ${retiredRoot}`,
    );
  }
  assert.equal(fs.existsSync(path.join(process.cwd(), 'backlog.md')), false,
    'retired workflow metadata must not be tracked at backlog.md');
});

test('the retired archive guard allows task history but rejects ledger files (TASK-2725)', () => {
  const root = registeredMkdtemp('parallix-archive-guard-');
  const tasks = path.join(root, 'tasks');
  try {
    fs.mkdirSync(tasks);
    fs.writeFileSync(path.join(tasks, 'task-1 - cancelled.md'), 'Cancelled task history');
    assert.equal(containsFile(root, tasks), false);
    for (const relative of ['MISSION.md', 'missions/CP-1.md', 'other/tasks/ledger.md']) {
      const target = path.join(root, relative);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, 'Retired workflow ledger');
      assert.equal(containsFile(root, tasks), true, relative);
      fs.rmSync(target);
    }
    fs.rmSync(tasks, { recursive: true });
    fs.writeFileSync(tasks, 'A file named tasks is not the task store');
    assert.equal(containsFile(root, tasks), true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('a normal typed draft workflow does not recreate the retired mission tree', async () => {
  const root = registeredMkdtemp('parallix-file-free-draft-');
  const slug = 'task-2560-repro';
  try {
    const missionServices = async () => ({
      repositoryId: 'test-repository',
      intake: { execute: async () => ({ status: 'completed', value: { version: 1 } }) },
      lifecycle: { transition: async () => ({ status: 'completed', value: { version: 2 } }) },
      store: { load: async () => ({ kind: 'found', mission: { title: 'File-free draft' } }) },
    });
    await runDraftCommand([slug], {
      inferSlugFn: () => slug,
      resolveMainRepoFn: () => root,
      conventionalWorktreePathFn: () => root,
      ensureRepoExistsFn: () => true,
      resolveTaskFileFn: () => ({ ok: true, taskFile: null, matches: [] }),
      checkBacklogIntegrityFn: () => [],
      detectLaunchBaseBranchFn: () => null,
      ensureMissionBranchFn: () => {},
      ensureWorktreeFn: () => {},
      ensureGraphifyWorkspaceFn: () => {},
      ensureGraphifyIgnoreFn: () => {},
      bootstrapBacklogTaskFn: () => true,
      validateDraftClassificationFn: () => ({ ok: true }),
      normalizeDraftClassificationFn: () => ({ ok: true, classification: 'ai_sdlc' }),
      readAgentConfigOrExitFn: () => ({}),
      selectAgentFn: () => 'codex',
      startDraftAgentFn: async () => ({ agent: 'codex', result: { status: 0 } }),
      recordDraftImplementerFn: () => {},
      recordDraftStatsFn: () => {},
      enforceDraftCommitSafetyFn: () => false,
      transitionTaskFn: () => true,
      transitionVirtualFn: async (transition, target, status, options) => transition(target, status, options),
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
  ['missing mission', { kind: 'not-found' }],
  ['legacy mission without directory', LEGACY_MISSION_LOAD],
  ['typed mission without evidence', { kind: 'found', mission: { brief: { goal: 'g' }, checkpoints: [] } }],
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
