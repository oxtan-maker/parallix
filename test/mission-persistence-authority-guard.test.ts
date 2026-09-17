// @ts-nocheck -- TASK-2521.01: guard-2 boundary test scans the source tree with
// node:fs, exactly like test/persistence-inventory-guardrail.test.ts.

import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';

import {
  MISSION_DOCUMENT_CALL_SITES,
  type MissionDocumentCallSiteEntry,
} from './fixtures/durable-state-inventory.js';

const ROOT = process.cwd();

/**
 * Path patterns that mean "this code resolves or persists through the retired
 * Mission-document / Backlog-task locations as Mission authority". missions/**
 * and MISSION.md are Mission contract/state; backlog/{tasks,completed,archive}
 * are the external task catalog. ADR 0053 makes the operator database the sole
 * Mission persistence authority, so application/interface code must not treat
 * these files as Mission persistence.
 */
const MISSION_PERSISTENCE_PATTERNS: readonly string[] = [
  'missions/',
  'MISSION.md',
  'backlog/tasks',
  'backlog/completed',
  'backlog/archive',
  'findMissionDir',
  'missionPathForSlug',
  'missionDirForSlug',
];

const MISSION_PERSISTENCE_RE = new RegExp(MISSION_PERSISTENCE_PATTERNS.join('|'));

function isCommentLine(line: string): boolean {
  const trimmed = line.trim();
  return (
    trimmed.startsWith('//') ||
    trimmed.startsWith('/*') ||
    trimmed.startsWith('*')
  );
}

/**
 * Real-code references (not comments/JSDoc) to the retired Mission-document /
 * Backlog-task paths on a single source line.
 */
function persistenceReferencesInLine(line: string): boolean {
  if (isCommentLine(line)) { return false; }
  return MISSION_PERSISTENCE_RE.test(line);
}

/**
 * Scan one application/interface source file for real-code references to the
 * retired Mission-document / Backlog-task paths. Returns the offending line
 * numbers (1-based).
 */
function persistenceReferencesIn(source: string): number[] {
  const lines = source.split('\n');
  const hits: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (persistenceReferencesInLine(lines[i])) { hits.push(i + 1); }
  }
  return hits;
}

function allowedCallSites(): ReadonlySet<string> {
  return new Set(
    MISSION_DOCUMENT_CALL_SITES.map((entry) => entry.fileLocation),
  );
}

/** Registered call sites keyed by file location, preserving multi-entry files. */
function callSiteEntries(): Map<string, MissionDocumentCallSiteEntry[]> {
  const map = new Map<string, MissionDocumentCallSiteEntry[]>();
  for (const entry of MISSION_DOCUMENT_CALL_SITES) {
    if (!map.has(entry.fileLocation)) { map.set(entry.fileLocation, []); }
    map.get(entry.fileLocation)!.push(entry);
  }
  return map;
}

/** True when a line matches one of the call site's registered path patterns. */
function lineMatchesRegisteredPatterns(
  line: string,
  entries: MissionDocumentCallSiteEntry[],
): boolean {
  return entries.some((entry) =>
    entry.pathPatterns.some((pattern) => {
      try { return new RegExp(pattern).test(line); } catch { return false; }
    }),
  );
}

function tsLikeFiles(dir: string): string[] {
  const files: string[] = [];
  if (!fs.existsSync(dir)) { return files; }
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory() && !['node_modules', 'dist'].includes(entry.name)) {
      files.push(...tsLikeFiles(full));
    } else if (entry.isFile() && /\.(ts|tsx)$/.test(entry.name)) {
      files.push(full);
    }
  }
  return files;
}

/**
 * Guard 2: every application/interface file that resolves or persists through
 * missions/** or repo Backlog task files in real code must be registered in
 * MISSION_DOCUMENT_CALL_SITES as a non-persistence call site. A new file that
 * treats these paths as Mission persistence is unregistered and fails.
 */
test('guard 2: every application/interface mission-document call site is registered', () => {
  const violations: string[] = [];
  const callSites = callSiteEntries();

  for (const dir of [path.join(ROOT, 'src', 'application'), path.join(ROOT, 'src', 'interfaces')]) {
    for (const file of tsLikeFiles(dir)) {
      const relative = path.relative(ROOT, file);
      const source = fs.readFileSync(file, 'utf8');
      const lines = source.split('\n');
      // Call-site granularity: exempt a flagged line only when it matches one of
      // this file's own registered path patterns. A new reference outside them is
      // a regression. Guard 1 owns the write-to-retired-path half of the
      // failure scenario; guard 2 here owns the per-call-site resolution boundary.
      const entries = callSites.get(relative) || [];
      const hitLines = persistenceReferencesIn(source);
      for (const line of hitLines) {
        if (entries.length && lineMatchesRegisteredPatterns(lines[line - 1], entries)) { continue; }
        violations.push(`${relative}:${line}: resolves/persists through a retired Mission-document path`);
      }
    }
  }

  assert.deepEqual(
    violations,
    [],
    `Guard 2: application/interface code resolves a retired Mission-document path without registration:\n${violations.join('\n')}`,
  );
});

// ---------------------------------------------------------------------------
// Guard 2 fixture: the guard actually rejects a synthetic rogue resolution
// ---------------------------------------------------------------------------

test('guard 2 fixture: rejects a new application file that resolves mission state through a helper', () => {
  const rogue = [
    'const missionDir = missionPaths.findMissionDir(slug);',
    "const raw = fs.readFileSync(path.join(missionDir, 'state.json'), 'utf8');",
    "return parseMissionState(raw);",
  ].join('\n');

  const hits = persistenceReferencesIn(rogue);
  assert.deepEqual(hits, [1], 'helper-based Mission resolution detected');
});

