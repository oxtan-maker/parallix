// TASK-2322.12 CP 4 — boundary enforcement for the ADR 0053 cutover.
//
// The mission's job was to remove the last file-backed writers for
// `database-owned-domain-state` and prove none come back. These are the
// standing checks that would fail if one did:
//
//   (a) SC4  — no `src/interfaces/` file reaches SQLite, the adapter factory,
//              or raw SQL; presentation talks to application ports.
//   (b) SC5  — no `src/adapters/sqlite/` file imports the composition root.
//   (c) SC6  — no production file performs durable IO for a database-owned
//              concept without an `ADR0053_PERSISTENCE_INVENTORY` entry, and
//              the review paths this mission cut over stay cut over.
//   (d) SC10 — no deferred-migration marker survives in `src/`.
//
// Each check reports the offending file, because "some boundary broke" is not
// actionable at the point a future mission trips one of these.

import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';

import {
  ADR0053_PERSISTENCE_INVENTORY,
} from '../src/platform/runtime/lib/core/durable-state-inventory.js';

const ROOT = process.cwd();

function walk(dir: string): string[] {
  if (!fs.existsSync(dir)) { return []; }
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      return ['node_modules', 'dist', '.git'].includes(entry.name) ? [] : walk(full);
    }
    return entry.isFile() && entry.name.endsWith('.ts') ? [full] : [];
  });
}

function relative(file: string): string {
  return path.relative(ROOT, file);
}

/** Import specifiers, so a mention inside a string or comment is not a hit. */
function importSpecifiers(source: string): string[] {
  return [...source.matchAll(/(?:from\s+|import\s*(?:\(\s*)?)['"]([^'"]+)['"]/g)]
    .map((match) => match[1]);
}

/** Strip comments so prose about SQL does not read as SQL. */
function withoutComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((line) => line.replace(/\/\/.*$/, ''))
    .join('\n');
}

// ---------------------------------------------------------------------------
// (a) SC4 — presentation stays behind application ports
// ---------------------------------------------------------------------------

test('SC4: no src/interfaces file imports SQLite, the adapter factory, or raw SQL', () => {
  const forbiddenImport = /(?:^|\/)(?:node:)?sqlite|database-adapter|adapter-factory|mission-store|\/adapters\/sqlite\//;
  const rawSql = /\b(?:SELECT|INSERT\s+INTO|UPDATE|DELETE\s+FROM|CREATE\s+TABLE|ALTER\s+TABLE)\b[\s\S]{0,80}?\b(?:FROM|INTO|SET|TABLE|VALUES)\b/i;

  const violations: string[] = [];
  for (const file of walk(path.join(ROOT, 'src', 'interfaces'))) {
    const source = fs.readFileSync(file, 'utf8');
    for (const specifier of importSpecifiers(source)) {
      if (forbiddenImport.test(specifier)) {
        violations.push(`${relative(file)}: imports ${specifier}`);
      }
    }
    if (source.includes('initOperatorState')) {
      violations.push(`${relative(file)}: references initOperatorState`);
    }
    if (rawSql.test(withoutComments(source))) {
      violations.push(`${relative(file)}: contains a raw SQL statement`);
    }
  }

  assert.deepEqual(violations, [], `Presentation must reach persistence through application ports:\n${violations.join('\n')}`);
});

test('SC4 detector bites: a SQLite import under interfaces/ would be reported', () => {
  const forbiddenImport = /(?:^|\/)(?:node:)?sqlite|database-adapter|adapter-factory|mission-store|\/adapters\/sqlite\//;
  assert.ok(forbiddenImport.test('../../adapters/sqlite/mission-store.js'));
  assert.ok(forbiddenImport.test('node:sqlite'));
  assert.ok(!forbiddenImport.test('../../application/projections/mission-board.js'));
});

// ---------------------------------------------------------------------------
// (b) SC5 — adapters do not reach back into the composition root
// ---------------------------------------------------------------------------

test('SC5: no src/adapters/sqlite file imports the production composition root', () => {
  const violations: string[] = [];
  for (const file of walk(path.join(ROOT, 'src', 'adapters', 'sqlite'))) {
    const source = fs.readFileSync(file, 'utf8');
    for (const specifier of importSpecifiers(source)) {
      if (specifier.includes('composition/application-services')) {
        violations.push(`${relative(file)}: imports ${specifier}`);
      }
    }
    if (withoutComments(source).includes('createProductionApplicationServices')) {
      violations.push(`${relative(file)}: references createProductionApplicationServices`);
    }
  }

  assert.deepEqual(violations, [], `An adapter that builds the composition root inverts the dependency:\n${violations.join('\n')}`);
});

// ---------------------------------------------------------------------------
// (c) SC6 — durable IO for a database-owned concept stays declared
// ---------------------------------------------------------------------------

test('SC6: review-state.ts declares only the one-way legacy import, never a writer', () => {
  // The loop's review state is the Review aggregate. The single entry left for
  // this file is the operator-invoked `--backfill-review` import; a write entry,
  // or a read classified as domain state, means review-state.json came back as
  // a live authority.
  const entries = ADR0053_PERSISTENCE_INVENTORY.filter(
    (entry) => entry.fileLocation.endsWith('review/review-state.ts'),
  );
  assert.deepEqual(
    entries.map((entry) => `${entry.id}:${entry.operation}:${entry.classification}`),
    ['review-import-legacy-review-state:read:explicit-one-way-legacy-input'],
    'review-state.ts is served by the Review aggregate; only the one-way legacy import may be declared',
  );
});

