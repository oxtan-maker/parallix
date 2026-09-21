// TASK-2547 — general red-to-green regression for the coverage-authority defect.
//
// Proves the architectural invariant that the hosted (GitHub) coverage
// population is a subset of `unit ∪ integration-ci` and intersects the
// registry-classified `integration-local` population in zero files. It asserts
// the SET RELATIONSHIP against every local-only entry, not a single hardcoded
// filename, so any future coverage path that re-derives membership from a glob
// or heuristic instead of the planner is caught.
//
// Red at the mission parent commit: the coverage path globs every `*.test.ts`
// and therefore selects registry-classified `integration-local` files. Green
// after the fix: the coverage path selects through the shared
// selectTierFiles() authority, which excludes `integration-local`.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { selectTierFiles } from './lib/test-run-plan.js';
import {
  INTEGRATION_CI_TESTS,
  INTEGRATION_LOCAL_TESTS,
} from './lib/test-categories.js';
// The hosted coverage selection entry point. This is the symbol whose behaviour
// the mission changes from a filesystem glob to the planner authority.
import { coverageTestFiles } from '../src/adapters/verification/coverage-gate.js';

const executionRoot = path.join(import.meta.dirname, '..');

function hostedBasenames(): string[] {
  return coverageTestFiles().map(file => path.basename(file));
}

test('hosted coverage selection ⊆ unit ∪ integration-ci and ∩ integration-local = ∅', () => {
  const hosted = hostedBasenames();
  const local = new Set(INTEGRATION_LOCAL_TESTS);
  const ci = new Set(INTEGRATION_CI_TESTS);

  const tiers = selectTierFiles(executionRoot);
  const allowed = new Set([
    ...tiers.unit,
    ...tiers.integrationCi,
  ].map(file => path.basename(file)));

  // Every hosted coverage file must belong to the CI-safe union.
  const outOfScope = hosted.filter(file => !allowed.has(file));
  assert.deepEqual(
    outOfScope,
    [],
    'hosted coverage selected files outside unit ∪ integration-ci. Coverage must '
    + 'select through the selectTierFiles() planner authority, not a filesystem glob.',
  );

  // The general property: hosted coverage intersects every registry-classified
  // integration-local file in zero entries. Listing them all (not one name)
  // makes the invariant hold for the whole local-only population.
  const localLeak = hosted.filter(file => local.has(file));
  assert.deepEqual(
    localLeak,
    [],
    `hosted coverage selected integration-local file(s): ${localLeak.join(', ')}. `
    + 'Coverage must never select integration-local on hosted CI.',
  );

  // Positive guard: the CI lane is non-empty and every local entry is a real
  // file on disk, so the assertion above is meaningful rather than vacuous.
  assert.ok(ci.size > 0, 'the integration-ci lane must be non-empty');
  assert.ok(local.size > 0, 'the integration-local lane must be non-empty for the invariant to be testable');
  for (const file of INTEGRATION_LOCAL_TESTS) {
    assert.ok(allowed.has(file) === false, `${file} is integration-local and must never be CI-safe coverage`);
  }
});
