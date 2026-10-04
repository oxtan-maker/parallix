// Historical regression provenance: TASK-2322.02.
// Domain architecture guards: src/domain stays free of infrastructure imports,
// excludes Attempt, and every consumer requirement stays traced to real code.
//
// Behavior-owned suite (TASK-2622.06 pilot). Reads checked source from disk
// only. Legacy case names are unchanged; sections keep task provenance.
//   Domain import boundary: SC1 (no task ID in the legacy file)
//   Attempt exclusion guard: TASK-2322.02
//   Consumer-to-domain requirements: TASK-2322.02

import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { PER_LAUNCH_IDENTITY_DECISION, CONSUMER_DOMAIN_REQUIREMENTS, CONSUMER_FAMILIES, DOMAIN_CONCEPT_NAMES, conceptsReadByConsumers, consumersForFamily } from '../../../src/application/consumer-domain-requirements.js';

describe('Domain import boundary (SC1)', () => {
  // SC1: every file under src/domain imports no infrastructure module. The domain
  // layer may only import from within itself (relative specifiers). This test is
  // behavioral: it fails if any domain file imports a forbidden module, and the
  // fixture assertions fail if the detector stops flagging forbidden specifiers.

  const DOMAIN_DIR = path.join(process.cwd(), 'src', 'domain');

  // Infra tokens that are also forbidden even on a relative specifier (Git,
  // Forgejo, and terminal-rendering modules reached by escaping the domain dir).
  const FORBIDDEN_RELATIVE_TOKENS = ['/git.', 'core/git', 'tools/forgejo', 'forgejo', '/fmt.', 'core/fmt'];

  function importSpecifiers(source: string): string[] {
    return [...source.matchAll(/(?:from\s+|import\s*(?:\(\s*)?|require\s*\(\s*)['"]([^'"]+)['"]/g)]
      .map((match) => match[1] as string);
  }

  /** A domain import is forbidden when it is not a within-domain relative
   * specifier. Non-relative specifiers (`react`, `ink`, `node:fs`, `node:sqlite`,
   * `node:path`, ...) are all forbidden; relative specifiers are allowed unless
   * they escape into a Git/Forgejo/terminal infra module. */
  function forbiddenImports(source: string): string[] {
    const violations: string[] = [];
    for (const specifier of importSpecifiers(source)) {
      const isRelative = specifier.startsWith('./') || specifier.startsWith('../');
      if (!isRelative) {
        violations.push(specifier);
        continue;
      }
      if (FORBIDDEN_RELATIVE_TOKENS.some((token) => specifier.includes(token))) {
        violations.push(specifier);
      }
    }
    return violations;
  }

  function domainFiles(): string[] {
    return fs.readdirSync(DOMAIN_DIR)
      .filter((name) => name.endsWith('.ts'))
      .map((name) => path.join(DOMAIN_DIR, name));
  }

  test('SC1: no src/domain file imports a forbidden infrastructure module', () => {
    const offenders: string[] = [];
    for (const file of domainFiles()) {
      const source = fs.readFileSync(file, 'utf8');
      for (const specifier of forbiddenImports(source)) {
        offenders.push(`${path.relative(process.cwd(), file)}: ${specifier}`);
      }
    }
    assert.deepEqual(offenders, [], `Forbidden domain imports:\n${offenders.join('\n')}`);
  });

  test('SC1: the domain modules are present and scanned', () => {
    const names = domainFiles().map((file) => path.basename(file));
    for (const required of [
      'mission.ts', 'mission-workflow.ts', 'checkpoint.ts',
      'review.ts', 'agents.ts', 'usage.ts', 'repository.ts', 'session.ts',
    ]) {
      assert.ok(names.includes(required), `missing domain module ${required}`);
    }
  });

  test('SC1 detector bites: forbidden specifiers are flagged', () => {
    for (const token of ['react', 'ink', 'node:sqlite', 'node:fs', 'node:child_process', 'node:os', 'node:path']) {
      assert.deepEqual(
        forbiddenImports(`import x from '${token}';`),
        [token],
        `detector should flag ${token}`,
      );
    }
    // A Git/terminal relative infra import is flagged even though it is relative.
    assert.deepEqual(forbiddenImports("import { git } from '../core/git.js';"), ['../core/git.js']);
    // A within-domain relative import is allowed.
    assert.deepEqual(forbiddenImports("import { x } from './mission.js';"), []);
  });
});

describe("Attempt exclusion guard", () => {
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
  function attemptShapedDeclarations(rawSource: string): string[] {
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
      adr.includes('test/unit/domain/domain-architecture-guards.test.ts'),
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
      readme.includes('test/unit/domain/domain-architecture-guards.test.ts'),
      'src/domain/README.md must point at the guard that enforces the Attempt decision',
    );
  });
});

