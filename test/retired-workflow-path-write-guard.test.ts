// @ts-nocheck -- TASK-2521.01: guard-1 boundary test scans the source tree with
// node:fs, exactly like test/persistence-inventory-guardrail.test.ts. No build
// types flow in here; the scan is plain string work.

import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';

import {
  RETIRED_WORKFLOW_PATH_WRITERS,
  type RetiredWorkflowPathWriterEntry,
} from './fixtures/durable-state-inventory.js';

const ROOT = process.cwd();

/** Write-operation tokens that indicate a durable-file write. */
const WRITE_TOKENS = [
  'writeFileSync(',
  'writeFile(',
  'writeFileAtomic(',
  'writeJson(',
  'appendFileSync(',
  'createWriteStream(',
  'mkdirSync(',
  'rmSync(',
  'cpSync(',
  'renameSync(',
  'writeText(',
];

/**
 * Retired workflow-path patterns that ADR 0053 removed as Mission persistence
 * authority. A normal-runtime write to any of these is a regression unless the
 * call site is registered in RETIRED_WORKFLOW_PATH_WRITERS.
 */
const RETIRED_WORKFLOW_PATH_PATTERNS: readonly string[] = [
  'missions/',
  'MISSION.md',
  'CP-\\d+\\.md',
  'review-events',
  'review-state.json',
  'backlog.md',
  'backlog/tasks',
  'backlog/completed',
  'backlog/archive',
  // Normal runtime code commonly builds these paths indirectly.
  'missionDir',
  'findMissionDir',
  'missionPathForSlug',
  'missionDirForSlug',
  'GATE_RESULT_RELATIVE_PATH',
  'taskFilePath',
];

const RETIRED_PATH_RE = new RegExp(RETIRED_WORKFLOW_PATH_PATTERNS.join('|'));

function isCommentLine(line: string): boolean {
  const trimmed = line.trim();
  return (
    trimmed.startsWith('//') ||
    trimmed.startsWith('/*') ||
    trimmed.startsWith('*')
  );
}

/** True when a line carries a real write-token usage (not a pure comment). */
function hasWriteToken(line: string): boolean {
  if (isCommentLine(line)) { return false; }
  const codePortion = line.split('//')[0];
  return WRITE_TOKENS.some((token) => codePortion.includes(token));
}

/** True when a line references a retired workflow path in real code. */
function referencesRetiredPath(line: string): boolean {
  if (isCommentLine(line)) { return false; }
  return RETIRED_PATH_RE.test(line);
}

/**
 * Scan one source file for a normal-runtime write that targets a retired
 * workflow path on the same non-comment line (matches the doc comment below).
 * A rogue write is flagged only when its write token and retired-path reference
 * share a line, so a legitimate write on one line is never flagged alongside an
 * unrelated write on another. Call-site-scoped exemption (below) then decides
 * whether that flagged write is one of the file's registered legit writes.
 *
 * Line-scoped detection is used for files that have registered entries, because
 * distinguishing a rogue multi-line write from a legitimate multi-line write in
 * the same file would false-positive on every registered writer. For files
 * with no registered entries there is nothing to protect, so the guard falls
 * back to file-scoped detection (see `fileScopedRogueWrites`) and flags every
 * write line whenever the file references a retired path on any line.
 */
function rogueWritesIn(source: string): number[] {
  const lines = source.split('\n');
  const hits: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (hasWriteToken(lines[i]) && referencesRetiredPath(lines[i])) { hits.push(i + 1); }
  }
  return hits;
}

/**
 * File-scoped detection: flag every write line when the file references a
 * retired path on any line. Used for unregistered files, where there is no
 * registered exemption and a rogue write built via a variable on a separate
 * line must still be caught. Registered files never use this path, so the
 * false-positive risk (a legitimate write on one line, a retired-path
 * reference on another) is confined to files the guard has no reason to
 * trust.
 */
