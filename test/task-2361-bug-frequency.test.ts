import test from 'node:test';
import assert from 'node:assert/strict';

import {
  measureBugFrequency,
  type BugFrequencyTaskFile,
} from '../src/application/projections/bug-frequency.js';

// Fixture builder: a task file with block-list labels, mirroring the backlog
// store format the cohort report reads at report time.
function taskFile(options: {
  path: string;
  id: string;
  labels?: readonly string[];
  status?: string;
  store?: BugFrequencyTaskFile['store'];
  rawText?: string;
}): BugFrequencyTaskFile {
  const labelsBlock = (options.labels ?? [])
    .map((label) => `  - ${label}`)
    .join('\n');
  const text = options.rawText ?? [
    '---',
    `id: ${options.id}`,
    `title: fixture ${options.id}`,
    `status: ${options.status ?? 'done'}`,
    'labels:',
    labelsBlock,
    '---',
    '',
    'fixture body',
    '',
  ].join('\n');
  return { path: options.path, rawText: text, store: options.store ?? 'completed' };
}

test('unions labels across duplicate copies of one task id', () => {
  const measurement = measureBugFrequency({
    cohortIds: ['TASK-2001'],
    files: [
      taskFile({ path: 'backlog/completed/task-2001 - fixture.md', id: 'TASK-2001', labels: ['user_value'] }),
      taskFile({ path: 'backlog/tasks/task-2001 - fixture.md', id: 'TASK-2001', labels: ['bug'], store: 'tasks' }),
    ],
  });
  assert.equal(measurement.total, 1);
  assert.equal(measurement.bug, 1);
  assert.equal(measurement.nonBug, 0);
  assert.deepEqual(measurement.bugIds, ['TASK-2001']);
  const row = measurement.rows[0];
  assert.equal(row?.copies, 2);
  assert.deepEqual(row?.labelUnion, ['bug', 'user_value']);
  assert.deepEqual(row?.copyPaths, [
    'backlog/completed/task-2001 - fixture.md:2',
    'backlog/tasks/task-2001 - fixture.md:2',
  ]);
  assert.deepEqual(measurement.aborts, []);
});

test('classifies by the labels present at report time, so a bug label added after the transition commit counts', () => {
  // The transition commit itself is never read; the runner hands the module
  // the working-tree copies as they exist now. A `bug` label attached after
  // completion therefore lands in the label union and moves the numerator.
  const measurement = measureBugFrequency({
    cohortIds: ['TASK-2002'],
    files: [
      taskFile({
        path: 'backlog/completed/task-2002 - fixture.md',
        id: 'TASK-2002',
        labels: ['ai_sdlc', 'bug'],
      }),
    ],
  });
  assert.equal(measurement.bug, 1);
  assert.equal(measurement.nonBug, 0);
  assert.equal(measurement.bugOverTotal, 1);
  assert.equal(measurement.bugPer100NonBug, null);
});

test('counts only the exact bug label, not lookalikes or title keywords', () => {
  const measurement = measureBugFrequency({
    cohortIds: ['TASK-2003', 'TASK-2004'],
    files: [
      taskFile({
        path: 'backlog/completed/task-2003 - fix-the-bugs.md',
        id: 'TASK-2003',
        labels: ['bugs', 'reliability'],
      }),
      taskFile({
        path: 'backlog/completed/task-2004 - fixture.md',
        id: 'TASK-2004',
        labels: ['bug'],
      }),
    ],
  });
  assert.deepEqual(measurement.bugIds, ['TASK-2004']);
  assert.deepEqual(measurement.nonBugIds, ['TASK-2003']);
  assert.equal(measurement.bugOverTotal, 0.5);
  assert.equal(measurement.bugPer100NonBug, 100);
});

