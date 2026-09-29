/**
 * coverage-gate.ts - LCOV helpers and the coverage test population for the
 * native Node coverage path (ADR 0062).
 *
 * Coverage is produced by `test/run-default-tests.ts` with Node's built-in
 * coverage (`--test-coverage-include-all` over `src/**\/*.ts`) as a reporting
 * mode of the unit and integration-ci executions. This module no longer runs
 * tests: TASK-2591 removed the c8 runner together with its raw V8 scratch,
 * orphan-recovery manifest and /tmp sweeper. What remains is the LCOV union
 * used by `npm run coverage:merge` and the tier-authority coverage population.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { compareCodeUnits } from '../../domain/comparators.js';
import { fileURLToPath } from 'node:url';
import { packageRoot } from '../filesystem/package-root.js';
// Coverage consumes the single verification-tier authority (test/lib/
// test-tier-selection.ts, extracted from test/lib/test-run-plan.ts). It never
// derives membership from a glob: see test/task-2547-repro.test.ts.
import { selectTierFiles } from '../../../test/lib/test-tier-selection.js';

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = packageRoot(MODULE_DIR);

function discoverTestFiles() {
  const testDir = path.join(REPO_ROOT, 'test');
  if (!fs.existsSync(testDir)) {return [];}
  return fs.readdirSync(testDir)
    .filter(file => file.endsWith('.test.ts'))
    .map(file => path.join(testDir, file))
    .sort(compareCodeUnits);
}

function coverageTestFiles() {
  // Authoritative tier selection, not a filesystem glob: the hosted GitHub
  // population is unit ∪ integration-ci, selected through the planner (never a
  // glob) so integration-local can never leak into coverage.
  const tiers = selectTierFiles(REPO_ROOT);
  return [...tiers.unit, ...tiers.integrationCi];
}

/**
 * Merge multiple LCOV fragments into one report. Reuses normalizeLcov(), which
 * unions every source/line across fragments with max-hits semantics (one DA:
 * per line, recomputed LF/LH), so no duplicate DA records survive. join('\n')
 * keeps each record on its own line.
 */
function mergeLcov(fragments: readonly string[]): string {
  return normalizeLcov(fragments.join('\n'));
}

function normalizeLcov(lcovText: string) {
  const files = new Map<string, Map<number, number>>();
  let sourceFile = '';
  for (const line of lcovText.split('\n')) {
    if (line.startsWith('SF:')) {
      sourceFile = line.slice(3);
      if (!files.has(sourceFile)) {files.set(sourceFile, new Map());}
    } else if (sourceFile && line.startsWith('DA:')) {
      const [lineNumber, hits] = line.slice(3).split(',').map(Number);
      const lines = files.get(sourceFile)!;
      lines.set(lineNumber, Math.max(lines.get(lineNumber) ?? 0, hits));
    }
  }
  return [...files].map(([file, lines]) => [
    `SF:${file}`,
    ...[...lines].sort(([a], [b]) => a - b).map(([line, hits]) => `DA:${line},${hits}`),
    `LF:${lines.size}`,
    `LH:${[...lines.values()].filter(hits => hits > 0).length}`,
    'end_of_record',
  ].join('\n')).join('\n') + (files.size ? '\n' : '');
}

export { coverageTestFiles, discoverTestFiles, mergeLcov, normalizeLcov };
