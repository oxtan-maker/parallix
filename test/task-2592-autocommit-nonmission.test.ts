// @ts-nocheck -- mocked Git seam returns only fields exercised by this regression

import test from 'node:test';
import assert from 'node:assert/strict';
import { commitSafeMissionArtifacts } from '../src/adapters/review/rebase.js';

test('commitSafeMissionArtifacts commits mission work despite an unstaged non-mission file', async () => {
  const added: string[] = [];
  const errors: string[] = [];

  const result = await commitSafeMissionArtifacts('task-2592', '/tmp/worktree', {
    gitFn: (args) => {
      if (args.includes('status')) {
        return {
          status: 0,
          stdout: Buffer.from('M  docs/missions/2026/task-2592/MISSION.md\0 M scratch-notes.txt\0'),
          stderr: '',
        };
      }
      if (args.includes('add')) {
        added.push(args.at(-1) ?? '');
        return { status: 0, stdout: '', stderr: '' };
      }
      if (args.includes('commit')) return { status: 0, stdout: '', stderr: '' };
      return { status: 0, stdout: '', stderr: '' };
    },
    isMissionArtifactFn: file => file === 'docs/missions/2026/task-2592/MISSION.md',
    isWorkflowGeneratedArtifactFn: () => false,
    error: message => errors.push(message),
  });

  assert.equal(result.ok, true);
  assert.deepEqual(added, ['docs/missions/2026/task-2592/MISSION.md']);
  assert.equal(errors.some(message => message.includes('non-mission paths')), false);
});