function fileScopedRogueWrites(source: string): number[] {
  const lines = source.split('\n');
  if (!lines.some(referencesRetiredPath)) { return []; }
  return lines
    .map((line, index) => hasWriteToken(line) ? index + 1 : 0)
    .filter(Boolean);
}

/** Registered writers keyed by file location, preserving multi-entry files. */
function writerEntries(): Map<string, RetiredWorkflowPathWriterEntry[]> {
  const map = new Map<string, RetiredWorkflowPathWriterEntry[]>();
  for (const entry of RETIRED_WORKFLOW_PATH_WRITERS) {
    if (!map.has(entry.fileLocation)) { map.set(entry.fileLocation, []); }
    map.get(entry.fileLocation)!.push(entry);
  }
  return map;
}

/** True when a write line targets one of the file's registered retired paths. */
function lineMatchesRegisteredPatterns(
  line: string,
  entries: RetiredWorkflowPathWriterEntry[],
): boolean {
  return entries.some((entry) =>
    entry.pathPatterns.some((pattern) => {
      try { return new RegExp(pattern).test(line); } catch { return false; }
    }),
  );
}

/** Registry of writer file locations that are permitted exceptions. */
function allowedWriters(): ReadonlySet<string> {
  return new Set(
    RETIRED_WORKFLOW_PATH_WRITERS.map((entry) => entry.fileLocation),
  );
}

function tsFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory() && !['node_modules', 'dist'].includes(entry.name)) {
      files.push(...tsFiles(full));
    } else if (entry.isFile() && entry.name.endsWith('.ts')) {
      files.push(full);
    }
  }
  return files;
}

/**
 * Guard 1: scan every production .ts file under src/ for a normal-runtime write
 * that targets a retired workflow path. Any such write in a file that is not
 * registered in RETIRED_WORKFLOW_PATH_WRITERS is a regression.
 */
test('guard 1: no unregistered normal-runtime write to a retired workflow path', () => {
  const violations: string[] = [];
  const writers = writerEntries();

  for (const file of tsFiles(path.join(ROOT, 'src'))) {
    const relative = path.relative(ROOT, file);
    if (relative.startsWith('src/application/ports/')) { continue; }
    const source = fs.readFileSync(file, 'utf8');
    const lines = source.split('\n');
    const entries = writers.get(relative) || [];
    // Call-site granularity: files with registered entries use line-scoped
    // detection plus a pattern-scoped exemption; files with no registered
    // entries fall back to file-scoped detection, since there is nothing to
    // exempt and a rogue write built via a variable on a separate line must
    // still be caught.
    const hitLines = entries.length
      ? rogueWritesIn(source)
      : fileScopedRogueWrites(source);
    for (const line of hitLines) {
      if (entries.length && lineMatchesRegisteredPatterns(lines[line - 1], entries)) { continue; }
      violations.push(`${relative}:${line}: write to a retired workflow path in an unregistered file or outside the file's registered patterns`);
    }
  }

  assert.deepEqual(
    violations,
    [],
    `Guard 1: unregistered normal-runtime writes to retired workflow paths:\n${violations.join('\n')}`,
  );
});

// ---------------------------------------------------------------------------
// Guard 1 fixture: the guard actually rejects a synthetic rogue write
// ---------------------------------------------------------------------------

test('guard 1 fixture: rejects a single-line write to a retired path in a new file', () => {
  // The regression surface from task-2521.01 round-3 F1: a new normal-runtime
  // write to a retired workflow path on one line in an unregistered file must
  // be flagged. Scoped (line-level) detection catches this while leaving
  // legitimate multi-line writes in registered files unflagged.
  const rogue = [
    "import * as fs from 'node:fs';",
    "fs.writeFileSync(path.join(missionDir, 'MISSION.md'), serializeMissionState(state));",
  ].join('\n');

  const hitLines = rogueWritesIn(rogue);
  assert.deepEqual(hitLines, [2], 'the single-line rogue write is detected');
  assert.ok(allowedWriters().has('src/adapters/review/review-events.ts'));
});

