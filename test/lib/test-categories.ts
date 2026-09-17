/**
 * test-categories.ts — the repository's verification-tier registry (TASK-2500.04).
 *
 * Parallix runs four semantically distinct verification lanes. This module is
 * the single authority for which lane a boundary test belongs to:
 *
 * - `unit`             hermetic, in-process, injected doubles only. Membership is
 *                      implicit: any discovered test file that the boundary
 *                      classification in `test-run-plan.ts` does not route to the
 *                      integration layer runs here.
 * - `integration-ci`   crosses a real process, Git, SQLite, packaging, or loopback
 *                      socket boundary using only what a clean GitHub-hosted runner
 *                      provides. Membership is POSITIVE: a file runs in this lane
 *                      only when it is listed in {@link INTEGRATION_CI_TESTS}.
 * - `integration-local` same boundaries, plus a workstation dependency a clean
 *                      runner does not have. Every entry records why in
 *                      {@link INTEGRATION_LOCAL_REASONS}.
 * - `agent-e2e`        needs a configured real agent runner and a reachable model
 *                      backend. Invoked only by its own commands and gates.
 *
 * The GitHub-safe lane must never grow by accident. A newly authored integration
 * test that is absent from both lists is rejected by
 * `test/test-categories.test.ts`, so adding one forces an explicit classification
 * decision rather than silently inheriting CI membership.
 */

export type TestCategory = 'unit' | 'integration-ci' | 'integration-local' | 'agent-e2e';

/**
 * Integration tests a clean GitHub-hosted runner can execute. Permitted
 * dependencies: `git`, `node`, `npm`, `bash`, `tar`, `/usr/bin/script`,
 * `/usr/bin/stty`, the repository checkout, temp directories, and loopback
 * sockets. Prohibited: local AI or model services, operator model configuration,
 * Forgejo credentials or live Forgejo state, worktrees the test did not create,
 * private local services, and any binary outside the clean runner image.
 */