describe("Consumer-to-domain requirements", () => {
  // TASK-2322.02 CP 1 — the consumer → domain-concept mapping must stay true.
  //
  // These tests fail if a consumer family disappears from the mapping, if a
  // mapping entry names a concept that `src/domain` does not export, if a cited
  // `file:line` no longer exists or no longer contains the cited anchor, or if
  // the recorded `Attempt` branch decision stops matching its own evidence.
  //
  // Everything here reads checked source from disk. No Forgejo call, no agent
  // launch, and no CLI subprocess.
  const ROOT = process.cwd();
  const DOMAIN_DIR = path.join(ROOT, 'src', 'domain');

  /** Every type/interface/class name exported by a file under `src/domain`. */
  function exportedDomainTypeNames(): Set<string> {
    const names = new Set<string>();
    for (const entry of fs.readdirSync(DOMAIN_DIR)) {
      if (!entry.endsWith('.ts')) { continue; }
      const source = fs.readFileSync(path.join(DOMAIN_DIR, entry), 'utf8');
      for (const match of source.matchAll(/^export\s+(?:interface|type|class|enum)\s+(\w+)/gm)) {
        names.add(match[1] as string);
      }
    }
    return names;
  }

  function sourceLine(fileLocation: string, line: number): string | null {
    const full = path.join(ROOT, fileLocation);
    if (!fs.existsSync(full)) { return null; }
    const lines = fs.readFileSync(full, 'utf8').split('\n');
    return line >= 1 && line <= lines.length ? (lines[line - 1] as string) : null;
  }

  // ---------------------------------------------------------------------------
  // SC2: all six consumer families are covered and name real domain concepts
  // ---------------------------------------------------------------------------

  test('SC2: every consumer family has at least one traced consumer', () => {
    const missing = CONSUMER_FAMILIES.filter(
      (family) => consumersForFamily(family).length === 0,
    );
    assert.deepEqual(
      missing,
      [],
      `These consumer families have no traced consumer: ${missing.join(', ')}`,
    );
  });

  test('SC2: the mapping covers exactly the six declared families', () => {
    const declared = new Set<string>(CONSUMER_FAMILIES);
    const used = new Set(CONSUMER_DOMAIN_REQUIREMENTS.map((entry) => entry.family));
    assert.deepEqual([...used].sort(), [...declared].sort());
    assert.equal(declared.size, 6, 'TASK-2322.02 traces exactly six consumer families');
  });

  test('SC2: every concept named by a consumer is exported by src/domain', () => {
    const exported = exportedDomainTypeNames();
    const unknown: string[] = [];
    for (const entry of CONSUMER_DOMAIN_REQUIREMENTS) {
      for (const concept of entry.reads) {
        if (!exported.has(concept)) {
          unknown.push(`${entry.id}: ${concept}`);
        }
      }
    }
    assert.deepEqual(
      unknown,
      [],
      `These consumer entries name concepts that src/domain does not export:\n${unknown.join('\n')}`,
    );
  });

  test('SC2: every consumer entry reads at least one domain concept', () => {
    const empty = CONSUMER_DOMAIN_REQUIREMENTS
      .filter((entry) => entry.reads.length === 0)
      .map((entry) => entry.id);
    assert.deepEqual(empty, [], `Consumer entries with no domain concept: ${empty.join(', ')}`);
  });

  test('SC2: all nine ADR 0053 domain concepts are read by a traced consumer', () => {
    const covered = new Set(conceptsReadByConsumers());
    const uncovered = DOMAIN_CONCEPT_NAMES.filter((concept) => !covered.has(concept));
    assert.deepEqual(
      uncovered,
      [],
      `These domain concepts have no traced consumer: ${uncovered.join(', ')}`,
    );
  });

  test('SC2: consumer entry ids are unique', () => {
    const ids = CONSUMER_DOMAIN_REQUIREMENTS.map((entry) => entry.id);
    assert.equal(new Set(ids).size, ids.length, 'Consumer entry ids must be unique');
  });

  // ---------------------------------------------------------------------------
  // SC3: every cited file:line resolves, and the cited line still matches
  // ---------------------------------------------------------------------------

  test('SC3: every consumer fileLocation resolves to an existing file', () => {
    const missing = CONSUMER_DOMAIN_REQUIREMENTS
      .filter((entry) => !fs.existsSync(path.join(ROOT, entry.fileLocation)))
      .map((entry) => `${entry.id}: ${entry.fileLocation}`);
    assert.deepEqual(
      missing,
      [],
      `These consumer fileLocations do not exist:\n${missing.join('\n')}`,
    );
  });

  test('SC3: every consumer citation points at a line containing its anchor', () => {
    const drifted: string[] = [];
    for (const entry of CONSUMER_DOMAIN_REQUIREMENTS) {
      const line = sourceLine(entry.fileLocation, entry.line);
      if (line === null) {
        drifted.push(`${entry.id}: ${entry.fileLocation}:${entry.line} is out of range`);
        continue;
      }
      if (!line.includes(entry.anchor)) {
        drifted.push(
          `${entry.id}: ${entry.fileLocation}:${entry.line} no longer contains ${JSON.stringify(entry.anchor)}; found ${JSON.stringify(line.trim())}`,
        );
      }
    }
    assert.deepEqual(drifted, [], `Stale consumer citations:\n${drifted.join('\n')}`);
  });

  test('SC3 detector bites: a wrong line number is reported as drift', () => {
    const entry = CONSUMER_DOMAIN_REQUIREMENTS[0];
    const wrongLine = sourceLine(entry.fileLocation, entry.line + 1);
    assert.ok(
      wrongLine === null || !wrongLine.includes(entry.anchor),
      'The anchor check must not pass for a neighbouring line, or it proves nothing',
    );
  });

  // ---------------------------------------------------------------------------
  // SC4: the recorded Attempt branch decision matches its own evidence
  // ---------------------------------------------------------------------------

  test('SC4: the Attempt branch decision cites existing consumer entries', () => {
    const known = new Set(CONSUMER_DOMAIN_REQUIREMENTS.map((entry) => entry.id));
    const unknown = PER_LAUNCH_IDENTITY_DECISION.evidence.filter((id) => !known.has(id));
    assert.deepEqual(
      unknown,
      [],
      `The Attempt decision cites unknown consumer ids: ${unknown.join(', ')}`,
    );
    assert.ok(
      PER_LAUNCH_IDENTITY_DECISION.evidence.length > 0,
      'The Attempt decision must cite at least one consumer',
    );
  });

  test('SC4: no consumer requires durable per-launch identity while Attempt is excluded', () => {
    const durableEntityConsumers = CONSUMER_DOMAIN_REQUIREMENTS
      .filter((entry) => entry.perLaunchIdentity === 'durable-idempotency-key')
      .map((entry) => entry.id);

    // A durable idempotency key is permitted; it is technical persistence
    // metadata, not an entity. Anything stronger would force the Attempt branch.
    assert.deepEqual(
      durableEntityConsumers,
      ['retry-stage-launch-dedupe'],
      'Only the stats de-duplication fingerprint may hold a durable per-launch value; a new one requires re-deciding the Attempt branch',
    );
    assert.equal(
      PER_LAUNCH_IDENTITY_DECISION.required,
      false,
      'CP 1 decided the not-required Attempt branch; reversing it requires the CP 3 stop rule, not a silent edit',
    );
  });
});
