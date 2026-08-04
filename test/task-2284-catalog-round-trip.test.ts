import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  diffTaskRecords,
  parseTaskRecord,
  roundTrip,
  type TaskRecord,
} from './helpers/task-2284-catalog-round-trip.js';

const root = process.cwd();
// TASK-2284 is the real completed-store exemplar for this catalog migration.
// It is no longer an active backlog task after its lifecycle transition.
const MISSION_TASK = 'backlog/completed/task-2284 - Decide-future-task-catalog-authority-and-board-authorship-migration.md';

// A synthetic record that carries every frontmatter key named by the mission
// plus two extension keys no reader in src/adapters/backlog/backlog.ts
// consumes: `source` (written by px draft) and `x_operator_channel`.
const FIXTURE = [
  '---',
  'id: TASK-9999',
  'title: Fixture: round-trip probe',
  'status: refined',
  'assignee: [claude, magnus]',
  "created_date: '2026-07-01 09:15'",
  "updated_date: '2026-07-27 11:00'",
  'title_note: >-',
  '  A folded block scalar, the shape that vanishes when a reader only matches',
  '  a single-line value.',
  'labels:',
  '  - architecture',
  '  - user_value',
  'dependencies: [TASK-2307]',
  'references:',
  '  - docs/adr/0051-ui-neutral-application-boundary.md',
  '  - >-',
  '    backlog/completed/task-2307 - Ink-TUI-wave-5-guarded-actions-confirmation-',
  '    cancellation-and-progress-operation-log.md',
  '  - backlog/config.yml',
  'priority: medium',
  'source: synthetic',
  'x_operator_channel: nightly',
  '---',
  '',
  '## Description',
  '',
  '<!-- SECTION:DESCRIPTION:BEGIN -->',
  'First description paragraph.',
  '',
  'Second paragraph with a colon: and a [bracket].',
  '<!-- SECTION:DESCRIPTION:END -->',
  '',
  '## Acceptance Criteria',
  '<!-- AC:BEGIN -->',
  '- [x] #1 Frontmatter survives the trip',
  '- [ ] #2 Description survives the trip',
  '- [ ] #3 Checklists survive the trip',
  '<!-- AC:END -->',
  '',
  '## Definition of Done',
  '',
  '<!-- DOD:BEGIN -->',
  '- [x] #1 Verification gate ran',
  '- [ ] #2 Evidence cited',
  '<!-- DOD:END -->',
  '',
].join('\n');