export const INTEGRATION_CI_TESTS: readonly string[] = [
  'active.test.ts',
  'agents-limit-hit.test.ts',
  'agents.test.ts',
  'backlog.test.ts',
  'board-event-metrics-fixture.test.ts',
  'board-event-recorder.test.ts',
  'board-lane-events-migration.test.ts',
  'bootstrap-isolation.test.ts',
  'custom-capacity-multiprocess-repro.test.ts',
  'documentation-verification.test.ts',
  'draft-command.test.ts',
  'draft.test.ts',
  'draft_preflight_modern.test.ts',
  'durable-state-policy.test.ts',
  'e2e-mission-sqlite-cutover.test.ts',
  'external-target-resolution.test.ts',
  'forgejo-independence.test.ts',
  'forgejo-pr-round-sync.test.ts',
  'forgejo.test.ts',
  'handoff.test.ts',
  'install.test.ts',
  'integrate-conflict.test.ts',
  'integrate-task-1410-stash-pop-corruption.test.ts',
  'integrate-workflow-gate.test.ts',
  'integrate.test.ts',
  'integration-pipelines.test.ts',
  'mission-utils-worktree.test.ts',
  'mistral.test.ts',
  'nels.test.ts',
  'noise-reduction.test.ts',
  'opencode-export.test.ts',
  'package-persistent-data.test.ts',
  'product-config-cp.test.ts',
  'product-config-validation.test.ts',
  'product-config.test.ts',
  'px-runner.test.ts',
  'px-runtime-smoke.test.ts',
  'px-shell-init.test.ts',
  'rebase-use-case.test.ts',
  'rebase.test.ts',
  'rebase_diagnostics.test.ts',
  'rebase_hardening.test.ts',
  'refresh-global-px-script.test.ts',
  'resolve-conflict.test.ts',
  'review-artifacts.test.ts',
  'review-autoderive.test.ts',
  'review-backfill.test.ts',
  'review-commands-additional.test.ts',
  'review-commands-supplemental.test.ts',
  'review-events.test.ts',
  'review-identity-placeholder.test.ts',
  'review-identity.test.ts',
  'review-prompts.test.ts',
  'review-state-class.test.ts',
  'review-state.test.ts',
  'review.test.ts',
  'runtime-matrix.test.ts',
  'session-marker-repository.test.ts',
  'setup-review.test.ts',
  'sqlite-adapter-cp1.test.ts',
  'sqlite-async-cascade-cp3.test.ts',
  'sqlite-importer-cp4.test.ts',
  'sqlite-mission-store.integration.test.ts',
  'sqlite-ports-cp2.test.ts',
  'sqlite-recovery-cp5.test.ts',
  'startup-preflight.test.ts',
  'stats-backfill.test.ts',
  'stats.test.ts',
  'status.test.ts',
  'task-1048-regression.test.ts',
  'task-1049-force-push.test.ts',
  'task-1080-sync-merged-hardening.test.ts',
  'task-1104-rebase-cleanup.test.ts',
  'task-1209-consume-artifacts.test.ts',
  'task-1272-standalone-cycle.test.ts',
  'task-1272-standalone-rebase.test.ts',
  'task-1390-shell-init-shebang.test.ts',
  'task-1415-closed-mission-counts.test.ts',
  'task-1416-repro.test.ts',
  'task-1424-post-integrate-publish-reinstall.test.ts',
  'task-2203-publish-proof-refresh-order.test.ts',
  'task-2206-post-integrate-hook-errors.test.ts',
  'task-2212-repro.test.ts',
  'task-2220-repro.test.ts',
  'task-2231-unit-tests-hang-repro.test.ts',
  'task-2234-push-to-reviewer-autobounce.test.ts',
  'task-2241-tmp-cleanup-repro.test.ts',
  'task-2273-review-gate-ownership.test.ts',
  'task-2285-pack-install-smoke.test.ts',
  'task-2312-label-sync.test.ts',
  'task-2313-repro.test.ts',
  'task-2318-temp-directory-leaks.test.ts',
  'task-2319-notices-git-tracking.test.ts',
  'task-2322-05-mission-sqlite-fixture.test.ts',
  'task-2322-05-mission-use-cases.test.ts',
  'task-2322.11-operator-state.test.ts',
  'task-2322.12-review-recovery.integration.test.ts',
  'task-2322.12-stray-persistence.test.ts',
  'task-2327-coverage-gate-tmp-leaks.test.ts',
  'task-2339-aggregate-read-during-write.test.ts',
  'task-2339-writes-outlive-close.test.ts',
  'task-2345-repro.test.ts',
  'task-2347-01-repository-identity-repro.test.ts',
  'task-2347.02-lifecycle-history.test.ts',
  'task-2347.02-repro.test.ts',
  'task-2347.10-repro.test.ts',
  'task-2348-implementer-attribution.test.ts',
  'task-2349-integrate-stage-commit-race.test.ts',
  'task-2350-reconcile-interrupted-handoff.test.ts',
  'task-2357-certification.test.ts',
  'task-2357.a-historical-intake.test.ts',
  'task-2357.b-canonical-repository-identity.test.ts',
  'task-2357.c-unknown-review-fix-rounds.test.ts',
  'task-2357.d-completion-population.test.ts',
  'task-2357.e-legacy-history-scope.test.ts',
  'task-2357.g-per-metric-evidence.test.ts',
  'task-2363-production-certification.test.ts',
  'task-2363-repository-identity.test.ts',
  'task-2363-review-fix-rounds.test.ts',
  'task-2363-windowed-cohorts.test.ts',
  'task-2367-certification.test.ts',
  'task-2367-regressions.test.ts',
  'task-2367-repair.test.ts',
  'task-2367-telemetry-schema.test.ts',
  'task-2369-regressions.test.ts',
  'task-2370-repro.test.ts',
  'task-2373-shutdown.test.ts',
  'task-2375-active-invocation-overlap.test.ts',
  'task-2375-current-work-operation-repro.test.ts',
  'task-2376-lifecycle-timing.test.ts',
  'task-2378-authoritative-stats.test.ts',
  'task-2379-approval-boundary-repro.test.ts',
  'task-2397-integrate-active-approved-recovery.test.ts',
  'task-2413-proof-reuse.test.ts',
  'task-2413-publication-seam.test.ts',
  'task-2413-repro.test.ts',
  'task-2420-integrate-recovery-assigned-reviewer.test.ts',
  'task-2424-repro.test.ts',
  'task-2433-web-mutation.integration.test.ts',
  'task-2438-worktree-board-repro.test.ts',
  'task-2440-repro.test.ts',
  'task-2441-mission-title-repro.test.ts',
  'task-2443-repro.test.ts',
  'task-2455-config-exit-status-repro.test.ts',
  'task-2466-cancel-surfaces.test.ts',
  'task-2466-mission-cancel.test.ts',
  'task-2468-adhoc-lifecycle-repro.test.ts',
  'task-2484-npm-metadata-urls-repro.test.ts',
  // TASK-2492: fixture-git coverage of the squash-landing detection seam runs a
  // real temporary Git repository, so it crosses the git boundary and runs only
  // in the integration layer.
  'task-2492-already-merged-detection.test.ts',
  // TASK-2502: CodeQL gate tests. --dry-run resolves the plan without spawning
  // the CLI, and the clean-cache test skips when no pinned codeql is on PATH, so
  // both run on a clean GitHub-hosted runner with only bash.
  'task-2502-codeql-clean-cache.test.ts',
  'task-2502-codeql-suite-flag.test.ts',
  // TASK-2507: runs failed-gate routing against a temporary Git repository to
  // prove the base worktree stays clean, so it crosses the git boundary.
  'task-2507-mainline-gate-mutation-repro.test.ts',
  'task-2509-local-version-allocation.test.ts',
  'task-2509-release-workflow.test.ts',
  // TASK-2516: landed-mission recovery crosses the git boundary with a real
  // temporary Git repository and worktrees, so it runs in the integration layer.
  'task-2516-recover-landed-mission-repro.test.ts',
  // TASK-2517 CP-3: seeds a temporary Git repository and a migrated SQLite
  // database to drive the stranded-landed-mission closeout, so it crosses the
  // git/SQLite process boundary and runs only in the integration layer.
  'task-2517-cp3-landed-closeout.test.ts',
  // TASK-2517 F1: drives the base-branch-scoped landed-payload detector against
  // a real temporary Git repository with a retained mission worktree, so it
  // crosses the git boundary and runs in the integration layer.
  'task-2517-landed-squash-base-branch-detection.test.ts',
  // TASK-2532: seeds temporary Git repositories to exercise the base-worktree
  // repair (marker-stash sweep + dead-rebase abort), so it crosses the git
  // boundary and runs only in the integration layer.
  'task-2532-stale-integration-state-repro.test.ts',
  // TASK-2527: verifies shared-token discovery using temporary Git worktrees.
  'task-2527-local-sonar.test.ts',
  // TASK-2533: stages a special-character (backslash) payload file in a
  // throwaway Git repo and drives `git commit --only` pathspecs, so it crosses
  // the git boundary and runs only in the integration layer.
  'task-2533-squash-payload-pathspec-quotes.test.ts',
  // TASK-2534: drives the real squash landing against a throwaway Git repo to
  // prove stale backlog/tasks copies never enter the landed payload, so it
  // crosses the git boundary and runs only in the integration layer.
  'task-2534-stale-backlog-copy-landing-repro.test.ts',
  // TASK-2537: drives the real squash landing against throwaway Git repos to
  // prove closeout pathspecs stay valid when the base branch never tracked the
  // task file, so it crosses the git boundary and runs only in the integration
  // layer.
  'task-2537-squash-closeout-unstaged-task-path.test.ts',
  'test-hygiene.test.ts',
  'tui-command-flow.test.ts',
  'tui-pty-smoke.test.ts',
  'tui-spawn.test.ts',
  'unit-test-timeout-guard.test.ts',
  'verification.test.ts',
  'verify-local-integrate.test.ts',
  'web-host.integration.test.ts',
  'web-package-smoke.integration.test.ts',
];

