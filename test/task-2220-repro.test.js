const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { writeReviewState, assertReviewStatePersisted } = require('../lib/review/review-state');

test('writeReviewState does not report success when commit fails and state path remains dirty', () => {
  const slug = 'task-2220-repro';
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'task-2220-repro-'));
  const missionDir = path.join(root, 'missions', slug);
  fs.mkdirSync(missionDir, { recursive: true });
  fs.writeFileSync(path.join(missionDir, 'MISSION.md'), `# Mission: ${slug}\n`);

  const gitFn = (args) => {
    if (args.includes('commit')) {
      return { status: 1, stdout: '', stderr: 'pre-commit hook rejected review state' };
    }
    if (args.includes('status')) {
      return { status: 0, stdout: `M missions/${slug}/review-state.json\n`, stderr: '' };
    }
    return { status: 0, stdout: '', stderr: '' };
  };

  try {
    const result = writeReviewState(slug, {
      reviewer: 'codex',
      implementer: 'claude',
      round: 3,
      phase: 'fixing'
    }, root, gitFn);

    assert.deepEqual(result, {
      outcome: 'commit-failed-dirty',
      stage: 'commit',
      diagnostic: 'pre-commit hook rejected review state'
    });
    assert.equal(fs.existsSync(path.join(missionDir, 'review-state.json')), true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('durable review checkpoints fail closed with mission phase round stage and diagnostic', () => {
  assert.throws(
    () => assertReviewStatePersisted(
      { outcome: 'write-failed', stage: 'write', diagnostic: 'rename denied' },
      { slug: 'task-2220', phase: 'fixing', round: 4 }
    ),
    /mission task-2220, phase fixing, round 4, stage write: rename denied/
  );
});
