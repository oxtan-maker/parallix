// TASK-2322.02 CP 3 — lock the "Attempt is not required" branch.
//
// CP 1 traced every launch, retry, failover, usage/statistics, review, and
// UI/board consumer and found none that needs durable per-launch identity or
// lifecycle (`src/application/consumer-domain-requirements.ts`,
// `PER_LAUNCH_IDENTITY_DECISION`). ADR 0053 therefore keeps `Attempt` excluded.
//
// This guard makes that decision executable: persistence or adapter work cannot
// reintroduce an Attempt entity by declaring an Attempt-shaped type, table, or
// record under `src/domain`, `src/application`, or `src/adapters`.
//
// Deliberately narrow, per the mission's noise risk: it inspects *declarations*
// — declared type/interface/class/enum names, exported value names, `attemptId`
// /`attempt_id` fields, and SQL table references — after comments are stripped.
// A local `attempts` counter in a retry loop is not a declaration and is
// accepted; the fixtures below prove both directions.
//
// Reads source from disk only. No Forgejo call, no agent launch, no CLI
// subprocess.

import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';

import { PER_LAUNCH_IDENTITY_DECISION } from '../src/application/consumer-domain-requirements.js';

const ROOT = process.cwd();
const GUARDED_DIRS = ['src/domain', 'src/application', 'src/adapters'] as const;
const ADR_0053 = 'docs/adr/0053-operational-persistence-and-authority-boundaries.md';
const DOMAIN_README = 'src/domain/README.md';

// Plural retry counters (for example DEFAULT_MAX_ATTEMPTS) are not an Attempt
// entity. Identity fields and SQL tables are checked separately below.
const ATTEMPT = /attempt(?!s(?:\b|_))/i;

/** Strip line, block, and SQL comments so prose cannot trip the guard. */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/^\s*\/\/.*$/gm, ' ')
    .replace(/^\s*--.*$/gm, ' ')
    .replace(/\s--\s.*$/gm, ' ');
}

/**
 * Attempt-shaped declarations in one source text.
 *
 * Returns human-readable findings; an empty array means the source declares no
 * Attempt type, exported Attempt identifier, Attempt id field, or Attempt table.
 */