/**
 * Integration tests that keep their coverage but stay out of GitHub CI because
 * they need workstation tooling. These remain required by local verification.
 */
export const INTEGRATION_LOCAL_TESTS: readonly string[] = [
  'bubblewrap-worktree-git.test.ts',
  'task-2270-graphify-exclusion.test.ts',
  'task-2286-native-sea-smoke.test.ts',
];

/** Why each local-only entry cannot run on a clean GitHub-hosted runner. */
export const INTEGRATION_LOCAL_REASONS: Readonly<Record<string, string>> = {
  'bubblewrap-worktree-git.test.ts':
    'Spawns the real `bwrap` binary to certify sandbox profiles; bubblewrap is not part of the GitHub-hosted runner image.',
  'task-2270-graphify-exclusion.test.ts':
    'Spawns the uv-installed `graphify` CLI; neither uv nor graphify exists on a clean GitHub-hosted runner.',
  'task-2286-native-sea-smoke.test.ts':
    'Builds and runs the native single-executable artifact, which needs a Node >= MINIMUM_SEA_NODE_MAJOR SEA toolchain and per-OS packaging; the portable npm package and bundle checks cover packaging in the CI lane instead.',
};

/**
 * Real-agent / lifecycle suites. They are discovered by neither `npm test` nor
 * `npm run test:integration`; each has its own command and its own local gate.
 */
export const AGENT_E2E_TESTS: readonly string[] = [
  'e2e-mission-lifecycle.test.ts',
  'e2e-real-agent-smoke.test.ts',
];

/**
 * Markers of a prohibited GitHub-CI dependency. `test/test-categories.test.ts`
 * fails when a CI-lane file names one of these, so a boundary test cannot carry
 * local AI, Forgejo, or non-runner tooling into the GitHub-safe lane.
 */
export const PROHIBITED_CI_DEPENDENCY_MARKERS: ReadonlyArray<{ readonly pattern: RegExp; readonly reason: string }> = [
  { pattern: /\bspawnSync\(\s*'bwrap'/, reason: 'bubblewrap is not in the GitHub-hosted runner image' },
  { pattern: /\b(?:spawnSync|execFileSync|execSync|spawn)\(\s*'(?:uv|graphify)'/, reason: 'uv/graphify are operator-installed tools' },
  { pattern: /PARALLIX_SEA_NODE|scripts\/build-sea/, reason: 'the native SEA toolchain is not portable to a clean runner' },
];

/** Resolve the declared category of an integration-layer test file. */
export function integrationCategoryOf(file: string): 'integration-ci' | 'integration-local' | null {
  if (INTEGRATION_CI_TESTS.includes(file)) { return 'integration-ci'; }
  if (INTEGRATION_LOCAL_TESTS.includes(file)) { return 'integration-local'; }
  return null;
}
