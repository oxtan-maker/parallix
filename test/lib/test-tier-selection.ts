/**
 * test-tier-selection.ts — pure verification-tier suite selection (TASK-2547).
 *
 * Extracted from test/lib/test-run-plan.ts so that coverage execution, the
 * runner, and the regression test all consume the SAME membership authority
 * instead of re-deriving it from filesystem globs or heuristics. See
 * test/task-2547-repro.test.ts. The CI/local arrays live only in
 * test/lib/test-categories.ts and are never copied here.
 */
import fs from 'node:fs';
import path from 'node:path';
import { INTEGRATION_CI_TESTS, INTEGRATION_LOCAL_TESTS } from '../../test/lib/test-categories.js';

export interface TierFileSelection {
  /** Hermetic unit population (the default suite). */
  unit: string[];
  /** Files selected positively from INTEGRATION_CI_TESTS. */
  integrationCi: string[];
  /** Files selected positively from INTEGRATION_LOCAL_TESTS. */
  integrationLocal: string[];
  /** Every integration-layer file (integration-ci + integration-local). */
  allIntegration: string[];
}

/**
 * Select the files for each verification tier. Pure: no child spawns, no
 * process state. Reads file contents only for the boundary heuristic.
 */
export function selectTierFiles(executionRoot: string): TierFileSelection {
  const testRoot = path.join(executionRoot, 'test');

  const allRootTestFiles = fs.readdirSync(testRoot)
    .sort()
    .filter(file => /\.test\.(?:js|ts)$/.test(file))
    // Lifecycle E2E is an integration gate. Keeping it out of the fast default
    // suite prevents review/checkpoint verification from repeatedly running it.
    .filter(file => file !== 'e2e-mission-lifecycle.test.ts')
    // This suite exercises a real agent runner and is likewise integration-only.
    .filter(file => file !== 'e2e-real-agent-smoke.test.ts');

  // Discover test files from known subdirectories.
  function findSubdirTests(subdir: string): string[] {
    const dirPath = path.join(testRoot, subdir);
    if (!fs.existsSync(dirPath) || !fs.statSync(dirPath).isDirectory()) {
      return [];
    }
    return fs.readdirSync(dirPath)
      .sort()
      .filter(file => /\.test\.(?:js|ts)$/.test(file))
      .map(file => path.join(testRoot, subdir, file));
  }
  const allSubdirTestFiles = findSubdirTests('adapters');

  // These markers identify tests that cross a real process, Git/worktree,
  // package, or network boundary. Keep that coverage intact, but run it only
  // through the explicit integration command rather than the hermetic default.
  const boundaryDependencyPattern = /\b(?:\w+\.)?(?:spawnSync|spawn|execSync|execFileSync|execFile|fork)\s*\(|git\s+(?:init|worktree|clone|commit|checkout|rebase|merge)|npm\s+(?:pack|install)|createServer|\bfetch\s*\(/;
  const knownIntegrationTestFiles = new Set([
    // Constructs the production composition graph, including a real SQLite
    // Mission store, so it crosses an adapter boundary even without a visible
    // process or database marker in the test source.
    'application-boundaries.test.ts',
    // Measured at 55.7s in the CP-1 uncontended run; it drives draft workflow
    // fixtures across the command boundary even though its process launcher is
    // dependency-injected in the source.
    'draft.test.ts',
    'draft-command.test.ts',
    'draft_preflight_modern.test.ts',
    'durable-state-policy.test.ts',
    'startup-preflight.test.ts',
    // The final CP-3 timing capture found these groups still crossing the
    // Forgejo/worktree, agent-launcher, rebase, or review-artifact boundary.
    // Their fakes protect assertions but do not make the groups hermetic.
    'forgejo.test.ts',
    'forgejo-independence.test.ts',
    'mission-utils-worktree.test.ts',
    'mistral.test.ts',
    // This suite injects its launcher but deliberately invokes a real Node
    // child process to verify stdout and pipe-buffer behavior.
    'opencode-export.test.ts',
    'runtime-matrix.test.ts',
    'rebase_hardening.test.ts',
    'review-artifacts.test.ts',
    'review-commands-additional.test.ts',
    'review-commands-supplemental.test.ts',
    'review-identity.test.ts',
    'review-identity-placeholder.test.ts',
    'review.test.ts',
    'review-prompts.test.ts',
    // TASK-2322.12: review state moved onto the operator database, so these open
    // a real migrated SQLite file and a real git worktree. Their boundary markers
    // live in test/fixtures/review-state-db.js, which the content heuristic above
    // does not scan, so they are declared here instead.
    'review-state.test.ts',
    'review-state-class.test.ts',
    'task-1416-repro.test.ts',
    // TASK-2326: relocated from default suite — these cross a real process,
    // Git, or packaging boundary and are not hermetic unit tests.
    'task-2285-pack-install-smoke.test.ts',
    'task-2286-native-sea-smoke.test.ts',
    'task-2455-config-exit-status-repro.test.ts',
    'task-2312-label-sync.test.ts',
    'task-2318-temp-directory-leaks.test.ts',
    'task-2319-notices-git-tracking.test.ts',
    // TASK-2326 round 2: tui-spawn uses execFileSync (real process boundary)
    // and was relocated from the default suite to integration.
    'tui-spawn.test.ts',
    // This PTY smoke test launches the packaged CLI through a real child process.
    'tui-pty-smoke.test.ts',
    // These render the live Ink terminal surface with TTY-like streams. They
    // are renderer integration tests, not unit tests of the pure board logic.
    'task-2313-repro.test.ts',
    'task-2370-repro.test.ts',
    'tui-command-flow.test.ts',
    // Unit tests must not open a real SQL database or cross a process
    // boundary, even when the database is a temp file and the spawn is a
    // tiny script. The content heuristic above cannot see boundaries that
    // live in test/fixtures/* helpers (review-state-db.ts, 
    // task-2357-statistics-fixture.ts) or behind a promisified/execFile 
    // wrapper, so every such file is declared here.
    'board-event-metrics-fixture.test.ts',
    'board-event-recorder.test.ts',
    'board-lane-events-migration.test.ts',
    'e2e-mission-sqlite-cutover.test.ts',
    'review-backfill.test.ts',
    'review-events.test.ts',
    'session-marker-repository.test.ts',
    'sqlite-adapter-cp1.test.ts',
    'sqlite-async-cascade-cp3.test.ts',
    'sqlite-importer-cp4.test.ts',
    'sqlite-ports-cp2.test.ts',
    'stats.test.ts',
    'task-2220-repro.test.ts',
    'task-2241-tmp-cleanup-repro.test.ts',
    'task-2322-05-mission-sqlite-fixture.test.ts',
    'task-2322-05-mission-use-cases.test.ts',
    'task-2322.04-mission-import.test.ts',
    'task-2322.11-operator-state.test.ts',
    'task-2322.12-stray-persistence.test.ts',
    // TASK-2337 records stage statistics against a migrated Mission database
    // to prove the authoritative classification required by the producer.
    'task-2337-repro.test.ts',
    'task-2339-aggregate-read-during-write.test.ts',
    'task-2339-writes-outlive-close.test.ts',
    'task-2345-repro.test.ts',
    'task-2347-01-repository-identity-repro.test.ts',
    'task-2347.02-lifecycle-history.test.ts',
    'task-2347.02-repro.test.ts',
    'task-2348-implementer-attribution.test.ts',
    'task-2350-reconcile-interrupted-handoff.test.ts',
    'task-2357-certification.test.ts',
    'task-2357.a-historical-intake.test.ts',
    'task-2357.c-unknown-review-fix-rounds.test.ts',
    'task-2357.d-completion-population.test.ts',
    'task-2357.e-legacy-history-scope.test.ts',
    'task-2357.g-per-metric-evidence.test.ts',
    'task-2363-repository-identity.test.ts',
    'task-2363-review-fix-rounds.test.ts',
    'task-2363-windowed-cohorts.test.ts',
    'task-2367-certification.test.ts',
    'task-2367-regressions.test.ts',
    'task-2367-repair.test.ts',
    'task-2367-telemetry-schema.test.ts',
    'task-2369-regressions.test.ts',
    'task-2373-shutdown.test.ts',
    'task-2375-active-invocation-overlap.test.ts',
    'task-2375-current-work-operation-repro.test.ts',
    // TASK-2566 creates temporary Git repositories to exercise mission Sonar
    // classification; the fixture helper hides that boundary from the scan.
    'task-2566-sonar-boundary-repro.test.ts',
    // TASK-2585 verifies provider publication proofs through injected API
    // responses, so it is integration-only even without a visible boundary
    // token in its test source.
    'task-2585-github-publication-proof.test.ts',
    'task-2585-workflow-proof-reuse.test.ts',
    // TASK-2580 crosses the real active-command and loopback web boundaries.
    'task-2580-active-persisted-mission-repro.test.ts',
    // TASK-2397: integrate active+approved recovery repro. It builds throwaway
    // git repos in a temp dir to stage the stuck-lane scenario, so it crosses a
    // real git boundary the content heuristic sees and belongs in integration.
    'task-2397-integrate-active-approved-recovery.test.ts',
    // TASK-2420: integrate recovery repro by the assigned reviewer. It builds
    // throwaway git repos in a temp dir to stage the stranded-lane scenario,
    // so it crosses a real git boundary like task-2397 and belongs in integration.
    'task-2420-integrate-recovery-assigned-reviewer.test.ts',
    // TASK-2438 composes concrete board readers over temporary repository
    // files, which invokes the worktree/Git topology boundary.
    'task-2438-worktree-board-repro.test.ts',
    // TASK-2582: opens a real migrated SQLite operator database in a temp
    // directory and drives the real MissionLifecycleService and review
    // persistence boundaries. The SQLite boundary is not visible to the
    // content heuristic, so both files are declared here.
    'task-2582-lifecycle-ordering.test.ts',
    'task-2582-repro.test.ts',
    // TASK-2601 opens a migrated SQLite Mission store and measurement store.
    'task-2601-repro.test.ts',
    // TASK-2492 drives the composed integration command against an on-disk
    // repository fixture and a real lifecycle state machine. Its injected
    // external seams keep the assertions deterministic, but that composition
    // belongs to the integration tier rather than the hermetic unit suite.
    'task-2492-integrate-gate-bounce.test.ts',
    // TASK-2598: run the real `bwrap` binary through
    // test/lib/claude-credential-fixture.ts, where the content heuristic
    // cannot see the spawn, so both files are declared here.
    'task-2598-claude-credential-cell.test.ts',
    'task-2598-repro.test.ts',
  ]);

  // Classify subdir tests through the same boundary filter as root-level tests,
  // plus any explicitly registered in knownIntegrationTestFiles (relative path).
  const subdirIntegrationFiles = allSubdirTestFiles.filter(fp => {
    const relativePath = path.relative(testRoot, fp);
    return knownIntegrationTestFiles.has(relativePath)
      || boundaryDependencyPattern.test(fs.readFileSync(fp, 'utf8'));
  });
  const subdirUnitFiles = allSubdirTestFiles.filter(fp => !subdirIntegrationFiles.includes(fp));

  // tui-spawn.test.ts uses execFileSync (artifact-verification test that
  // spawns build/px.mjs). It crosses a real process boundary and was
  // relocated to the integration layer in task-2326 round 2.
  // When explicitly requested as the sole file, the bootstrap preload is
  // bypassed so the child runs with the real environment.
  const artifactSpawnTestFiles = new Set();
  const integrationTestFiles = allRootTestFiles
    .filter(file => {
      // New boundary tests declare their category in the filename. This avoids
      // silently activating real databases/filesystems/processes in `npm test`
      // merely because a heuristic did not recognize their dependency.
      return file.endsWith('.integration.test.ts')
        || knownIntegrationTestFiles.has(file)
        || boundaryDependencyPattern.test(fs.readFileSync(path.join(testRoot, file), 'utf8'));
    })
    .map(file => path.join(testRoot, file));
  const defaultTestFiles = [
    ...allRootTestFiles
      .filter(file => !integrationTestFiles.includes(path.join(testRoot, file)))
      .map(file => path.join(testRoot, file)),
    ...subdirUnitFiles,
  ];
  // Verification-tier selectors (TASK-2500.04). `--integration` keeps running
  // the whole integration layer so the existing local gate is unchanged, while
  // `--integration-ci` and `--integration-local` select POSITIVELY from the
  // registry in test/lib/test-categories.ts. A newly authored integration test
  // that nobody classified therefore reaches neither tier command, instead of
  // silently inheriting GitHub-CI membership.
  const allIntegrationFiles = [...integrationTestFiles, ...subdirIntegrationFiles];
  function declaredTier(declared: readonly string[]): string[] {
    return allIntegrationFiles.filter(file => declared.includes(path.relative(testRoot, file)));
  }

  return {
    unit: defaultTestFiles,
    integrationCi: declaredTier(INTEGRATION_CI_TESTS),
    integrationLocal: declaredTier(INTEGRATION_LOCAL_TESTS),
    allIntegration: allIntegrationFiles,
  };
}