export function attemptShapedDeclarations(rawSource: string): string[] {
  const source = stripComments(rawSource);
  const findings: string[] = [];

  // 1. Declared types: interface / class / enum / type alias.
  for (const match of source.matchAll(/\b(?:interface|class|enum)\s+([A-Za-z_$][\w$]*)/g)) {
    if (ATTEMPT.test(match[1] as string)) {
      findings.push(`declared type ${match[1]}`);
    }
  }
  for (const match of source.matchAll(/\btype\s+([A-Za-z_$][\w$]*)\s*=/g)) {
    if (ATTEMPT.test(match[1] as string)) {
      findings.push(`declared type ${match[1]}`);
    }
  }

  // 2. Exported value declarations.
  for (const match of source.matchAll(
    /\bexport\s+(?:default\s+)?(?:const|let|var|(?:async\s+)?function)\s+([A-Za-z_$][\w$]*)/g,
  )) {
    if (ATTEMPT.test(match[1] as string)) {
      findings.push(`exported identifier ${match[1]}`);
    }
  }

  // 3. Attempt identity fields / columns.
  for (const match of source.matchAll(/\battempt_?(?:id|uuid|number|no)\b/gi)) {
    findings.push(`attempt identity field ${match[0]}`);
  }

  // 4. SQL table references.
  for (const match of source.matchAll(
    /\b(?:CREATE\s+TABLE(?:\s+IF\s+NOT\s+EXISTS)?|ALTER\s+TABLE|DROP\s+TABLE(?:\s+IF\s+EXISTS)?|INSERT\s+INTO|DELETE\s+FROM|UPDATE|FROM|JOIN)\s+[`"'[]?([A-Za-z_][\w$]*)/gi,
  )) {
    if (/attempts?/i.test(match[1] as string)) {
      findings.push(`SQL table ${match[1]}`);
    }
  }

  return findings;
}

function guardedFiles(): string[] {
  const files: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory() && !['node_modules', 'dist'].includes(entry.name)) {
        walk(full);
      } else if (entry.isFile() && /\.(?:ts|sql)$/.test(entry.name)) {
        files.push(full);
      }
    }
  };
  for (const dir of GUARDED_DIRS) {
    const full = path.join(ROOT, dir);
    if (fs.existsSync(full)) { walk(full); }
  }
  return files;
}

// ---------------------------------------------------------------------------
// SC4: no Attempt-shaped type, table, or record exists in the guarded tree
// ---------------------------------------------------------------------------

test('SC4: no Attempt-shaped type, table, or record under src/domain, src/application, or src/adapters', () => {
  const violations: string[] = [];
  for (const file of guardedFiles()) {
    const relative = path.relative(ROOT, file);
    for (const finding of attemptShapedDeclarations(fs.readFileSync(file, 'utf8'))) {
      violations.push(`${relative}: ${finding}`);
    }
  }
  assert.deepEqual(
    violations,
    [],
    `ADR 0053 excludes Attempt, and no consumer requires it (PER_LAUNCH_IDENTITY_DECISION). `
      + `Introducing one requires a domain model with identity and invariants first:\n${violations.join('\n')}`,
  );
});

test('SC4: src/domain exports no Attempt type', () => {
  const domainDir = path.join(ROOT, 'src', 'domain');
  const exported: string[] = [];
  for (const entry of fs.readdirSync(domainDir)) {
    if (!entry.endsWith('.ts')) { continue; }
    const source = fs.readFileSync(path.join(domainDir, entry), 'utf8');
    for (const match of source.matchAll(/^export\s+(?:interface|type|class|enum)\s+(\w+)/gm)) {
      if (ATTEMPT.test(match[1] as string)) {
        exported.push(`${entry}: ${match[1]}`);
      }
    }
  }
  assert.deepEqual(exported, [], `src/domain must export no Attempt type:\n${exported.join('\n')}`);
});

test('SC4: the guard scans a non-trivial number of files', () => {
  assert.ok(
    guardedFiles().length > 20,
    'The guard must actually walk the three directories; a near-empty scan proves nothing',
  );
});

// ---------------------------------------------------------------------------
// SC4 fixtures: the guard rejects real Attempt declarations
// ---------------------------------------------------------------------------

test('SC4 fixture: guard rejects an Attempt record type declaration', () => {
  const findings = attemptShapedDeclarations(
    'export interface Attempt {\n  readonly id: string;\n  readonly missionId: string;\n}\n',
  );
  assert.ok(findings.length > 0, 'Guard must reject an Attempt interface declaration');
});

test('SC4 fixture: guard rejects an Attempt-shaped alias, class, and exported value', () => {
  assert.ok(
    attemptShapedDeclarations('export type AttemptId = string;').length > 0,
    'Guard must reject an AttemptId type alias',
  );
  assert.ok(
    attemptShapedDeclarations('class SqliteAttemptRepository {}').length > 0,
    'Guard must reject an Attempt repository class',
  );
  assert.ok(
    attemptShapedDeclarations('export const ATTEMPT_TABLE = "attempts";').length > 0,
    'Guard must reject an exported Attempt identifier',
  );
});

test('SC4 fixture: guard rejects an Attempt table and an attempt_id column reference', () => {
  assert.ok(
    attemptShapedDeclarations(
      'CREATE TABLE IF NOT EXISTS mission_attempts (\n  id TEXT PRIMARY KEY\n);',
    ).length > 0,
    'Guard must reject an Attempt table definition',
  );
  assert.ok(
    attemptShapedDeclarations("await db.execute('INSERT INTO attempts (id) VALUES (?)', [id]);").length > 0,
    'Guard must reject an insert into an attempts table',
  );
  assert.ok(
    attemptShapedDeclarations('interface Row { attempt_id: string }').length > 0,
    'Guard must reject an attempt_id column',
  );
});

// ---------------------------------------------------------------------------
// SC4 fixtures: the guard accepts innocuous existing code
// ---------------------------------------------------------------------------

test('SC4 fixture: guard accepts a local retry counter and loop variable', () => {
  assert.deepEqual(
    attemptShapedDeclarations(
      'const DEFAULT_MAX_ATTEMPTS = 5;\nlet attempts = 0;\nwhile (attempts < DEFAULT_MAX_ATTEMPTS) { attempts += 1; }\n',
    ),
    [],
    'A local retry counter is not a declared Attempt record and must not be flagged',
  );
});

test('SC4 fixture: guard accepts the word "attempt" in comments', () => {
  assert.deepEqual(
    attemptShapedDeclarations(
      '-- Idempotency key: application-generated, unique per emission attempt.\nCREATE TABLE board_lane_events (id TEXT PRIMARY KEY);\n',
    ),
    [],
    'A SQL comment mentioning an attempt must not be flagged',
  );
  assert.deepEqual(
    attemptShapedDeclarations(
      '// There is no production Attempt type.\n/* Attempt is excluded by ADR 0053. */\nexport interface Mission { readonly id: string }\n',
    ),
    [],
    'TypeScript comments mentioning Attempt must not be flagged',
  );
});

// ---------------------------------------------------------------------------
// SC5: ADR 0053 and src/domain/README.md state the same outcome as the code
// ---------------------------------------------------------------------------

test('SC5: ADR 0053 records Attempt as excluded, matching the checked code', () => {
  const adr = fs.readFileSync(path.join(ROOT, ADR_0053), 'utf8');
  const row = adr.split('\n').find((line) => line.startsWith('| `Attempt` |'));
  assert.ok(row, `${ADR_0053} must contain an \`Attempt\` decision row`);
  assert.match(
    row as string,
    /\*\*Excluded\.\*\*/,
    'The ADR 0053 Attempt row must state Excluded while no Attempt type exists in src/domain',
  );
  assert.equal(
    PER_LAUNCH_IDENTITY_DECISION.required,
    false,
    'ADR 0053 and the checked decision must agree that Attempt is not required',
  );
});

test('SC5: ADR 0053 names the test that locks the Attempt exclusion', () => {
  const adr = fs.readFileSync(path.join(ROOT, ADR_0053), 'utf8');
  assert.ok(
    adr.includes('test/domain-attempt-guard.test.ts'),
    'ADR 0053 must name the guard that makes the Attempt exclusion executable rather than prose',
  );
});

test('SC5: src/domain/README.md contains no Attempt statement contradicting src/domain', () => {
  const readme = fs.readFileSync(path.join(ROOT, DOMAIN_README), 'utf8');
  // The README may say Attempt is absent; it must not claim one exists.
  assert.ok(
    !/`Attempt`\s+is\s+(?:a|the)\s+(?:domain|checked)/i.test(readme),
    'src/domain/README.md must not claim a checked Attempt concept exists',
  );
  assert.ok(
    readme.includes('test/domain-attempt-guard.test.ts'),
    'src/domain/README.md must point at the guard that enforces the Attempt decision',
  );
});
