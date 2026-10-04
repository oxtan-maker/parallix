/**
 * test-tier-selection.ts — pure verification-tier suite selection (TASK-2547).
 *
 * Coverage execution, the runner, and the regression tests all consume this
 * SAME membership authority instead of re-deriving it from globs. The physical
 * path declares a suite's level (TASK-2638): everything below `test/unit/` is a
 * unit suite, while suites below `test/integration/` and `test/e2e/` run only
 * in the lane test/lib/test-categories.ts positively registers them in. The
 * CI/local/agent arrays live only in that registry and are never copied here;
 * test/lib/test-layout-validation.ts rejects suites the registry leaves out.
 */
import fs from 'node:fs';
import path from 'node:path';
import { AGENT_E2E_TESTS, INTEGRATION_CI_TESTS, INTEGRATION_LOCAL_TESTS } from './test-categories.js';

/** The physical test levels, as directories below `test/`. */
export const LEVEL_ROOTS = ['unit', 'integration', 'e2e'] as const;
export type TestLevel = typeof LEVEL_ROOTS[number];

/** A runnable suite: the extensions node --test receives from the planner. */
export const RUNNABLE_SUITE = /\.test\.(?:ts|js)$/;

export interface TierFileSelection {
  /** Every suite below test/unit/ (the default suite). */
  unit: string[];
  /** Suites selected positively from INTEGRATION_CI_TESTS. */
  integrationCi: string[];
  /** Suites selected positively from INTEGRATION_LOCAL_TESTS. */
  integrationLocal: string[];
  /** The full integration command population (integration-ci + integration-local). */
  allIntegration: string[];
  /** Real-agent and lifecycle suites with dedicated commands and gates. */
  agentE2e: string[];
}

/**
 * Recursively discover runnable suites below the three level roots. Returns
 * sorted, POSIX, test-root-relative identities such as
 * `unit/domain/mission.test.ts`, never basenames. Pure directory listing: no
 * test module is imported and no file content is read.
 */
export function discoverSuites(testRoot: string): string[] {
  const found: string[] = [];
  function walk(relativeDir: string): void {
    for (const entry of fs.readdirSync(path.join(testRoot, relativeDir), { withFileTypes: true })) {
      const relative = `${relativeDir}/${entry.name}`;
      if (entry.isDirectory()) { walk(relative); }
      else if (entry.isFile() && RUNNABLE_SUITE.test(entry.name)) { found.push(relative); }
    }
  }
  for (const level of LEVEL_ROOTS) {
    if (fs.existsSync(path.join(testRoot, level))) { walk(level); }
  }
  return found.sort();
}

/** The level a test-root-relative suite path declares, or null outside the roots. */
export function levelOf(suite: string): TestLevel | null {
  const first = suite.split('/')[0];
  return (LEVEL_ROOTS as readonly string[]).includes(first) ? first as TestLevel : null;
}

/** Absolute suite path to its test-root-relative POSIX identity. */
export function suiteIdentity(testRoot: string, file: string): string {
  return path.relative(testRoot, path.resolve(testRoot, file)).split(path.sep).join('/');
}

/** The lane lists selection reads; tests substitute synthetic registries. */
export interface LaneRegistry {
  readonly ci: readonly string[];
  readonly local: readonly string[];
  readonly agentE2e: readonly string[];
}

export const LANE_REGISTRY: LaneRegistry = {
  ci: INTEGRATION_CI_TESTS,
  local: INTEGRATION_LOCAL_TESTS,
  agentE2e: AGENT_E2E_TESTS,
};

/**
 * Select the files for each verification tier as absolute paths. Pure: no
 * child spawns, no process state, no content reads.
 */
export function selectTierFiles(executionRoot: string, registry: LaneRegistry = LANE_REGISTRY): TierFileSelection {
  const testRoot = path.join(executionRoot, 'test');
  const suites = discoverSuites(testRoot);
  const absolute = (files: string[]) => files.map(file => path.join(testRoot, ...file.split('/')));
  const declared = (lane: readonly string[]) => suites.filter(file => levelOf(file) !== 'unit' && lane.includes(file));
  const integrationCi = declared(registry.ci);
  const integrationLocal = declared(registry.local);
  return {
    unit: absolute(suites.filter(file => levelOf(file) === 'unit')),
    integrationCi: absolute(integrationCi),
    integrationLocal: absolute(integrationLocal),
    allIntegration: absolute(suites.filter(file => integrationCi.includes(file) || integrationLocal.includes(file))),
    agentE2e: absolute(declared(registry.agentE2e)),
  };
}