function withTempCopies(files: readonly string[], run: (_copies: readonly string[]) => void): void {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'task-2284-round-trip-')));
  try {
    const copies = files.map((relative, index) => {
      const target = path.join(dir, `${index}-${path.basename(relative)}`);
      fs.copyFileSync(path.join(root, relative), target);
      return target;
    });
    run(copies);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function firstTaskFile(relativeDir: string, exclude: string = ''): string {
  const absolute = path.join(root, relativeDir);
  const file = fs.readdirSync(absolute)
    .filter(name => name.endsWith('.md') && name !== exclude)
    .sort()[0];
  assert.ok(file, `expected at least one task record in ${relativeDir}`);
  return path.posix.join(relativeDir, file);
}

function findTaskFile(fileName: string, stores: readonly string[]): string {
  for (const store of stores) {
    const relative = path.posix.join(store, fileName);
    if (fs.existsSync(path.join(root, relative))) {
      return relative;
    }
  }
  assert.fail(`expected to find ${fileName} in one of: ${stores.join(', ')}`);
}

function entry(record: TaskRecord, key: string): unknown {
  return record.frontmatter.find(item => item.key === key)?.value;
}

test('round trip preserves every named frontmatter key, including unknown extension keys', () => {
  const result = roundTrip(FIXTURE);

  assert.deepEqual(result.differences, [], 'fixture round trip must report zero field differences');
  assert.equal(result.byteIdentical, true, 'canonical re-serialization must reproduce the fixture byte for byte');

  for (const key of [
    'id', 'title', 'status', 'assignee', 'created_date', 'updated_date',
    'labels', 'dependencies', 'references', 'priority',
  ]) {
    assert.ok(entry(result.parsed, key), `frontmatter key ${key} must be captured by the record`);
  }

  // Extension keys: not read by any function in lib/tools/backlog.ts.
  assert.deepEqual(entry(result.parsed, 'source'), { kind: 'scalar', text: 'synthetic' });
  assert.deepEqual(entry(result.parsed, 'x_operator_channel'), { kind: 'scalar', text: 'nightly' });

  // Spelling of each collection is preserved, not normalized to one form.
  assert.deepEqual(entry(result.parsed, 'assignee'), { kind: 'inline-list', items: ['claude', 'magnus'], raw: 'claude, magnus' });
  assert.deepEqual(entry(result.parsed, 'labels'), {
    kind: 'block-list',
    items: [
      { kind: 'plain', value: 'architecture', raw: 'architecture' },
      { kind: 'plain', value: 'user_value', raw: 'user_value' },
    ],
    indent: '  ',
  });

  // Folded block scalars survive both as a value and as a list item. A reader
  // that only matches `^key:\s*(.+)$` loses their continuation lines silently.
  assert.deepEqual(entry(result.parsed, 'title_note'), {
    kind: 'block-scalar',
    scalar: {
      header: '>-',
      lines: [
        '  A folded block scalar, the shape that vanishes when a reader only matches',
        '  a single-line value.',
      ],
    },
  });
  const references = entry(result.parsed, 'references') as { items: readonly { kind: string }[] };
  assert.equal(references.items.filter(item => item.kind === 'folded').length, 1);
});

test('round trip preserves the SECTION:DESCRIPTION body and every AC and DOD item with its checked state and index', () => {
  const result = roundTrip(FIXTURE);
  const reparsed = parseTaskRecord(result.serialized);

  assert.match(reparsed.description ?? '', /First description paragraph\./);
  assert.match(reparsed.description ?? '', /Second paragraph with a colon: and a \[bracket\]\./);
  assert.equal(reparsed.description, result.parsed.description);

  assert.deepEqual(reparsed.acceptanceCriteria, [
    { index: '1', checked: true, text: 'Frontmatter survives the trip' },
    { index: '2', checked: false, text: 'Description survives the trip' },
    { index: '3', checked: false, text: 'Checklists survive the trip' },
  ]);
  assert.deepEqual(reparsed.definitionOfDone, [
    { index: '1', checked: true, text: 'Verification gate ran' },
    { index: '2', checked: false, text: 'Evidence cited' },
  ]);
});

test('round trip reports zero field differences for real task records copied from all three stores', () => {
  const sources = [
    MISSION_TASK,
    firstTaskFile('backlog/tasks'),
    firstTaskFile('backlog/completed'),
  ];
  const before = sources.map(relative => fs.readFileSync(path.join(root, relative)));

  withTempCopies(sources, copies => {
    for (const copy of copies) {
      const source = fs.readFileSync(copy, 'utf8');
      const result = roundTrip(source);
      assert.deepEqual(result.differences, [], `${path.basename(copy)} must round trip with zero field differences`);
      assert.equal(result.serialized, source, `${path.basename(copy)} must re-serialize byte for byte`);
      assert.equal(fs.readFileSync(copy, 'utf8'), source, 'the harness must not write to the task file it reads');
    }
  });

  const after = sources.map(relative => fs.readFileSync(path.join(root, relative)));
  sources.forEach((relative, index) => {
    assert.ok(before[index].equals(after[index]), `${relative} must be byte-identical after the round trip`);
  });
});

// Two stored records are not valid YAML frontmatter and cannot round trip.
// They are migration evidence, not defects in the harness: today's readers
// accept both silently, because each reader is an independent regex over raw
// text with no schema validation. Both files are in a Restricted Area for
// TASK-2284, so they are pinned here rather than repaired.
const KNOWN_CORRUPT: ReadonlyMap<string, string> = new Map([
  [
    'backlog/completed/task-1373 - TASK-1374-Mission-10-Tools-module-backlog-forgejo-gatekeeper-redgreen-sessions-setup-review.md',
    'unresolved Git conflict markers inside the frontmatter, with two competing status/assignee/labels blocks',
  ],
  [
    'backlog/completed/task-1385 - Enforce-pre-review-exact-tree-verification-and-auto-bounce-on-failure.md',
    'updated_date is indented under created_date, so no `^updated_date:` reader can see it',
  ],
]);

test('round trip is lossless across every task record in backlog/tasks, backlog/completed, and backlog/archive/tasks', () => {
  const stores = ['backlog/tasks', 'backlog/completed', 'backlog/archive/tasks'];
  const failures: string[] = [];
  let examined = 0;

  for (const store of stores) {
    const absolute = path.join(root, store);
    if (!fs.existsSync(absolute)) { continue; }
    for (const name of fs.readdirSync(absolute).filter(file => file.endsWith('.md'))) {
      if (KNOWN_CORRUPT.has(`${store}/${name}`)) { continue; }
      const source = fs.readFileSync(path.join(absolute, name), 'utf8');
      examined += 1;
      const result = roundTrip(source);
      const differences = diffTaskRecords(parseTaskRecord(source), parseTaskRecord(result.serialized));
      if (differences.length > 0) {
        failures.push(`${store}/${name}: ${differences.map(d => d.field).join(', ')}`);
      }
      // Field equality alone would pass on symmetric loss — a value the parser
      // drops is absent from both sides. Byte equality is what catches that.
      if (!result.byteIdentical) {
        failures.push(`${store}/${name}: re-serialization is not byte-identical`);
      }
    }
  }

  assert.ok(examined > 100, `expected the real catalog to supply records, examined ${examined}`);
  assert.deepEqual(failures, [], 'every stored task record must survive the round trip');
});

test('the harness detects the stored task records whose frontmatter is corrupt', () => {
  const detected: string[] = [];
  for (const [relative, reason] of KNOWN_CORRUPT) {
    const source = fs.readFileSync(path.join(root, relative), 'utf8');
    const result = roundTrip(source);
    assert.equal(
      result.byteIdentical,
      false,
      `${relative} is expected to fail re-serialization (${reason}); if it now round trips, the record was repaired and this pin should be removed`,
    );
    detected.push(relative);
  }
  assert.deepEqual(detected, [...KNOWN_CORRUPT.keys()]);

  // The first record reads as two different missions depending on which regex
  // match a reader takes — the concrete failure mode of unvalidated text
  // authority that the original task-catalog investigation identified.
  const conflicted = fs.readFileSync(path.join(root, [...KNOWN_CORRUPT.keys()][0]), 'utf8');
  assert.match(conflicted, /^<<<<<<< /m);
  assert.match(conflicted, /^status: done$/m);
  assert.match(conflicted, /^status: backlog$/m);
});