test('guard 2 fixture: a registered call site is exempt from the guard', () => {
  const registered = 'src/application/integrate/preflight-checkout.ts';
  assert.ok(
    allowedCallSites().has(registered),
    'preflight-checkout git-topology resolution must be registered',
  );
  const entry = MISSION_DOCUMENT_CALL_SITES.find((e) => e.fileLocation === registered);
  assert.ok(entry, `registered call site must have an inventory entry: ${registered}`);
  assert.equal(
    entry.classification,
    'git-topology-observation',
    'overlap-path resolution is Git topology, not Mission persistence',
  );
});

test('guard 2 fixture: a new reference outside a registered pattern is flagged', () => {
  // Per-call-site granularity: a registered file that adds a mission-document
  // reference outside its own registered patterns is a regression. The line
  // matches a guarded pattern but not the entry's registered patterns.
  const rogue = [
    "const raw = fs.readFileSync('missions/state.json', 'utf8');",
  ].join('\n');
  const entries = callSiteEntries().get('src/application/integrate/context.ts') || [];
  // context.ts only legitimately references findMissionDir; this line references
  // missions/ (a guarded pattern) but no registered pattern, so it is flagged.
  const hitLines = persistenceReferencesIn(rogue);
  assert.equal(hitLines.length, 1, 'the rogue resolution is detected');
  assert.ok(
    entries.length > 0 && !lineMatchesRegisteredPatterns(rogue, entries),
    'the rogue line does not match context.ts registered patterns',
  );
});

test('guard 2 fixture: a DB-native read is never flagged', () => {
  const source = [
    'const mission = await store.load(slug);',
    'return mission.status;',
  ].join('\n');
  assert.deepEqual(persistenceReferencesIn(source), [], 'SQLite read is not a retired path');
});

// ---------------------------------------------------------------------------
// Guard 2 F1 (task-2521.01 round-3): call-site-level registration
// ---------------------------------------------------------------------------
// Guard 2 enforces at the call-site boundary: each registered entry names one
// distinct application/interface file with its own purpose and ADR 0053
// classification, so the allowlist exemption is per call site, not a blanket
// file carve-out. A new application/interface file that resolves missions/** as
// Mission persistence without its own entry fails.
test('guard 2: every application/interface file that resolves a Mission-document path is individually registered', () => {
  const registered = allowedCallSites();
  for (const dir of [path.join(ROOT, 'src', 'application'), path.join(ROOT, 'src', 'interfaces')]) {
    for (const file of tsLikeFiles(dir)) {
      const relative = path.relative(ROOT, file);
      const source = fs.readFileSync(file, 'utf8');
      if (persistenceReferencesIn(source).length === 0) { continue; }
      assert.ok(
        registered.has(relative),
        `${relative} resolves a retired Mission-document path but has no individual call-site entry`,
      );
    }
  }
  assert.ok(registered.size === MISSION_DOCUMENT_CALL_SITES.length, 'allowlist must register each call site individually');
});

// ---------------------------------------------------------------------------
// Guard 2 inventory sanity
// ---------------------------------------------------------------------------

test('guard 2: registered call sites resolve to existing files that still match', () => {
  const missing: string[] = [];
  for (const entry of MISSION_DOCUMENT_CALL_SITES as MissionDocumentCallSiteEntry[]) {
    const file = path.join(ROOT, entry.fileLocation);
    if (!fs.existsSync(file)) {
      missing.push(entry.fileLocation);
    } else if (persistenceReferencesIn(fs.readFileSync(file, 'utf8')).length === 0) {
      missing.push(`${entry.fileLocation} (stale: no longer matches a guarded pattern)`);
    }
  }
  assert.deepEqual(
    missing,
    [],
    `Registered mission-document call sites that are missing or stale:\n${missing.join('\n')}`,
  );
});

test('guard 2: every registered call site names at least one live path pattern', () => {
  for (const entry of MISSION_DOCUMENT_CALL_SITES as MissionDocumentCallSiteEntry[]) {
    assert.ok(
      entry.pathPatterns.length > 0,
      `${entry.id} must name at least one path pattern`,
    );
    for (const pattern of entry.pathPatterns) {
      // A pattern must compile as a valid regex; `<slug>` is a placeholder, so
      // this checks syntactic liveness, not a concrete match.
      assert.doesNotThrow(
        () => new RegExp(pattern),
        `${entry.id}: pattern "${pattern}" is not a valid regex`,
      );
    }
    const source = fs.readFileSync(path.join(ROOT, entry.fileLocation), 'utf8');
    const lines = source.split('\n');
    // Each registered pattern must match at least one real line in the file, so
    // the per-line exemption is grounded in the call site's actual source.
    assert.ok(
      entry.pathPatterns.some((pattern) => {
        try { return lines.some((l) => new RegExp(pattern).test(l)); } catch { return false; }
      }),
      `${entry.id} is stale: none of its registered patterns match its source`,
    );
  }
});

test('guard 2: registered call site classifications are recognized', () => {
  const valid = new Set([
    'port-declaration',
    'external-task-intake',
    'mission-document-evidence',
    'git-topology-observation',
  ]);
  for (const entry of MISSION_DOCUMENT_CALL_SITES) {
    assert.ok(
      valid.has(entry.classification),
      `${entry.id} has invalid classification "${entry.classification}"`,
    );
  }
});