test('reports malformed frontmatter as a warning without aborting the run', () => {
  const measurement = measureBugFrequency({
    cohortIds: ['TASK-2005', 'TASK-2006'],
    files: [
      taskFile({
        path: 'backlog/completed/task-2005 - unterminated.md',
        id: 'TASK-2005',
        rawText: '---\nid: TASK-2005\nstatus: done\nlabels:\n  - bug\n',
      }),
      taskFile({ path: 'backlog/completed/task-2006 - fixture.md', id: 'TASK-2006', labels: ['user_value'] }),
    ],
  });
  assert.deepEqual(measurement.warnings, [
    'backlog/completed/task-2005 - unterminated.md: unterminated frontmatter',
  ]);
  // The malformed record is skipped, but the run continues and the healthy
  // cohort member is still classified.
  assert.deepEqual(measurement.nonBugIds, ['TASK-2006']);
  assert.equal(measurement.total, 1);
});

test('aborts ambiguous id or label data instead of classifying the record', () => {
  const measurement = measureBugFrequency({
    cohortIds: ['TASK-2007', 'TASK-2008', 'TASK-2009'],
    files: [
      taskFile({
        path: 'backlog/completed/task-2007 - ambiguous-id.md',
        id: 'TASK-2007',
        rawText: '---\nid: TASK-2007-draft\nstatus: done\nlabels:\n  - bug\n---\n',
      }),
      taskFile({
        path: 'backlog/completed/task-2008 - mismatched-id.md',
        id: 'TASK-9999',
      }),
      taskFile({
        path: 'backlog/completed/task-2009 - scalar-labels.md',
        id: 'TASK-2009',
        rawText: '---\nid: TASK-2009\nstatus: done\nlabels: bug\n---\n',
      }),
    ],
  });
  assert.deepEqual(measurement.aborts, [
    'backlog/completed/task-2007 - ambiguous-id.md:2 ambiguous id "TASK-2007-draft"',
    'backlog/completed/task-2008 - mismatched-id.md:2 filename id TASK-2008 != frontmatter id TASK-9999',
    'backlog/completed/task-2009 - scalar-labels.md:4 unparseable labels scalar "bug"',
    // Aborted records never reach the index, so the cohort loop records the
    // missing members as well — exactly as the cohort-1 audit did.
    'TASK-2007: no task record found in any store',
    'TASK-2008: no task record found in any store',
    'TASK-2009: no task record found in any store',
  ]);
  // None of the ambiguous records may be classified in either direction.
  assert.equal(measurement.total, 0);
  assert.deepEqual(measurement.bugIds, []);
  assert.deepEqual(measurement.nonBugIds, []);
  assert.equal(measurement.bugOverTotal, null);
});

test('aborts an unterminated inline label list instead of classifying the partial copy', () => {
  const measurement = measureBugFrequency({
    cohortIds: ['TASK-2020', 'TASK-2021'],
    files: [
      taskFile({
        path: 'backlog/completed/task-2020 - unterminated-inline.md',
        id: 'TASK-2020',
        rawText: [
          '---',
          'id: TASK-2020',
          'status: done',
          'labels: [bug',
          '---',
          '',
        ].join('\n'),
      }),
      taskFile({ path: 'backlog/completed/task-2021 - fixture.md', id: 'TASK-2021', labels: ['user_value'] }),
    ],
  });
  // `labels: [bug` is malformed frontmatter: no closing bracket, so the record
  // aborts (fail closed) rather than yielding the label `bu`.
  assert.ok(measurement.aborts.some((a) => a.includes('unterminated-inline.md:4 unterminated inline label list')));
  assert.deepEqual(measurement.bugIds, []);
  assert.deepEqual(measurement.nonBugIds, ['TASK-2021']);
  assert.equal(measurement.total, 1);
});