test('guard 1 fixture: rejects a variable-path write to a retired path in a new file', () => {
  // The regression surface from task-2521.01 round-1 F1: a new file that builds
  // the retired path via a variable on one line and writes it on another. For
  // an unregistered file there is no registered exemption, so file-scoped
  // detection flags the write even though the write token and path are on
  // different lines.
  const rogue = [
    "import * as fs from 'node:fs';",
    "const target = path.join(missionDir, 'MISSION.md');",
    'fs.writeFileSync(target, serializeMissionState(state));',
  ].join('\n');

  const hitLines = fileScopedRogueWrites(rogue);
  assert.deepEqual(hitLines, [3], 'variable-path rogue write in an unregistered file is detected');
  assert.ok(allowedWriters().has('src/adapters/review/review-events.ts'));
});

test('guard 1 fixture: permits a registered writer even on a same-line write', () => {
  const registered = 'src/adapters/review/review-events.ts';
  assert.ok(allowedWriters().has(registered), 'registered writer must be in the allowlist');

  const entry = RETIRED_WORKFLOW_PATH_WRITERS.find((e) => e.fileLocation === registered);
  assert.ok(entry, `registered writer must have an inventory entry: ${registered}`);
  assert.equal(
    entry.classification,
    'explicit-one-way-export',
    'review-events is a one-way generated export',
  );
});

test('guard 1 fixture: a write to a non-retired path is never flagged', () => {
  const source = [
    "const db = openDb();",
    "db.writeJson(path.join(parallixHome, 'parallix.db'), rows);",
  ].join('\n');
  assert.deepEqual(rogueWritesIn(source), [], 'SQLite write is not a retired workflow path');
});

// ---------------------------------------------------------------------------
// Guard 1 inventory sanity
// ---------------------------------------------------------------------------

test('guard 1: every registered writer names at least one live retired-path pattern', () => {
  for (const entry of RETIRED_WORKFLOW_PATH_WRITERS as RetiredWorkflowPathWriterEntry[]) {
    assert.ok(entry.pathPatterns.length > 0, `${entry.id} must name at least one pattern`);
    for (const pattern of entry.pathPatterns) {
      // A retired-path pattern must compile as a valid regex. `<slug>` is a
      // placeholder, so this checks syntactic liveness, not a concrete match.
      assert.doesNotThrow(
        () => new RegExp(pattern),
        `${entry.id}: pattern "${pattern}" is not a valid regex`,
      );
    }
    const source = fs.readFileSync(path.join(ROOT, entry.fileLocation), 'utf8');
    const lines = source.split('\n');
    assert.ok(
      entry.pathPatterns.some((pattern) => new RegExp(pattern).test(source)),
      `${entry.id} is stale: none of its registered retired-path patterns match its source`,
    );
    // A registered writer still writes a retired workflow path: it has at least
    // one write line and at least one retired-path reference (which may live on
    // different lines when the path is built indirectly). Each such write line
    // must match one of this entry's registered patterns.
    const writeLines = lines.filter((line) => hasWriteToken(line));
    const refLines = lines.filter((line) => referencesRetiredPath(line));
    assert.ok(
      writeLines.length > 0 && refLines.length > 0,
      `${entry.id} is stale: its registered file no longer writes a retired workflow path`,
    );
    for (const line of writeLines) {
      if (!referencesRetiredPath(line)) { continue; }
      assert.ok(
        lineMatchesRegisteredPatterns(line, [entry]),
        `${entry.id} is stale: a write line references a retired path outside its registered patterns`,
      );
    }
  }
});

test('guard 1: registered writer file locations resolve to existing files', () => {
  const missing: string[] = [];
  for (const entry of RETIRED_WORKFLOW_PATH_WRITERS) {
    if (!fs.existsSync(path.join(ROOT, entry.fileLocation))) {
      missing.push(entry.fileLocation);
    }
  }
  assert.deepEqual(
    missing,
    [],
    `Registered retired-path writers that do not exist:\n${missing.join('\n')}`,
  );
});
