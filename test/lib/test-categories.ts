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
  // Review contracts exercising SQLite backfill and durable CLI recovery.
  'review-status-backfill.integration.test.ts',
  'review-intervention-resume.integration.test.ts',
  'active.test.ts',
  'agents-limit-hit.test.ts',
  'agents.test.ts',
  'application-boundaries.test.ts',
  'backlog.test.ts',
  'board-event-metrics-fixture.test.ts',
  'board-event-recorder.test.ts',
  'board-lane-events-migration.test.ts',
  'bootstrap-isolation.test.ts',
  // Opens a migrated SQLite operator database to verify cross-repository leases.
  'custom-capacity-cross-repo.integration.test.ts',
  'custom-capacity-multiprocess-repro.test.ts',
  'documentation-verification.test.ts',
  'draft-command-boundary-contract.test.ts',
  'draft.test.ts',
  'durable-state-policy.test.ts',
  'e2e-mission-sqlite-cutover.test.ts',
  'external-target-resolution.test.ts',
  // Spawns bootstrapped child workers that build Git and SQLite case fixtures,
  // then fails, signals, or kills them to prove the fixtures are reclaimed.
  'fixture-lifetime.integration.test.ts',
  'forgejo-independence.test.ts',
  // TASK-2622.17: commits a real temporary Git repository and runs the configured verification command.
  'forgejo-publication-gate-failure-contract.test.ts',
  'forgejo-pr-round-sync.test.ts',
  'forgejo.test.ts',
  'handoff.test.ts',
  'install.test.ts',
  // TASK-2622.17: packs the real tarball and installs it into disposable npm prefixes.
  'npm-pack-install-smoke.test.ts',
  'integrate-conflict.test.ts',
  'integrate.test.ts',
  'integration-pipelines.test.ts',
  'mission-cancel-contract.test.ts',
  'mission-handoff-reconcile-contract.test.ts',
  'mission-utils-worktree.test.ts',
  'mistral.test.ts',
  'nels.test.ts',
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
  'repository-gates.integration.test.ts',
  // TASK-2573: exercises reusable gate proofs against a temporary Git checkout;
  // a clean hosted runner provides Git and the injected command runner.
  'repository-gates.test.ts',
  'resolve-conflict.test.ts',
  'review-artifacts.test.ts',
  'review-autoderive.test.ts',
  'review-backfill.test.ts',
  'review-commands-additional.test.ts',
  'review-commands-supplemental.test.ts',
  'review-events.test.ts',
  'review-identity.test.ts',
  'review-prompts.test.ts',
  'review-state-class.test.ts',
  'review-state.test.ts',
  'review.test.ts',
  'runtime-matrix.test.ts',
  'session-marker-repository.test.ts',
  'setup-review.test.ts',
  // TASK-2546: runs `git rev-parse` and `git ls-files` against the checkout to
  // prove the SonarQube Cloud branch identity and the absence of the retired
  // local path. A plain Git checkout is enough, so it is CI-safe.
  'sonarqube-cloud-wiring.test.ts',
  'sqlite-schema-and-migrations.integration.test.ts',
  'sqlite-operator-state.integration.test.ts',
  'sqlite-import-and-audit.integration.test.ts',
  'sqlite-mission-store.integration.test.ts',
  'operator-state-scope.integration.test.ts',
  'sqlite-repository-contract.integration.test.ts',
  'sqlite-recovery-cp5.test.ts',
  'startup-preflight.test.ts',
  'stats-backfill.test.ts',
  'stats.test.ts',
  'review-loop-resolution-fallback.test.ts',
  'standalone-review-cycle.test.ts',
  'stats-current-week-completion.test.ts',
  'agent-exit-telemetry-classification.test.ts',
  'review-state-durability.test.ts',
  // TASK-2239 drives the review-loop lifecycle over a filesystem fixture.
  'review-response-relaunch.test.ts',
  'bootstrap-launcher-isolation.test.ts',
  'review-validation-rebound.test.ts',
  'agent-smoke-capture-cleanup.test.ts',
  'review-gate-ownership.test.ts',
  'task-label-persistence.test.ts',
  'board-terminal-resize-lifetime.test.ts',
  'bootstrap-process-cleanup.test.ts',
  'mission-sqlite-use-cases.test.ts',
  'operator-state-services.test.ts',
  'review-state-restart-recovery.integration.test.ts',
  'persistence-cutover-boundaries.test.ts',
  // TASK-2343 composes concrete filesystem adapters over a temporary repository.
  'presentation-board.integration.test.ts',
  'stats-custom-agent-model.test.ts',
  'mission-aggregate-write-isolation.test.ts',
  'mission-store-drain.test.ts',
  'agent-block-authority.test.ts',
  'board-draft-composition.test.ts',
  'board-metrics-persistence.test.ts',
  'metrics-review-fix-observations.test.ts',
  'flow-persisted-decision-window.test.ts',
  'measurement-review-fix-nullability.test.ts',
  'lifecycle-completion-persistence.test.ts',
  'lifecycle-telemetry-completion-authority.test.ts',
  'lifecycle-historical-completion-repair.test.ts',
  'telemetry-completion-schema.test.ts',
  'integration-landed-completion.test.ts',
  'board-live-work-refresh.test.ts',
  'board-shutdown-signals.test.ts',
  'active-invocation-contract.test.ts',
  'current-work-operation-identity.test.ts',
  'lifecycle-approval-dwell.test.ts',
  'verification-proof-reuse.test.ts',
  'rebound-gate-recovery.test.ts',
  'integration-provider-approval-recovery.test.ts',
  'board-shell-subscription-lifetime.test.ts',
  'presentation-web.integration.test.ts',
  'board-worktree-mission-scope.test.ts',
  'board-task-update-authority.test.ts',
  'agent-sandbox-state-bindings.test.ts',
  'config-exit-status.test.ts',
  // TASK-2489: the recovery supervisor and claim suites drive only injected doubles and temp
  // directories; the `git worktree` token in a failure message trips the
  // boundary heuristic, so classify it CI-safe (clean runner is enough).
  'recovery-supervisor.test.ts',
  'recovery-claim.test.ts',
  // TASK-2492: exercises the composed integration command and lifecycle flow
  // against an on-disk repository fixture. All external seams are injected, so
  // a clean GitHub-hosted runner can execute it safely.
  'integration-gate-repair-routing.test.ts',
  // TASK-2601 uses temporary SQLite Mission and measurement stores only.
  'mission-classification-authority.test.ts',
  // TASK-2609: seeds a temporary SQLite operator database and drives the
  // production `px classification set` composition path to prove the command
  // discovers the version itself. Real SQLite is a clean-runner dependency, so
  // this CLI-composition test runs in the integration layer rather than the
  // CPU-budgeted unit tier.
  'mission-classification-update.test.ts',
  // TASK-2599 spawns the dev entry in a child process and materialises a
  // temporary SQLite Mission store, so it crosses the process and SQLite
  // boundaries and runs only in the integration layer (clean runner is enough).
  'cli-command-exit-and-output.test.ts',
  // TASK-2614 opens a migrated SQLite Mission store in a temporary directory;
  // clean GitHub-hosted runners provide every required dependency.
  'review-native-mission-recovery.test.ts',
  // TASK-2502: CodeQL gate tests. --dry-run resolves the plan without spawning
  // the CLI, and the clean-cache test skips when no pinned codeql is on PATH, so
  // both run on a clean GitHub-hosted runner with only bash.
  'codeql-suite-options.test.ts',
  // TASK-2622.17: version allocation and NOTICES tracking run the real bump script and `git ls-files`
  // against temporary Git repositories; the workflow cases only read committed files.
  'release-publication-and-version-allocation-contract.test.ts',
  // TASK-2585: injects GitHub Actions API responses to prove the durable
  // publication-proof reader; it makes no live provider call.
  'github-publication-proof.test.ts',
  'github-release-proof-reuse.test.ts',
  // TASK-2516: landed-mission recovery crosses the git boundary with a real
  // temporary Git repository and worktrees, so it runs in the integration layer.
  'recover-landed-mission.test.ts',
  // TASK-2620: composes the production `px integrate` CLI against a temporary
  // Git repository and a migrated SQLite Mission store. A red integration gate
  // revokes the approval, the bounded implementer budget repairs once, the
  // repaired revision re-reviews through the single live `px review --continue`
  // route, and the mission stops in the integration lane. Only the agent
  // launcher, the Forgejo HTTP layer, and the gate runner are injected, so the
  // real Git and SQLite boundaries are clean-runner dependencies and the suite
  // is CI-safe. It is a full CLI composition (real git + SQLite), so it runs in
  // the integration layer rather than the CPU-budgeted unit tier.
  'integration-repair-review-loop.test.ts',
  // TASK-2525.03: reads repository configuration and creates a temporary Git
  // repository to prove local branch discovery. A clean GitHub runner provides
  // every dependency, so it is CI-safe.
  'hosted-quality-gate-contract.test.ts',
  // TASK-2620: approval coverage of bookkeeping commits against a temporary
  // Git repository; git is on every GitHub runner, so CI-safe.
  'approval-bookkeeping-coverage.test.ts',
  // TASK-2555: runs px rebase against a temporary Git repository and a migrated
  // SQLite Mission store; git and SQLite are on every GitHub runner, so CI-safe.
  'rebase-approval-coverage.test.ts',
  // TASK-2582 / TASK-2322.05: real migrated SQLite lifecycle boundaries; CI-safe.
  'mission-use-case-persistence-contract.test.ts',
  'workflow-repair-lane-boundaries.test.ts',
  // TASK-2514: real migrated SQLite lifecycle boundary for the human approve
  // after an active-state repair; CI-safe.
  'review-active-repair-approval.test.ts',
  // TASK-2566: creates temporary Git repositories (mission/non-mission
  // branches) and injects a fetch spy for the Sonar API, so it crosses the
  // git/process boundary; every dependency is what a clean GitHub runner
  // provides, so it is CI-safe.
  'sonar-short-branch-confirmation.test.ts',
  // TASK-2580: drives the real `px active` command and a loopback web snapshot
  // to measure command-to-rendered-card delivery; both are CI-safe boundaries.
  // TASK-2521.03: seeds an isolated SQLite operator database and drives the
  // production `px status --json` composition path; the ad hoc lifecycle section
  // (TASK-2468) runs the real `px` entry against an isolated Parallix home.
  'mission-adhoc-and-context-cli-contract.test.ts',
  'legacy-import-trace.integration.test.ts',
  'legacy-persistence-audit.integration.test.ts',
  // Reads and commits artifacts in temporary Git repositories; standard Git is enough for CI.
  'legacy-content-history.integration.test.ts',
  // TASK-2627 drives production squash landing through temporary Git repos;
  // standard Git is the only external dependency, so it is CI-safe.
  'integration-squash-staged-payload.test.ts',
  // TASK-2613: lands two missions through the production integrate ports in a
  // throwaway Git repo to prove closeout archives the task file and re-arms the
  // stale-copy guards, so it crosses the git boundary and runs only in the
  // integration layer.
  'integration-backlog-closeout.test.ts',
  // TASK-2551: one real subprocess (node --import tsx, missing SONAR_TOKEN) to
  // prove the delete-branch subcommand's exit-0 failure semantics; the rest is
  // request-injected, so it crosses only the process boundary.
  'sonar-branch-cleanup.test.ts',
  // TASK-2554: probes the real bootstrap chain in Node subprocesses with
  // temporary SQLite databases; no operator database or service is required.
  'operator-database-pollution-guard.test.ts',
  'storage-bootstrap-isolation.test.ts',
  // TASK-2577: checks fixture teardown in local Node subprocesses under
  // private temporary directories, using only clean-runner dependencies.
  'test-fixture-process-cleanup.test.ts',
  'test-hygiene.test.ts',
  'presentation-tui.integration.test.ts',
  // Real filesystem and TypeScript emit contract; only npm dependencies required.
  'type-only-coverage.integration.test.ts',
  'verification.test.ts',
  // TASK-2622.13: canonical repository identity over the real sqlite operator
  // database via test/fixtures/statistics-database.ts. The fixture
  // hides the sqlite boundary from the content heuristic, so this integration-ci
  // test is declared here rather than silently inheriting unit membership.
  'canonical-repository-identity.test.ts',
  // TASK-2622.13: windowed default FLOW cohort over the real sqlite operator
  // database via test/fixtures/statistics-database.ts. The fixture
  // hides the sqlite boundary from the content heuristic, so this integration-ci
  // test is declared here rather than silently inheriting unit membership.
  'cohort-windowing.test.ts',
  // TASK-2622.13: deriveImplementerAndFixRounds, the production stats adapter
  // reaching the Review aggregate, and the closed rollup row as the grouping
  // authority. Real sqlite operator database behind clearOperatorStateCache and
  // throwaway git repos, so declared here rather than inheriting unit membership.
  'stats-internals.test.ts',
  // TASK-2622.13: the completed-mission population shared by the board and the
  // CLI mission-flow report. The sqlite boundary lives in the statistics
  // fixture, so this integration-ci test is declared here.
  'stats-population.test.ts',
  // TASK-2622.13: per-metric low-sample cohort judgement over the real sqlite
  // operator database and the production cohort report. The fixture hides the
  // sqlite boundary, so this integration-ci test is declared here.
  'stats-cohorts.test.ts',
  // TASK-2622.13: the lifecycle event stream leaves exactly one gap-free,
  // ordered lane event per transition. Real sqlite fixture plus throwaway git
  // repos, so declared here rather than inheriting unit membership.
  'lifecycle-events.test.ts',
  // TASK-2622.13: gap-free ordered lane history and the repository-scoped
  // legacy lifecycle-entry fallback. The sqlite boundary lives in the
  // statistics fixture, so this integration-ci test is declared here.
  'lifecycle-history.test.ts',
  // TASK-2622.09: Git integration, rebase, landing, and closeout safety suites
  // consolidated by behavior. Each case builds a disposable Git repository (or
  // runs a real child process) that a clean hosted runner provides.
  'integrate-squash-payload-pathspec-contract.test.ts',
  'integrate-squash-commit-and-landed-detection-contract.test.ts',
  'integrate-variant-b-landing-contract.test.ts',
  'integrate-lifecycle-recovery-and-closeout-contract.test.ts',
  'integrate-stale-state-and-stash-safety-contract.test.ts',
  'rebase-before-review-contract.test.ts',
  'forgejo-sync-merged-force-push-contract.test.ts',
  'post-integrate-global-install-contract.test.ts',
  'integrate-gate-and-exclusivity-process-contract.test.ts',
  // TASK-2625: exercises the sha-keyed integration-validation skip. The
  // real-SQLite round-trip test opens a migrated SQLite operator database in a
  // temporary directory and writes an operational_history row; git and SQLite
  // are clean-runner dependencies, no Forgejo or agent runner is contacted, so
  // it is CI-safe. It runs in the integration layer because it crosses the
  // real SQLite boundary rather than the CPU-budgeted unit tier.
  'integration-gate-skip-contract.test.ts',
];