test('parses a real frozen member with trailing junk after the inline list', () => {
  // The frozen cohort member TASK-2305 has `labels: [ai_sdlc]y` in the working
  // tree: a well-formed inline list with a trailing character. This must not
  // abort; it classifies as the non-bug label `ai_sdlc` so the report
  // reproduces the published 20 / 6 / 14. This is the round-2 regression the
  // reviewer caught, kept as regression protection.
  const measurement = measureBugFrequency({
    cohortIds: ['TASK-2305'],
    files: [
      taskFile({
        path: 'backlog/completed/task-2305 - real.md',
        id: 'TASK-2305',
        rawText: [
          '---',
          'id: TASK-2305',
          'title: >-',
          '  Ink TUI wave 3',
          'status: done',
          'labels: [ai_sdlc]y',
          '---',
          '',
        ].join('\n'),
      }),
    ],
  });
  assert.equal(measurement.total, 1);
  assert.equal(measurement.bug, 0);
  assert.equal(measurement.nonBug, 1);
  assert.deepEqual(measurement.aborts, []);
  assert.deepEqual(measurement.nonBugIds, ['TASK-2305']);
});

test('records fail-closed aborts for cohort members with no readable record', () => {
  const measurement = measureBugFrequency({
    cohortIds: ['TASK-2010', 'TASK-2011'],
    files: [
      taskFile({
        path: 'backlog/tasks/task-2010 - only-open-copy.md',
        id: 'TASK-2010',
        labels: ['bug'],
        store: 'tasks',
      }),
    ],
  });
  // TASK-2010 has a copy but none in the completed store: classified from the
  // label union, with the anomaly recorded as an abort entry.
  assert.deepEqual(measurement.bugIds, ['TASK-2010']);
  assert.ok(measurement.aborts.includes('TASK-2010: no completed-store copy at report time'));
  // TASK-2011 has no copy anywhere: excluded from every count.
  assert.ok(measurement.aborts.includes('TASK-2011: no task record found in any store'));
  assert.deepEqual(measurement.nonBugIds, []);
  assert.equal(measurement.total, 1);
});

test('aborts a malformed indented label list instead of classifying the partial copy', () => {
  const measurement = measureBugFrequency({
    cohortIds: ['TASK-2012', 'TASK-2013'],
    files: [
      taskFile({
        path: 'backlog/completed/task-2012 - malformed-indented-list.md',
        id: 'TASK-2012',
        rawText: [
          '---',
          'id: TASK-2012',
          'status: done',
          'labels:',
          '  - user_value',
          '    malformed-indented-line',
          '  - bug',
          '---',
          '',
        ].join('\n'),
      }),
      taskFile({ path: 'backlog/completed/task-2013 - fixture.md', id: 'TASK-2013', labels: ['user_value'] }),
    ],
  });
  // The indented non-list line aborts the record (fail closed), not just the
  // label line before it.
  assert.ok(measurement.aborts.some((a) => a.includes('malformed-indented-list.md:6 unparseable label line')));
  // The partially parsed copy is not indexed: only the healthy member is classified.
  assert.deepEqual(measurement.bugIds, []);
  assert.deepEqual(measurement.nonBugIds, ['TASK-2013']);
  assert.equal(measurement.total, 1);
});

test('computes the cohort-1 shape exactly: bug / total and 100 * bug / non-bug', () => {
  const files: BugFrequencyTaskFile[] = [];
  for (let i = 0; i < 20; i += 1) {
    const id = `TASK-${2100 + i}`;
    files.push(taskFile({
      path: `backlog/completed/task-${2100 + i} - fixture.md`,
      id,
      labels: i < 4 ? ['ai_sdlc', 'bug'] : ['user_value'],
    }));
  }
  const measurement = measureBugFrequency({
    cohortIds: files.map((file) => file.rawText.match(/^id: (TASK-\d+)$/m)?.[1] ?? ''),
    files,
  });
  assert.equal(measurement.total, 20);
  assert.equal(measurement.bug, 4);
  assert.equal(measurement.nonBug, 16);
  assert.equal(measurement.bugOverTotal, 0.2);
  assert.equal(measurement.bugPer100NonBug, 25);
});
