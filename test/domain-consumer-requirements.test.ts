// TASK-2322.02 CP 1 — the consumer → domain-concept mapping must stay true.
//
// These tests fail if a consumer family disappears from the mapping, if a
// mapping entry names a concept that `src/domain` does not export, if a cited
// `file:line` no longer exists or no longer contains the cited anchor, or if
// the recorded `Attempt` branch decision stops matching its own evidence.
//
// Everything here reads checked source from disk. No Forgejo call, no agent
// launch, and no CLI subprocess.

import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';

import {
  PER_LAUNCH_IDENTITY_DECISION,
  CONSUMER_DOMAIN_REQUIREMENTS,
  CONSUMER_FAMILIES,
  DOMAIN_CONCEPT_NAMES,
  conceptsReadByConsumers,
  consumersForFamily,
} from '../src/application/consumer-domain-requirements.js';

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