/**
 * Integration tests that keep their coverage but stay out of GitHub CI because
 * they need workstation tooling. These remain required by local verification.
 */
export const INTEGRATION_LOCAL_TESTS: readonly string[] = [
  'bubblewrap-worktree-git.test.ts',
  'graphify-mission-document-exclusion.test.ts',
  'native-sea-executable-smoke.test.ts',
  'lifecycle-timing-local.test.ts',
  'codex-sandbox-mission-state-write.test.ts',
  'claude-credential-refresh-isolation.test.ts',
  'claude-sandbox-credential-persistence.test.ts',
  'codex-approval-policy-config.test.ts',
  'unit-test-timeout-guard.test.ts',
];

/** Why each local-only entry cannot run on a clean GitHub-hosted runner. */
export const INTEGRATION_LOCAL_REASONS: Readonly<Record<string, string>> = {
  'bubblewrap-worktree-git.test.ts':
    'Spawns the real `bwrap` binary to certify sandbox profiles; bubblewrap is not part of the GitHub-hosted runner image.',
  'graphify-mission-document-exclusion.test.ts':
    'Spawns the uv-installed `graphify` CLI; neither uv nor graphify exists on a clean GitHub-hosted runner.',
  'native-sea-executable-smoke.test.ts':
    'Builds and runs the native single-executable artifact, which needs a Node >= MINIMUM_SEA_NODE_MAJOR SEA toolchain and per-OS packaging; the portable npm package and bundle checks cover packaging in the CI lane instead.',
  'lifecycle-timing-local.test.ts':
    'TASK-2622.13: consolidates task-2376 lifecycle-approval timing over a real migrated SQLite Mission store and the production review-persistence + MissionLifecycleService composition; the SQLite boundary is not visible to the content heuristic, so it stays in required local verification rather than the GitHub CI lane.',
  'codex-sandbox-mission-state-write.test.ts':
    'Spawns the real `bwrap` binary to run `px` inside the codex sandbox profile; bubblewrap is not part of the GitHub-hosted runner image.',
  'claude-credential-refresh-isolation.test.ts':
    'Spawns the real `bwrap` binary to run every Claude lifecycle sandbox profile against a stand-in CLI; bubblewrap is not part of the GitHub-hosted runner image.',
  'claude-sandbox-credential-persistence.test.ts':
    'Spawns the real `bwrap` binary to refresh Claude credentials inside the claude sandbox profile; bubblewrap is not part of the GitHub-hosted runner image.',
  'codex-approval-policy-config.test.ts':
    'Downloads and launches the pinned Codex v0.156.1 CLI to verify its real configuration parser; that versioned CLI and registry access are not clean-runner dependencies.',
  'unit-test-timeout-guard.test.ts':
    'Proves local CPU/timing guards through real runner fixtures; integration descendant accounting needs a C compiler and Node N-API headers. Hosted timing enforcement is disabled, so this proof remains required local verification.',
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
