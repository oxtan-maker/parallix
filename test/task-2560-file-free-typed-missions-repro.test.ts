import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { ensureMissionFile } from '../src/adapters/cli/commands/draft-setup.js';
import { HandoffCommandUseCase } from '../src/application/handoff-command-use-case.js';
import { SLUG, LEGACY_MISSION_LOAD, makePorts, makeRecorder, runOptions } from './helpers/handoff-ports.js';

test('a new typed draft prepares its mission directory without a Markdown contract', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'parallix-typed-draft-'));
  try {
    const missionPath = ensureMissionFile(root, 'task-2560-repro', { logFn: (message) => message });
    assert.equal(fs.existsSync(path.dirname(missionPath)), true);
    assert.equal(fs.existsSync(missionPath), false);
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
    const services = await base.missionServices!('/root', {});
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
