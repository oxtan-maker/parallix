import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { missionId } from '../src/domain/mission.js';
import { repositoryId } from '../src/domain/repository.js';
import {
  buildCandidate,
  canonicalJson,
  checkpointOrder,
  decisionFromPhase,
  extractNextAction,
  extractTaskId,
  findMissionDir,
  nonNegativeCount,
  normalizeAssignee,
  parseAssigneeValue,
  parseFrontmatter,
  parseGoalCheckTable,
  readCheckpointFiles,
  readMdFiles,
  readMissionReview,
  requiredAgentFamily,
  reviewFromState,
  truncate,
} from '../src/adapters/sqlite/mission-import-parsing.js';

// These tests exercise the parsing module directly: no MissionCompatibilityImporter
// instance, no SQLite adapter, no database (task-2369.10 SC4).

const tempDirs: string[] = [];

function createTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'parallix-import-parsing-'));
  tempDirs.push(dir);
  return dir;
}

after(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('mission import parsing — frontmatter and task identity', () => {
  it('parses scalar, inline-list, and block-list frontmatter values', () => {
    const parsed = parseFrontmatter(
      [
        '---',
        'id: TASK-2369.10',
        'title: Split mission importer parsing',
        'status: refined',
        'assignee: [codex]',
        'labels:',
        '  - ai_sdlc',
        '  - refactor',
        '---',
        '',
        '## Description',
      ].join('\n'),
    );

    assert.equal(parsed.id, 'TASK-2369.10');
    assert.equal(parsed.title, 'Split mission importer parsing');
    assert.equal(parsed.status, 'refined');
    assert.equal(parsed.assignee, '[codex]');
    assert.deepEqual(parsed.labels, ['ai_sdlc', 'refactor']);
  });

  it('returns an empty record when the document has no frontmatter block', () => {
    assert.deepEqual(parseFrontmatter('# Just a heading\n\nBody text.\n'), {});
  });

  it('extracts the task id from frontmatter', () => {
    const dir = createTempDir();
    const file = path.join(dir, 'task-2369.10 - Split.md');
    fs.writeFileSync(file, '---\nid: TASK-2369.10\nstatus: refined\n---\n');
    assert.equal(extractTaskId(file), 'TASK-2369.10');
  });

  it('falls back to the filename prefix when frontmatter has no id', () => {
    const dir = createTempDir();
    const file = path.join(dir, 'task-2369.10 - Split.md');
    fs.writeFileSync(file, '---\nstatus: refined\n---\n');
    assert.equal(extractTaskId(file), 'TASK-2369.10');
  });

  it('returns null when neither frontmatter nor filename carries a task id', () => {
    const dir = createTempDir();
    const file = path.join(dir, 'notes.md');
    fs.writeFileSync(file, '# notes\n');
    assert.equal(extractTaskId(file), null);
  });
});

describe('mission import parsing — filesystem discovery', () => {
  it('reads only .md files and returns an empty list for a missing directory', () => {
    const dir = createTempDir();
    fs.writeFileSync(path.join(dir, 'a.md'), 'a');
    fs.writeFileSync(path.join(dir, 'b.txt'), 'b');

    assert.deepEqual(readMdFiles(dir), [path.join(dir, 'a.md')]);
    assert.deepEqual(readMdFiles(path.join(dir, 'nope')), []);
  });

  it('resolves a mission directory whose name equals the mission id exactly', () => {
    const root = createTempDir();
    const dir = path.join(root, 'missions', 'task-2369.10');
    fs.mkdirSync(dir, { recursive: true });

    const result = findMissionDir(root, missionId('task-2369.10'));
    assert.equal(result.dir, dir);
    assert.deepEqual(result.errors, []);
  });

  it('reports an ambiguous mission directory instead of guessing a prefix match', () => {
    const root = createTempDir();
    fs.mkdirSync(path.join(root, 'missions', 'task-2369.10-extra'), { recursive: true });

    const result = findMissionDir(root, missionId('task-2369.10'));
    assert.equal(result.dir, null);
    assert.equal(result.errors.length, 1);
    assert.match(result.errors[0], /^ambiguous-mission-directory:/);
  });

  it('orders checkpoint filenames by their numeric suffix and sinks unnumbered ones', () => {
    assert.equal(checkpointOrder('CP-2.md'), 2);
    assert.equal(checkpointOrder('CHECKPOINT_10-notes.md'), 10);
    assert.equal(checkpointOrder('summary.md'), Number.MAX_SAFE_INTEGER);
  });
});

describe('mission import parsing — checkpoint artifacts', () => {
  it('parses goal-check rows from a pipe-delimited table', () => {
    const rows = parseGoalCheckTable(
      [
        '# CP-1',
        '',
        '## Goal Check',
        '',
        '| Criterion | Evidence | Status |',
        '|---|---|---|',
        '| SC1 | `npm test` | PASS |',
        '| SC2 | `test/mission-import-parsing.test.ts` | PASS |',
        '',
        'Next action: continue.',
      ].join('\n'),
    );

    assert.deepEqual(rows, [
      { criterion: 'SC1', evidence: '`npm test`' },
      { criterion: 'SC2', evidence: '`test/mission-import-parsing.test.ts`' },
    ]);
  });

  it('returns no goal-check rows when the document has no goal-check table', () => {
    assert.deepEqual(parseGoalCheckTable('# CP-1\n\nNo table here.\n'), []);
  });

  it('extracts the next action section text', () => {
    const content = '# CP-1\n\n## Next action:\nExtract the parsing module.\n';
    assert.equal(extractNextAction(content), 'Extract the parsing module.');
  });

  it('returns an empty string when no next action section is present', () => {
    assert.equal(extractNextAction('# CP-1\n\nNothing to do.\n'), '');
  });

  it('reads checkpoint files in numeric order and records invalid checkpoint names', () => {
    const dir = createTempDir();
    fs.writeFileSync(
      path.join(dir, 'CP-2.md'),
      '# CP-2 second\n\n| Criterion | Evidence | Status |\n|---|---|---|\n| SC2 | `npm test` | PASS |\n\n## Next action:\nShip it.\n',
    );
    fs.writeFileSync(path.join(dir, 'CP-1.md'), '# CP-1 first\n');
    fs.writeFileSync(path.join(dir, 'CHECKPOINT_3-notes.md'), '# stray\n');

    const result = readCheckpointFiles(dir, missionId('task-2369.10'));
    assert.deepEqual(result.checkpoints.map((c) => c.name), ['CP-1', 'CP-2']);
    assert.equal(result.checkpoints[0].firstLine, 'CP-1 first');
    assert.deepEqual(result.checkpoints[1].goalCheck, [
      { criterion: 'SC2', evidence: '`npm test`' },
    ]);
    assert.equal(result.checkpoints[1].nextActionText, 'Ship it.');
    assert.equal(result.errors.length, 1);
    assert.match(result.errors[0], /^invalid-checkpoint-name:/);
  });

  it('returns no checkpoints for a mission directory that does not exist', () => {
    const dir = path.join(createTempDir(), 'absent');
    assert.deepEqual(readCheckpointFiles(dir, missionId('task-2369.10')), {
      checkpoints: [],
      errors: [],
    });
  });
});

describe('mission import parsing — review state', () => {
  const id = missionId('task-2369.10');

  it('builds a review round from a valid review-state.json', () => {
    const dir = createTempDir();
    fs.writeFileSync(
      path.join(dir, 'review-state.json'),
      JSON.stringify({
        reviewer: 'claude',
        implementer: 'codex',
        round: 2,
        startedAt: '2026-08-12T10:00:00.000Z',
        phase: 'approved',
        disposition: 'looks good',
        reviewerRetryCount: 1,
      }),
    );

    const { review, errors } = readMissionReview(dir, id);
    assert.deepEqual(errors, []);
    assert.ok(review);
    assert.equal(review.rounds.length, 1);
    assert.equal(review.rounds[0].number, 2);
    assert.equal(review.rounds[0].reviewer, 'claude');
    assert.equal(review.rounds[0].implementer, 'codex');
    assert.equal(review.rounds[0].decision?.kind, 'approved');
    assert.equal(review.rounds[0].reviewerRetryCount, 1);
    assert.equal(review.rounds[0].subject.change.sourceBranch, `mission/${id}`);
  });

  it('treats an absent review artifact as an omission rather than an error', () => {
    assert.deepEqual(readMissionReview(createTempDir(), id), { review: null, errors: [] });
    assert.deepEqual(readMissionReview(null, id), { review: null, errors: [] });
  });

  it('reports a present but malformed review artifact as a validation error', () => {
    const dir = createTempDir();
    fs.writeFileSync(path.join(dir, 'review-state.json'), '{ not json');

    const { review, errors } = readMissionReview(dir, id);
    assert.equal(review, null);
    assert.equal(errors.length, 1);
    assert.match(errors[0], /^invalid-review-state:/);
  });

  it('rejects a review state whose required fields are missing or out of range', () => {
    const { review, errors } = reviewFromState(
      { reviewer: 'claude', round: 0, startedAt: 'not-a-date' },
      id,
      '/tmp/review-state.json',
    );
    assert.equal(review, null);
    assert.ok(errors.some((e) => e.includes('"implementer" agent family')));
    assert.ok(errors.some((e) => e.includes('"round"')));
    assert.ok(errors.some((e) => e.includes('"startedAt"')));
  });

  it('maps review phases to reviewer decisions', () => {
    assert.deepEqual(decisionFromPhase('approved', null, '2026-08-12T10:00:00.000Z'), {
      kind: 'approved',
      decidedAt: '2026-08-12T10:00:00.000Z',
      comment: null,
      source: { kind: 'local' },
    });
    assert.deepEqual(decisionFromPhase('fixing', 'fix the guard', '2026-08-12T10:00:00.000Z'), {
      kind: 'changes-requested',
      decidedAt: '2026-08-12T10:00:00.000Z',
      comment: 'fix the guard',
      findings: [],
    });
    assert.equal(decisionFromPhase('reviewing', null, '2026-08-12T10:00:00.000Z'), null);
    assert.equal(decisionFromPhase('fixing', null, '2026-08-12T10:00:00.000Z'), null);
  });

  it('records an error instead of substituting a fallback agent family', () => {
    const errors: string[] = [];
    assert.equal(requiredAgentFamily('codex', 'reviewer', '/tmp/review-state.json', errors), 'codex');
    assert.deepEqual(errors, []);

    assert.equal(requiredAgentFamily(undefined, 'reviewer', '/tmp/review-state.json', errors), null);
    assert.match(errors[0], /is missing the required "reviewer" agent family/);

    assert.equal(requiredAgentFamily('Not Valid', 'implementer', '/tmp/review-state.json', errors), null);
    assert.match(errors[1], /has an invalid "implementer" agent family/);
  });
});

describe('mission import parsing — normalization helpers', () => {
  it('parses scalar, inline-list, and array assignee shapes', () => {
    assert.equal(parseAssigneeValue('codex'), 'codex');
    assert.equal(parseAssigneeValue('[codex]'), 'codex');
    assert.equal(parseAssigneeValue('[codex, claude]'), 'codex');
    assert.equal(parseAssigneeValue(['claude', 'codex']), 'claude');
    assert.equal(parseAssigneeValue('[]'), null);
    assert.equal(parseAssigneeValue([]), null);
  });

  it('strips YAML quotes and @ mention prefixes from an assignee token', () => {
    assert.equal(normalizeAssignee("'codex'"), 'codex');
    assert.equal(normalizeAssignee('"codex"'), 'codex');
    assert.equal(normalizeAssignee('@codex'), 'codex');
    assert.equal(normalizeAssignee('   '), null);
  });

  it('serializes object keys in a stable order and treats undefined as null', () => {
    assert.equal(canonicalJson({ b: 1, a: 2 }), canonicalJson({ a: 2, b: 1 }));
    assert.equal(canonicalJson(undefined), 'null');
    assert.equal(canonicalJson({ a: undefined }), '{}');
    // Array order is meaningful and is preserved.
    assert.notEqual(canonicalJson([1, 2]), canonicalJson([2, 1]));
  });

  it('clamps unusable retry counters to zero', () => {
    assert.equal(nonNegativeCount(3), 3);
    assert.equal(nonNegativeCount(0), 0);
    assert.equal(nonNegativeCount(-1), 0);
    assert.equal(nonNegativeCount(1.5), 0);
    assert.equal(nonNegativeCount('4'), 0);
    assert.equal(nonNegativeCount(undefined), 0);
  });

  it('truncates only values longer than the limit', () => {
    assert.equal(truncate('short', 10), 'short');
    assert.equal(truncate('abcdefghij', 5), 'abcde…');
  });
});

describe('mission import parsing — candidate construction', () => {
  it('builds a candidate with frontmatter, checkpoints, and review data', () => {
    const root = createTempDir();
    const tasksDir = path.join(root, 'backlog', 'tasks');
    fs.mkdirSync(tasksDir, { recursive: true });
    const taskFile = path.join(tasksDir, 'task-2369.10 - Split.md');
    fs.writeFileSync(
      taskFile,
      [
        '---',
        'id: TASK-2369.10',
        'title: Split mission importer parsing',
        'status: refined',
        'assignee: [codex]',
        'labels: [ai_sdlc]',
        '---',
        '',
        '## Description',
      ].join('\n'),
    );

    const missionDir = path.join(root, 'missions', 'task-2369.10');
    fs.mkdirSync(missionDir, { recursive: true });
    fs.writeFileSync(missionDir + '/CP-1.md', '# CP-1 mapping\n\n## Next action:\nExtract.\n');

    const candidate = buildCandidate(taskFile, {
      rootDir: root,
      repositoryId: repositoryId('parallix'),
    });

    assert.ok(candidate);
    assert.equal(candidate.missionId, missionId('task-2369.10'));
    assert.equal(candidate.title, 'Split mission importer parsing');
    assert.equal(candidate.rawStatus, 'refined');
    assert.equal(candidate.assignee, 'codex');
    assert.deepEqual([...candidate.labels], ['[ai_sdlc]']);
    assert.deepEqual(candidate.checkpoints.map((c) => c.name), ['CP-1']);
    assert.equal(candidate.checkpoints[0].nextActionText, 'Extract.');
    assert.equal(candidate.review, null);
    assert.deepEqual([...candidate.validationErrors], []);
  });

  it('reports an unmappable status as a validation error and defaults to backlog', () => {
    const root = createTempDir();
    const taskFile = path.join(root, 'task-2369.10 - Split.md');
    fs.writeFileSync(taskFile, '---\nid: TASK-2369.10\nstatus: nonsense\n---\n');

    const candidate = buildCandidate(taskFile, {
      rootDir: root,
      repositoryId: repositoryId('parallix'),
    });

    assert.ok(candidate);
    assert.equal(candidate.status, 'backlog');
    assert.ok(candidate.validationErrors.some((e) => e.startsWith('unmappable-status:')));
  });

  it('returns null when the source file carries no task id', () => {
    const root = createTempDir();
    const taskFile = path.join(root, 'notes.md');
    fs.writeFileSync(taskFile, '# notes\n');

    assert.equal(
      buildCandidate(taskFile, { rootDir: root, repositoryId: repositoryId('parallix') }),
      null,
    );
  });
});
