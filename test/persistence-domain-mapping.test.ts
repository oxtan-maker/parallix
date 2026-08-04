// TASK-2322.02 CP 2 — the inventory → domain resolution must stay total.
//
// These tests enumerate `ADR0053_PERSISTENCE_INVENTORY` and fail when a
// `database-owned-domain-state` entry resolves to neither a domain type with an
// invariant nor the explicit technical-persistence-metadata list, when it
// resolves to both (or twice), when it names a concept `src/domain` does not
// export, or when a cited invariant location has drifted.
//
// The join lives here rather than in `src/application` because ADR 0051 keeps
// application code from importing the runtime module that owns the inventory.
//
// All assertions read checked source from disk. No Forgejo call, no agent
// launch, no CLI subprocess.

import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';

import { ADR0053_PERSISTENCE_INVENTORY } from './fixtures/durable-state-inventory.js';
import {
  DOMAIN_CONCEPT_INVARIANTS,
  TECHNICAL_INVENTORY_RESOLUTIONS,
  TECHNICAL_PERSISTENCE_METADATA,
  resolveInventoryEntry,
  technicalMetadata,
  type DomainConceptName,
} from '../src/application/persistence-domain-map.js';

const ROOT = process.cwd();
const DOMAIN_DIR = path.join(ROOT, 'src', 'domain');

/** Inventory entries classified `database-owned-domain-state`. */
function databaseOwnedEntries() {
  return ADR0053_PERSISTENCE_INVENTORY
    .filter((entry) => entry.classification === 'database-owned-domain-state');
}

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
// SC1: every database-owned entry resolves exactly once
// ---------------------------------------------------------------------------

test('SC1: every database-owned-domain-state entry has a resolution', () => {
  const unresolved = databaseOwnedEntries()
    .filter((entry) => resolveInventoryEntry(entry.id, entry.concept) === undefined)
    .map((entry) => entry.id);
  assert.deepEqual(
    unresolved,
    [],
    `These database-owned-domain-state entries resolve to neither a domain type nor technical persistence metadata:\n${unresolved.join('\n')}`,
  );
});

test('SC1: technical inventory resolution ids are unique', () => {
  const ids = TECHNICAL_INVENTORY_RESOLUTIONS.map((entry) => entry.entryId);
  assert.equal(
    new Set(ids).size,
    ids.length,
    'A technical inventory entry must not have multiple exceptional resolutions',
  );
});

test('SC1: every technical resolution names a database-owned inventory entry', () => {
  const databaseOwned = new Set(databaseOwnedEntries().map((entry) => entry.id));
  const stray = TECHNICAL_INVENTORY_RESOLUTIONS
    .map((entry) => entry.entryId)
    .filter((id) => !databaseOwned.has(id));
  assert.deepEqual(
    stray,
    [],
    `These technical resolutions do not correspond to a database-owned-domain-state inventory entry:\n${stray.join('\n')}`,
  );
});

test('SC1: technical resolutions do not shadow checked domain concepts', () => {
  const conceptById = new Map(
    databaseOwnedEntries().map((entry) => [entry.id, entry.concept]),
  );
  const shadowed = TECHNICAL_INVENTORY_RESOLUTIONS
    .filter((entry) => DOMAIN_CONCEPT_INVARIANTS[conceptById.get(entry.entryId) as DomainConceptName] !== undefined)
    .map((entry) => entry.entryId);
  assert.deepEqual(
    shadowed,
    [],
    `These exceptional resolutions redundantly override a checked domain concept:\n${shadowed.join('\n')}`,
  );
});

// ---------------------------------------------------------------------------
// SC1: a domain-type resolution names a real, invariant-carrying concept
// ---------------------------------------------------------------------------

test('SC1: every domain-type resolution names a concept exported by src/domain', () => {
  const exported = exportedDomainTypeNames();
  const unknown: string[] = [];
  for (const entry of databaseOwnedEntries()) {
    const resolution = resolveInventoryEntry(entry.id, entry.concept);
    if (resolution?.kind !== 'domain-type') { continue; }
    if (!exported.has(resolution.concept)) {
      unknown.push(`${entry.id}: ${resolution.concept}`);
    }
  }
  assert.deepEqual(
    unknown,
    [],
    `These resolutions name a type src/domain does not export:\n${unknown.join('\n')}`,
  );
});

test('SC1: every domain-type resolution has a stated invariant', () => {
  const missing: string[] = [];
  for (const entry of databaseOwnedEntries()) {
    const resolution = resolveInventoryEntry(entry.id, entry.concept);
    if (resolution?.kind !== 'domain-type') { continue; }
    const invariant = DOMAIN_CONCEPT_INVARIANTS[resolution.concept];
    if (!invariant || !invariant.invariant.trim()) {
      missing.push(`${entry.id}: ${resolution.concept}`);
    }
  }
  assert.deepEqual(
    missing,
    [],
    `These resolutions name a concept with no stated invariant:\n${missing.join('\n')}`,
  );
});

