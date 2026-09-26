import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { ensureMissionFile } from '../src/adapters/cli/commands/draft-setup.js';
import { HandoffCommandUseCase } from '../src/application/handoff-command-use-case.js';
import { SLUG, makePorts, makeRecorder, runOptions } from './helpers/handoff-ports.js';

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

test('typed handoff succeeds without reading MISSION.md or CP-1.md', async () => {
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
    missionUtils: { ...base.missionUtils, findCheckpoints: () => { throw new Error('retired checkpoint scan'); } },
  });
  const result = await new HandoffCommandUseCase(ports).performHandoff(SLUG, runOptions(recorder));
  assert.equal(result.ok, true, recorder.errors.join('\n'));
  assert.deepEqual(recorder.transitions, ['review']);
});
