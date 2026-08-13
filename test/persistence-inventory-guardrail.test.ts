import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

import {
  ADR0053_PERSISTENCE_INVENTORY,
  type ADR0053BoundaryEntry,
  type ADR0053ConceptName,
} from './fixtures/durable-state-inventory.js';

const ROOT = process.cwd();
const APPLICATION_DIR = path.join(ROOT, 'src', 'application');
const INTERFACES_DIR = path.join(ROOT, 'src', 'interfaces');
const ADAPTERS_SQLITE_DIR = path.join(ROOT, 'src', 'adapters', 'sqlite');

// ---------------------------------------------------------------------------
// Helpers (reuses patterns from src/adapters/architecture/boundary-guards.ts)
// ---------------------------------------------------------------------------

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

function importSpecifiers(source: string): string[] {
  return [...source.matchAll(
    /(?:from\s+|import\s*(?:\(\s*)?|require\s*\(\s*)['"]([^'"]+)['"]/g,
  )].map((m) => m[1] as string);
}

/**
 * Check if a line contains a durable-file operation token as actual code usage.
 * Uses a more precise check than simple `includes('//')` to avoid false negatives
 * from trailing comments or URL literals.
 */
function hasDurableToken(line: string, token: string): boolean {
  // Trim the line and check for block comments
  const trimmed = line.trim();

  // Skip pure comment lines (leading whitespace + // or /*)
  if (trimmed.startsWith('//') || trimmed.startsWith('/*') || trimmed.startsWith('*')) {
    return false;
  }

  // Check if the token appears in the code portion (before any trailing //)
  const codePortion = trimmed.split('//')[0];
  return codePortion.includes(token);
}

/** Durable file operation tokens that indicate a file read or write. */
const DURABLE_FILE_TOKENS = [
  'readFileSync',
  'writeFileSync',
  'readFile(',
  'writeFile(',
  'writeJson',
  'readJson',
  'writeFileAtomic',
  'appendFileSync',
  'createWriteStream',
  'mkdirSync',
  'rmSync',
  'cpSync',
  'renameSync',
];

/** Maps a durable-file token to the operation type it represents. */
const TOKEN_TO_OPERATION: Record<string, 'read' | 'write'> = {
  'readFileSync': 'read',
  'readFile(': 'read',
  'readJson': 'read',
  'writeFileSync': 'write',
  'writeFile(': 'write',
  'writeJson': 'write',
  'writeFileAtomic': 'write',
  'appendFileSync': 'write',
  'createWriteStream': 'write',
  'mkdirSync': 'write',
  'rmSync': 'write',
  'cpSync': 'write',
  'renameSync': 'write',
};

/**
 * Build the allowed (fileLocation → Set<operation>) map from the ADR 0053 inventory.
 * This drives the guard from the inventory itself (F3 fix) and threads operation
 * through so an unregistered write in a registered read-only file is caught (R5).
 */
function inventoryAllowedOps(): Map<string, Set<'read' | 'write'>> {
  const allowed = new Map<string, Set<'read' | 'write'>>();
  for (const entry of ADR0053_PERSISTENCE_INVENTORY) {
    if (entry.fileLocation.startsWith('src/application/') ||
        entry.fileLocation.startsWith('src/interfaces/')) {
      const ops = allowed.get(entry.fileLocation);
      if (ops) {
        ops.add(entry.operation);
      } else {
        allowed.set(entry.fileLocation, new Set([entry.operation]));
      }
    }
  }
  return allowed;
}

// ---------------------------------------------------------------------------
// SC1: Inventory completeness — all 15 ADR 0053 concepts are covered
// ---------------------------------------------------------------------------

const ALL_CONCEPTS: readonly ADR0053ConceptName[] = [
  'Mission',
  'CheckpointData',
  'Review',
  'MissionOutcome',
  'AgentRunMeasurement',
  'KnownRepository',
  'SessionMarker',
  'LaneTransitionEvent',
  'AgentBlock',
  'UIPreferences',
  'TaskIntake',
  'GitObservations',
  'Configuration',
  'Secrets',
  'LargeArtifacts',
];

test('SC1: ADR 0053 inventory covers all 15 durable-state concepts', () => {
  const concepts = new Set(ADR0053_PERSISTENCE_INVENTORY.map((e) => e.concept));
  for (const concept of ALL_CONCEPTS) {
    assert.ok(
      concepts.has(concept),
      `ADR 0053 inventory must cover concept "${concept}"`,
    );
  }
});

test('SC1: every inventory entry has exactly one recognized classification', () => {
  const valid = new Set([
    'database-owned-domain-state',
    'explicit-one-way-legacy-input',
    'external-fact-or-intake',
    'configuration-or-secret',
    'generated-artifact',
    'forbidden-persistence',
  ]);
  for (const entry of ADR0053_PERSISTENCE_INVENTORY) {
    assert.ok(
      valid.has(entry.classification),
      `${entry.id} has invalid classification "${entry.classification}"`,
    );
  }
});

test('SC1: every inventory entry has a valid pathType', () => {
  for (const entry of ADR0053_PERSISTENCE_INVENTORY) {
    assert.ok(
      entry.pathType === 'default' || entry.pathType === 'compatibility',
      `${entry.id} has invalid pathType "${entry.pathType}"`,
    );
  }
});

test('SC1: every inventory entry has a valid operation', () => {
  for (const entry of ADR0053_PERSISTENCE_INVENTORY) {
    assert.ok(
      entry.operation === 'read' || entry.operation === 'write',
      `${entry.id} has invalid operation "${entry.operation}"`,
    );
  }
});

test('SC1: each concept has at least one read and one write in the inventory', () => {
  for (const concept of ALL_CONCEPTS) {
    const entries = ADR0053_PERSISTENCE_INVENTORY.filter((e) => e.concept === concept);
    const hasRead = entries.some((e) => e.operation === 'read');
    const hasWrite = entries.some((e) => e.operation === 'write');
    assert.ok(hasRead, `${concept} must have at least one read entry`);
    assert.ok(hasWrite, `${concept} must have at least one write entry`);
  }
});

// ---------------------------------------------------------------------------
// SC2: Direct SQL guard — application/UI code must not import node:sqlite
// ---------------------------------------------------------------------------

test('SC2: no src/application/ file imports node:sqlite directly', () => {
  const violations: string[] = [];
  for (const file of tsFiles(APPLICATION_DIR)) {
    const source = fs.readFileSync(file, 'utf8');
    for (const spec of importSpecifiers(source)) {
      if (spec === 'node:sqlite' || spec === 'sqlite3') {
        violations.push(`${path.relative(ROOT, file)}: ${spec}`);
      }
    }
  }
  assert.deepEqual(
    violations,
    [],
    `Application code must not import node:sqlite directly:\n${violations.join('\n')}`,
  );
});

test('SC2: no src/interfaces/ file imports node:sqlite directly', () => {
  const violations: string[] = [];
  for (const file of tsFiles(INTERFACES_DIR)) {
    const source = fs.readFileSync(file, 'utf8');
    for (const spec of importSpecifiers(source)) {
      if (spec === 'node:sqlite' || spec === 'sqlite3') {
        violations.push(`${path.relative(ROOT, file)}: ${spec}`);
      }
    }
  }
  assert.deepEqual(
    violations,
    [],
    `Interface (UI) code must not import node:sqlite directly:\n${violations.join('\n')}`,
  );
});

test('SC2: src/adapters/sqlite/ is the sole allowed location for node:sqlite imports', () => {
  // Verify at least one file in adapters/sqlite imports node:sqlite
  const sqliteFiles = tsFiles(ADAPTERS_SQLITE_DIR);
  let found = false;
  for (const file of sqliteFiles) {
    const source = fs.readFileSync(file, 'utf8');
    if (importSpecifiers(source).some((s) => s === 'node:sqlite')) {
      found = true;
      break;
    }
  }
  assert.ok(found, 'src/adapters/sqlite/ must contain at least one node:sqlite import');
});

// ---------------------------------------------------------------------------
// SC2 fixture: guard actually rejects a violating import
// ---------------------------------------------------------------------------

test('SC2 fixture: SQL guard rejects node:sqlite import in application code', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sql-guard-fixture-'));
  try {
    // Write a test file that imports node:sqlite
    const testFile = path.join(tmpDir, 'test-import.ts');
    fs.writeFileSync(testFile, "import { DatabaseSync } from 'node:sqlite';\nconst db = new DatabaseSync();\n");

    const source = fs.readFileSync(testFile, 'utf8');
    const specs = importSpecifiers(source);
    const hasSqlite = specs.some((s) => s === 'node:sqlite' || s === 'sqlite3');
    assert.ok(hasSqlite, 'Fixture file must contain node:sqlite import');

    // Verify the guard logic would detect it
    const violations = specs.filter((s) => s === 'node:sqlite' || s === 'sqlite3');
    assert.ok(violations.length > 0, 'Guard must detect node:sqlite import');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// SC3: Task intake and Git observations are external facts
// ---------------------------------------------------------------------------

test('SC3: TaskIntake entries are classified as external-fact-or-intake', () => {
  const taskEntries = ADR0053_PERSISTENCE_INVENTORY.filter(
    (e) => e.concept === 'TaskIntake',
  );
  for (const entry of taskEntries) {
    assert.equal(
      entry.classification,
      'external-fact-or-intake',
      `${entry.id} (TaskIntake) must be classified as external-fact-or-intake`,
    );
  }
});

test('SC3: GitObservations entries are classified as external-fact-or-intake', () => {
  const gitEntries = ADR0053_PERSISTENCE_INVENTORY.filter(
    (e) => e.concept === 'GitObservations',
  );
  for (const entry of gitEntries) {
    assert.equal(
      entry.classification,
      'external-fact-or-intake',
      `${entry.id} (GitObservations) must be classified as external-fact-or-intake`,
    );
  }
});

test('SC3: TaskIntake is distinct from Mission lifecycle authority', () => {
  const missionEntries = ADR0053_PERSISTENCE_INVENTORY.filter(
    (e) => e.concept === 'Mission',
  );
  const taskEntries = ADR0053_PERSISTENCE_INVENTORY.filter(
    (e) => e.concept === 'TaskIntake',
  );
  // Mission entries should be database-owned-domain-state (cutover target)
  // TaskIntake entries should be external-fact-or-intake (permanent)
  for (const entry of missionEntries) {
    assert.equal(
      entry.classification,
      'database-owned-domain-state',
      `${entry.id} (Mission) must be database-owned-domain-state`,
    );
  }
  for (const entry of taskEntries) {
    assert.equal(
      entry.classification,
      'external-fact-or-intake',
      `${entry.id} (TaskIntake) must be external-fact-or-intake`,
    );
  }
});

// ---------------------------------------------------------------------------
// SC4: No authority switch, source-format repair, dual-write in this mission
// ---------------------------------------------------------------------------

test('SC4: no inventory entry uses forbidden-persistence classification', () => {
  const forbidden = ADR0053_PERSISTENCE_INVENTORY.filter(
    (e) => e.classification === 'forbidden-persistence',
  );
  assert.deepEqual(
    forbidden.map((e) => e.id),
    [],
    'No entry should be classified as forbidden-persistence in TASK-2322.01 (no authority switch)',
  );
});

test('SC4: compatibility pathType entries are exceptions with cutover tasks or permanent SQLite paths', () => {
  for (const entry of ADR0053_PERSISTENCE_INVENTORY) {
    if (entry.pathType === 'compatibility') {
      // SQLite adapter paths are permanent (no cutover needed)
      const isSqliteAdapter = entry.fileLocation.startsWith('src/adapters/sqlite/');
      // An `explicit-one-way-legacy-input` boundary is also permanent by
      // design: ADR 0053 keeps operator-invoked, read-only legacy import as a
      // standing capability, so it has no cutover task to name (TASK-2322.08).
      const isExplicitLegacyInput = entry.classification === 'explicit-one-way-legacy-input';
      if (!isSqliteAdapter && !isExplicitLegacyInput) {
        assert.ok(
          entry.cutoverTask !== null,
          `${entry.id} is a compatibility path in application/UI code and must name a cutover task`,
        );
      }
    }
  }
});

// ---------------------------------------------------------------------------
// SC5: Inventory IDs are unique
// ---------------------------------------------------------------------------

test('SC5: inventory entry IDs are unique', () => {
  const ids = ADR0053_PERSISTENCE_INVENTORY.map((e) => e.id);
  const seen = new Set(ids);
  assert.equal(seen.size, ids.length, 'Inventory must have unique entry IDs');
});

// ---------------------------------------------------------------------------
// SC6: Inventory file locations reference existing files
// ---------------------------------------------------------------------------

test('SC6: inventory fileLocation references resolve to existing files', () => {
  const missing: string[] = [];
  for (const entry of ADR0053_PERSISTENCE_INVENTORY) {
    const fullPath = path.join(ROOT, entry.fileLocation);
    if (!fs.existsSync(fullPath)) {
      missing.push(`${entry.id}: ${entry.fileLocation}`);
    }
  }
  assert.deepEqual(
    missing,
    [],
    `These inventory fileLocations do not exist:\n${missing.join('\n')}`,
  );
});

// ---------------------------------------------------------------------------
// SC7: Unclassified durable file guard — no fs read/write in app/UI outside inventory
// ---------------------------------------------------------------------------

test('SC7: no unclassified durable file read/write in src/application/ or src/interfaces/', () => {
  const violations: string[] = [];
  const dirs = [APPLICATION_DIR, INTERFACES_DIR];
  const allowedOps = inventoryAllowedOps();

  for (const dir of dirs) {
    for (const file of tsFiles(dir)) {
      const relative = path.relative(ROOT, file);
      const source = fs.readFileSync(file, 'utf8');

      // Skip import lines — we only check actual usage
      const lines = source.split('\n');
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        // Skip import lines
        if (line.trim().startsWith('import ') || line.trim().startsWith('from ')) {
          continue;
        }
        for (const token of DURABLE_FILE_TOKENS) {
          if (hasDurableToken(line, token)) {
            const op = TOKEN_TO_OPERATION[token];
            const allowedForFile = allowedOps.get(relative);
            if (!allowedForFile || !allowedForFile.has(op)) {
              violations.push(`${relative}:${i + 1}: ${token} (operation: ${op})`);
            }
          }
        }
      }
    }
  }

  assert.deepEqual(
    violations,
    [],
    `Unclassified durable file operations in application/UI code:\n${violations.join('\n')}`,
  );
});

// ---------------------------------------------------------------------------
// SC7 fixture: durable-file guard actually rejects a violating write
// ---------------------------------------------------------------------------

test('SC7 fixture: durable-file guard rejects writeFileSync in a new application file', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'durable-guard-fixture-'));
  try {
    // Create a temporary application file with a durable write
    const appDir = path.join(tmpDir, 'src', 'application', 'test');
    fs.mkdirSync(appDir, { recursive: true });
    const testFile = path.join(appDir, 'new-handler.ts');
    fs.writeFileSync(
      testFile,
      "import * as fs from 'node:fs';\nconst data = fs.readFileSync(path, 'utf8');\nfs.writeFileSync(outputPath, data);\n",
    );

    const source = fs.readFileSync(testFile, 'utf8');
    const lines = source.split('\n');
    const allowedOps = inventoryAllowedOps();
    const violations: string[] = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line.trim().startsWith('import ') || line.trim().startsWith('from ')) {
        continue;
      }
      for (const token of DURABLE_FILE_TOKENS) {
        if (hasDurableToken(line, token)) {
          const op = TOKEN_TO_OPERATION[token];
          const allowedForFile = allowedOps.get(testFile);
          if (!allowedForFile || !allowedForFile.has(op)) {
            violations.push(`${testFile}:${i + 1}: ${token} (operation: ${op})`);
          }
        }
      }
    }

    assert.ok(
      violations.length > 0,
      'Guard must detect durable file operations in unregistered application files',
    );
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// SC7 fixture: guard permits lines with trailing comments (bypass fix verification)
// ---------------------------------------------------------------------------

test('SC7 fixture: hasDurableToken correctly handles trailing comments', () => {
  // A line with a trailing comment should still detect the token
  assert.ok(
    hasDurableToken("const raw = readFileSync(p, 'utf8'); // load config", 'readFileSync'),
    'Should detect readFileSync before trailing // comment',
  );

  // A pure comment line should not trigger
  assert.ok(
    !hasDurableToken('// readFileSync is used above', 'readFileSync'),
    'Should skip pure // comment lines',
  );

  // A block comment line should not trigger
  assert.ok(
    !hasDurableToken('/* readFileSync is used above */', 'readFileSync'),
    'Should skip /* block comment lines',
  );

  // A line with 'type ' substring but also a durable token should trigger
  assert.ok(
    hasDurableToken("const contentType = readFileSync(path, 'utf8')", 'readFileSync'),
    'Should detect readFileSync even when line contains "type " substring',
  );
});

// ---------------------------------------------------------------------------
// Reverse completeness: every durable-IO site in production is inventoried
// ---------------------------------------------------------------------------

test('SC1 reverse: all durable-IO files under src/ are present in the inventory', () => {
  // Scan all .ts files under src/ for durable-IO tokens
  const srcDir = path.join(ROOT, 'src');
  const inventoryLocations = new Set(
    ADR0053_PERSISTENCE_INVENTORY.map((e) => e.fileLocation),
  );

  // Files that do durable IO but are infrastructure (not concept entries)
  const infrastructureExclusions = new Set([
    // Adapter-layer boundary guard scans source files to enforce dependency rules,
    // rather than reading or writing an ADR 0053 durable-state concept.
    'src/adapters/architecture/boundary-guards.ts',
    // The inventory file itself
    'test/fixtures/durable-state-inventory.ts',
    // Core storage abstraction (defines the API, not a concept reader/writer)
    'src/adapters/storage/storage.ts',
    // Package root detection (reads package.json for name, not a durable-state concept)
    'src/adapters/filesystem/package-root.ts',
    // Mutation scoper (reads files to detect mutations, not a concept)
    'src/adapters/git/mutation-scoper.ts',
    // Database adapter (SQLite infrastructure)
    'src/adapters/sqlite/database-adapter.ts',
    // Mission import parsing — reads task files for SQLite import, not a concept
    'src/adapters/sqlite/mission-import-parsing.ts',
    // Agent launchers — write config files for the agent runtime, not domain state
    'src/adapters/agents/codex.ts',
    'src/adapters/agents/vibe.ts',
    'src/adapters/agents/qwen.ts',
    'src/adapters/agents/qwen-telemetry.ts',
    // Opencode export — writes temporary scratch files
    'src/adapters/agents/opencode-export.ts',
    // Mission utility helpers — read mission files for path resolution
    'src/adapters/filesystem/mission-paths.ts',
    'src/adapters/git/worktree.ts',
    // Verification proofs — infrastructure metadata, not a domain concept
    'src/adapters/verification/verification.ts',
    // Temporary-root cleanup manifests are verification infrastructure, not domain state.
    'src/adapters/verification/temp-root-registry.ts',
    // Red-green reproduction test tracking — reads mission docs for test markers
    'src/adapters/verification/redgreen.ts',
    // Review command surface — reads mission documents, checkpoints, ADRs and
    // operator-named input files. Its Review state is the SQLite aggregate;
    // none of these reads are of a database-owned concept (TASK-2322.12).
    'src/adapters/review/review-commands.ts',
  ]);

  const durableIoFiles = new Set<string>();

  function scanDir(dir: string): void {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory() && !['node_modules', 'dist', 'test'].includes(entry.name)) {
        scanDir(full);
      } else if (entry.isFile() && entry.name.endsWith('.ts')) {
        const relative = path.relative(ROOT, full);
        const source = fs.readFileSync(full, 'utf8');
        for (const token of DURABLE_FILE_TOKENS) {
          if (source.includes(token)) {
            durableIoFiles.add(relative);
            break;
          }
        }
      }
    }
  }

  scanDir(srcDir);

  const unlisted: string[] = [];
  for (const file of durableIoFiles) {
    if (!inventoryLocations.has(file) && !infrastructureExclusions.has(file)) {
      unlisted.push(file);
    }
  }

  assert.deepEqual(
    unlisted,
    [],
    `These durable-IO files are not in the inventory (and not excluded as infrastructure):\n${unlisted.join('\n')}`,
  );
});