test('SC1: every invariant citation points at a line containing its anchor', () => {
  const drifted: string[] = [];
  for (const concept of Object.keys(DOMAIN_CONCEPT_INVARIANTS) as DomainConceptName[]) {
    const invariant = DOMAIN_CONCEPT_INVARIANTS[concept];
    const line = sourceLine(invariant.fileLocation, invariant.line);
    if (line === null) {
      drifted.push(`${concept}: ${invariant.fileLocation}:${invariant.line} is out of range`);
      continue;
    }
    if (!line.includes(invariant.anchor)) {
      drifted.push(
        `${concept}: ${invariant.fileLocation}:${invariant.line} no longer contains ${JSON.stringify(invariant.anchor)}`,
      );
    }
  }
  assert.deepEqual(drifted, [], `Stale invariant citations:\n${drifted.join('\n')}`);
});

test('SC1: every domain concept in the invariant table is keyed by its own name', () => {
  for (const concept of Object.keys(DOMAIN_CONCEPT_INVARIANTS) as DomainConceptName[]) {
    assert.equal(
      DOMAIN_CONCEPT_INVARIANTS[concept].concept,
      concept,
      `Invariant table key ${concept} does not match its recorded concept`,
    );
  }
});

// ---------------------------------------------------------------------------
// SC1: a technical-metadata resolution names a real, justified list item
// ---------------------------------------------------------------------------

test('SC1: every technical resolution names an existing technical-metadata item', () => {
  const unknown: string[] = [];
  for (const entry of TECHNICAL_INVENTORY_RESOLUTIONS) {
    if (technicalMetadata(entry.metadataId) === undefined) {
      unknown.push(`${entry.entryId}: ${entry.metadataId}`);
    }
  }
  assert.deepEqual(
    unknown,
    [],
    `These resolutions cite an unknown technical-metadata id:\n${unknown.join('\n')}`,
  );
});

test('SC1: no technical-metadata id collides with a domain concept name', () => {
  const conceptNames = new Set(Object.keys(DOMAIN_CONCEPT_INVARIANTS));
  const collisions = TECHNICAL_PERSISTENCE_METADATA
    .map((item) => item.id)
    .filter((id) => conceptNames.has(id));
  assert.deepEqual(
    collisions,
    [],
    'A technical-metadata id must not shadow a domain concept name',
  );
});

test('SC1: every technical-metadata item states why it is not a domain entity', () => {
  const unjustified = TECHNICAL_PERSISTENCE_METADATA
    .filter((item) => item.whyNotDomain.trim().length < 40)
    .map((item) => item.id);
  assert.deepEqual(
    unjustified,
    [],
    `These technical-metadata items lack a real justification: ${unjustified.join(', ')}`,
  );
});

test('SC1: every technical-metadata citation points at a line containing its anchor', () => {
  const drifted: string[] = [];
  for (const item of TECHNICAL_PERSISTENCE_METADATA) {
    const line = sourceLine(item.fileLocation, item.line);
    if (line === null) {
      drifted.push(`${item.id}: ${item.fileLocation}:${item.line} is out of range`);
      continue;
    }
    if (!line.includes(item.anchor)) {
      drifted.push(
        `${item.id}: ${item.fileLocation}:${item.line} no longer contains ${JSON.stringify(item.anchor)}`,
      );
    }
  }
  assert.deepEqual(drifted, [], `Stale technical-metadata citations:\n${drifted.join('\n')}`);
});

test('SC1: technical-metadata ids are unique', () => {
  const ids = TECHNICAL_PERSISTENCE_METADATA.map((item) => item.id);
  assert.equal(new Set(ids).size, ids.length, 'Technical-metadata ids must be unique');
});

// ---------------------------------------------------------------------------
// Detector fixtures: the enumerating test really bites
// ---------------------------------------------------------------------------

test('SC1 detector bites: an unresolved entry is reported', () => {
  const invented = 'mission-read-from-a-table-that-does-not-exist';
  assert.equal(
    resolveInventoryEntry(invented, 'Attempt'),
    undefined,
    'An unknown concept without an explicit technical resolution must stay unresolved',
  );
});

test('SC1 detector bites: an unknown domain type would be rejected', () => {
  const exported = exportedDomainTypeNames();
  assert.ok(exported.has('Mission'), 'Detector must recognise a real domain type');
  assert.ok(
    !exported.has('Attempt'),
    'src/domain must not export an Attempt type while ADR 0053 excludes it',
  );
});
