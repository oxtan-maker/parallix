
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { detectAreasFromChangedFiles, detectMissionChangedArea } = require('../.test-runtime/lib/core/verification');
const { runPreReviewGate } = require('../.test-runtime/lib/review/review-loop');

test('detectAreasFromChangedFiles maps changed lib files to the lib verification area', () => {
  assert.deepEqual(detectAreasFromChangedFiles('lib/review/review-loop.ts\ntest/review.test.js\n'), ['lib', 'workflow']);
});

test('detectMissionChangedArea selects an area from the mission worktree diff', () => {
  const result = detectMissionChangedArea('/tmp/mission', '/tmp/worktree', {
    baseBranch: 'main',
    gitRunner: () => ({ status: 0, stdout: 'lib/core/verification.ts\n', stderr: '', signal: null }),
  });
  assert.equal(result, 'lib');
});

test('detectMissionChangedArea selects the strict all area for mixed-area diffs', () => {
  const result = detectMissionChangedArea('/tmp/mission', '/tmp/worktree', {
    baseBranch: 'main',
    gitRunner: () => ({ status: 0, stdout: 'docs/adr/decision.md\nlib/core/verification.ts\n', stderr: '', signal: null }),
  });
  assert.equal(result, 'all');
});

test('runPreReviewGate runs the diff-scoped resolver and executes its selected area', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'task-1268-area-'));
  try {
    const missionDir = path.join(root, 'missions', 'task-1268');
    fs.mkdirSync(missionDir, { recursive: true });
    fs.writeFileSync(path.join(missionDir, 'MISSION.md'), '# Mission');
    fs.writeFileSync(path.join(root, 'workflow.config.json'), JSON.stringify({
      product: { name: 'Test' },
      adapters: {
        missions: { baseDir: 'missions' },
        verification: { command: 'echo area={{area}}', defaultArea: 'docs' },
      },
    }));

    const resolverCalls = [];
    const commands = [];
    const result = await runPreReviewGate('task-1268', root, {
      resolveEffectiveAreaFn: (area, worktree, resolvedMissionDir) => {
        resolverCalls.push({ area, worktree, resolvedMissionDir });
        return 'all';
      },
      runFn: (_command, args) => {
        commands.push(args[1]);
        return { status: 0, stdout: 'area=all\n', stderr: '' };
      },
      log: () => {},
      error: () => {},
    });

    assert.equal(result.ok, true);
    assert.equal(result.area, 'all');
    assert.deepEqual(resolverCalls, [{ area: undefined, worktree: root, resolvedMissionDir: missionDir }]);
    assert.deepEqual(commands, ['echo area=all']);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