test('SC1: no inventory entry still defers to the TASK-2322.12 cutover', () => {
  const deferred = ADR0053_PERSISTENCE_INVENTORY
    .filter((entry) => entry.cutoverTask === 'TASK-2322.12')
    .map((entry) => `${entry.id} (${entry.fileLocation})`);

  assert.deepEqual(
    deferred,
    [],
    `The cutover is done; an entry naming it as a future task is a deferred migration:\n${deferred.join('\n')}`,
  );
});

test('SC2/SC3: no review module or statistics path declares database-owned file IO for Review', () => {
  // The Review aggregate is the only authority. These four files were the last
  // ones holding a file-backed copy of review round state, event storage, or
  // implementer inference; an entry reappearing for any of them means one came
  // back. The Markdown export declared by review-events.ts is a
  // `generated-artifact`, not domain state, so it is not caught here — and the
  // next test is what keeps it write-only.
  const cutOver = [
    'src/platform/runtime/lib/review/review-state.ts',
    'src/platform/runtime/lib/review/review-events.ts',
    'src/platform/runtime/lib/review/review-artifacts.ts',
    'src/platform/runtime/lib/review/review-commands.ts',
    'src/platform/runtime/lib/commands/stats.ts',
  ];
  const declared = ADR0053_PERSISTENCE_INVENTORY
    .filter((entry) => entry.classification === 'database-owned-domain-state')
    .filter((entry) => cutOver.includes(entry.fileLocation))
    .map((entry) => `${entry.id} (${entry.fileLocation} ${entry.operation})`);

  assert.deepEqual(declared, [], `A cut-over review path declares durable IO again:\n${declared.join('\n')}`);
});

test('SC2/SC3: no production file reads the review-event export back', () => {
  // The Markdown under missions/<slug>/review-events/ is rendered from the
  // stored event. A reader turns it back into a second source of truth, which
  // is the dual authority ADR 0053 removed — so reading the export directory,
  // or parsing an event file, is the thing to catch.
  const readsTheExport = /readdirSync\s*\([^)]*review-events|review-events['"][^)]*\)\s*[\s\S]{0,80}readFileSync|parseEventFile/;

  const violations: string[] = [];
  for (const file of walk(path.join(ROOT, 'src'))) {
    const source = withoutComments(fs.readFileSync(file, 'utf8'));
    if (readsTheExport.test(source)) {
      violations.push(relative(file));
    }
  }

  assert.deepEqual(violations, [], `A production file reads the review-event export:\n${violations.join('\n')}`);
});

test('SC3: statistics do not import the review modules\' event or state readers', () => {
  const source = fs.readFileSync(
    path.join(ROOT, 'src/platform/runtime/lib/commands/stats.ts'),
    'utf8',
  );
  const code = withoutComments(source);
  // Both readers are named by SC3. `readAllEvents` is the event-store reader;
  // `readReviewState` is the review module's flat state view. Even though the
  // latter now resolves from SQLite, routing statistics through it re-couples
  // the projection to the review loop's persistence facade, which is the seam
  // a file-backed reader would come back through.
  const forbidden = ['readAllEvents', 'readReviewState', 'readReviewRounds']
    .filter((symbol) => new RegExp(`\\b${symbol}\\b`).test(code));

  assert.deepEqual(
    forbidden,
    [],
    `stats.ts must read review data from the operator database, not the review modules' readers: ${forbidden.join(', ')}`,
  );
});

test('SC6: every file-backed compatibility path for a database-owned concept names its cutover', () => {
  // A compatibility entry that already lives in src/adapters/sqlite is the
  // database talking to itself and needs no cutover. One outside it is a file
  // path still holding database-owned state, and an undated file path is how a
  // stray writer hides in plain sight.
  const undated = ADR0053_PERSISTENCE_INVENTORY
    .filter((entry) => entry.classification === 'database-owned-domain-state')
    .filter((entry) => entry.pathType === 'compatibility' && !entry.cutoverTask)
    .filter((entry) => !entry.fileLocation.startsWith('src/adapters/sqlite/'))
    .map((entry) => `${entry.id} (${entry.fileLocation})`);

  assert.deepEqual(undated, [], `A file-backed compatibility path with no cutover task is a deferred migration:\n${undated.join('\n')}`);
});

// ---------------------------------------------------------------------------
// (d) SC10 — no deferred migration markers
// ---------------------------------------------------------------------------

test('SC10: no deferred migration or shadow-write marker remains under src/', () => {
  const markers: Array<{ pattern: RegExp; label: string }> = [
    { pattern: /TODO[^\n]{0,40}\b(?:migration|cutover)\b/i, label: 'deferred migration TODO' },
    { pattern: /FIXME[^\n]{0,40}\bpersistence\b/i, label: 'persistence FIXME' },
    { pattern: /\bshadow[- ]write\b/i, label: 'shadow write' },
    { pattern: /\bbidirectional\s+sync(?:hronization)?\b/i, label: 'bidirectional synchronization' },
  ];

  const findings: string[] = [];
  for (const file of walk(path.join(ROOT, 'src'))) {
    const source = fs.readFileSync(file, 'utf8');
    source.split('\n').forEach((line, index) => {
      // A line that says a shadow write is forbidden is not a shadow write.
      if (/\b(?:forbid|forbids|forbidden|must not|never|no)\b/i.test(line)) { return; }
      for (const { pattern, label } of markers) {
        if (pattern.test(line)) {
          findings.push(`${relative(file)}:${index + 1}: ${label}`);
        }
      }
    });
  }

  assert.deepEqual(findings, [], `Deferred-migration markers must not survive the cutover:\n${findings.join('\n')}`);
});
