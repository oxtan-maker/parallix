/**
 * test-categories.ts — the repository's verification-tier registry (TASK-2500.04).
 *
 * A suite's physical path declares its level (TASK-2638): `test/unit/`,
 * `test/integration/`, or `test/e2e/`. This module is the single authority for
 * WHERE a boundary suite may run. Entries are test-root-relative paths such as
 * `integration/sqlite/sqlite-mission-store.integration.test.ts`, never basenames.
 *
 * - `unit`             every suite below `test/unit/`: hermetic, in-process,
 *                      injected doubles only. Membership comes from the path and
 *                      is never registered here.
 * - `integration-ci`   crosses a real process, Git, SQLite, packaging, or loopback
 *                      socket boundary using only what a clean GitHub-hosted runner
 *                      provides. Membership is POSITIVE: a suite runs in this lane
 *                      only when it is listed in {@link INTEGRATION_CI_TESTS}.
 * - `integration-local` same boundaries, plus a workstation dependency a clean
 *                      runner does not have. Every entry records why in
 *                      {@link INTEGRATION_LOCAL_REASONS}.
 * - `agent-e2e`        dedicated lifecycle and real-agent workflows below
 *                      `test/e2e/`, invoked only by their own commands and gates.
 *
 * Integration and E2E suites may appear in exactly one list. A deterministic
 * E2E workflow can run in the integration-ci lane; an `e2e/` path alone never
 * makes a suite agent-dependent. test/lib/test-layout-validation.ts rejects an
 * unregistered, doubly registered, dangling, or reason-less entry, so the
 * GitHub-safe lane never grows by accident.
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
  'integration/agents/pi-worker-process-contract.test.ts',
  // Review contracts exercising SQLite backfill and durable CLI recovery.
  'integration/review/review-status-backfill.integration.test.ts',
  'integration/review/review-intervention-resume.integration.test.ts',
  'integration/cli/active.test.ts',
  'integration/agents/agents-limit-hit.test.ts',
  'integration/agents/agents.test.ts',
  'integration/composition/application-boundaries.test.ts',
  'integration/backlog/backlog.test.ts',
  'integration/sqlite/board-event-metrics-fixture.test.ts',
  'integration/sqlite/board-event-recorder.test.ts',
  'integration/sqlite/board-lane-events-migration.test.ts',
  'integration/test-harness/bootstrap-isolation.test.ts',
  // Opens a migrated SQLite operator database to verify cross-repository leases.
  'integration/agents/custom-capacity-cross-repo.integration.test.ts',
  'integration/agents/custom-capacity-multiprocess-repro.test.ts',
  'integration/verification/documentation-verification.test.ts',
  'integration/cli/draft-command-boundary-contract.test.ts',
  'integration/cli/draft.test.ts',
  'integration/sqlite/durable-state-policy.test.ts',
  'integration/sqlite/mission-sqlite-cutover.test.ts',
  'integration/cli/external-target-resolution.test.ts',
  // Spawns bootstrapped child workers that build Git and SQLite case fixtures,
  // then fails, signals, or kills them to prove the fixtures are reclaimed.
  'integration/test-harness/fixture-lifetime.integration.test.ts',
  // Drives the real runner against a stand-in checkout to prove focused nested
  // selection, failure propagation, and no-match rejection; node only.
  'integration/test-harness/runner-focused-selection.test.ts',
  'integration/forgejo/forgejo-independence.test.ts',
  // TASK-2622.17: commits a real temporary Git repository and runs the configured verification command.
  'integration/forgejo/forgejo-publication-gate-failure-contract.test.ts',
  'integration/forgejo/forgejo-pr-round-sync.test.ts',
  'integration/forgejo/forgejo.test.ts',
  'integration/mission/handoff.test.ts',
  'integration/packaging/install.test.ts',
  // TASK-2622.17: packs the real tarball and installs it into disposable npm prefixes.
  'integration/packaging/npm-pack-install-smoke.test.ts',
  'integration/integrate/integrate-conflict.test.ts',
  'integration/integrate/integrate.test.ts',
  'integration/verification/integration-pipelines.test.ts',
  'integration/mission/mission-cancel-contract.test.ts',
  'integration/mission/mission-handoff-reconcile-contract.test.ts',
  'integration/mission/mission-utils-worktree.test.ts',
  'integration/agents/mistral.test.ts',
  'integration/integrate/nels.test.ts',
  'integration/agents/opencode-export.test.ts',
  'integration/packaging/package-persistent-data.test.ts',
  'integration/config/product-config-cp.test.ts',
  'integration/config/product-config-validation.test.ts',
  'integration/config/product-config.test.ts',
  'integration/cli/px-runner.test.ts',
  'integration/cli/px-runtime-smoke.test.ts',
  'integration/cli/px-shell-init.test.ts',
  'integration/rebase/rebase-use-case.test.ts',
  'integration/rebase/rebase.test.ts',
  'integration/verification/repository-gates.integration.test.ts',
  // TASK-2573: exercises reusable gate proofs against a temporary Git checkout;
  // a clean hosted runner provides Git and the injected command runner.
  'integration/verification/repository-gates.test.ts',
  'integration/rebase/resolve-conflict.test.ts',
  // TASK-2704: real git in a temporary repository; git is present on clean hosted runners.
  'integration/review/review-evidence-git.integration.test.ts',
  'integration/review/review-artifacts.test.ts',
  'integration/review/review-autoderive.test.ts',
  'integration/review/review-backfill.test.ts',
  'integration/review/review-commands-additional.test.ts',
  'integration/review/review-commands-supplemental.test.ts',
  'integration/review/review-events.test.ts',
  'integration/review/review-identity.test.ts',
  'integration/review/review-prompts.test.ts',
  'integration/review/review-state-class.test.ts',
  'integration/review/review-state.test.ts',
  'integration/review/review.test.ts',
  'integration/agents/runtime-matrix.test.ts',
  'integration/agents/session-marker-repository.test.ts',
  'integration/forgejo/setup-review.test.ts',
  // TASK-2546: runs `git rev-parse` and `git ls-files` against the checkout to
  // prove the SonarQube Cloud branch identity and the absence of the retired
  // local path. A plain Git checkout is enough, so it is CI-safe.
  'integration/verification/sonarqube-cloud-wiring.test.ts',
  'integration/sqlite/sqlite-schema-and-migrations.integration.test.ts',
  'integration/sqlite/sqlite-operator-state.integration.test.ts',
  'integration/sqlite/sqlite-import-and-audit.integration.test.ts',
  'integration/sqlite/sqlite-mission-store.integration.test.ts',
  // TASK-2706: exercises the transactional legacy adhoc id rewrite over real
  // SQLite. Real SQLite is a clean-runner dependency, so CI-safe.
  'integration/sqlite/legacy-adhoc-migration.integration.test.ts',
  // TASK-2688: seeds a temporary migrated SQLite operator database with mixed
  // UTC/offset/ambiguous/malformed timestamps and exercises the audited
  // normalization write, idempotence, lexical==temporal ordering, and backup
  // restore. Real SQLite is a clean-runner dependency, so CI-safe.
  'integration/sqlite/mission-timestamp-migration.integration.test.ts',
  'integration/sqlite/operator-state-scope.integration.test.ts',
  'integration/sqlite/sqlite-repository-contract.integration.test.ts',
  'integration/sqlite/sqlite-recovery-cp5.test.ts',
  'integration/cli/startup-preflight.test.ts',
  'integration/stats/stats-backfill.test.ts',
  'integration/stats/stats.test.ts',
  'integration/stats/stats-bug-labeled-trend.test.ts',
  'integration/review/standalone-review-cycle.test.ts',
  'integration/stats/stats-current-week-completion.test.ts',
  'integration/agents/agent-exit-telemetry-classification.test.ts',
  'integration/review/review-state-durability.test.ts',
  'integration/test-harness/bootstrap-launcher-isolation.test.ts',
  'integration/review/review-validation-rebound.test.ts',
  'integration/test-harness/agent-smoke-capture-cleanup.test.ts',
  'integration/review/review-gate-ownership.test.ts',
  'integration/backlog/task-label-persistence.test.ts',
  'integration/presentation/board-terminal-resize-lifetime.test.ts',
  'integration/test-harness/bootstrap-process-cleanup.test.ts',
  'integration/sqlite/mission-sqlite-use-cases.test.ts',
  'integration/sqlite/operator-state-services.test.ts',
  'integration/review/review-state-restart-recovery.integration.test.ts',
  'integration/sqlite/persistence-cutover-boundaries.test.ts',
  // TASK-2343 composes concrete filesystem adapters over a temporary repository.
  'integration/presentation/presentation-board.integration.test.ts',
  'integration/stats/stats-custom-agent-model.test.ts',
  'integration/sqlite/mission-aggregate-write-isolation.test.ts',
  'integration/sqlite/mission-store-drain.test.ts',
  'integration/agents/agent-block-authority.test.ts',
  'integration/presentation/board-draft-composition.test.ts',
  // TASK-2706 criterion 2: isolated end-to-end proof of the web-create -> draft
  // path over real SQLite and a temporary Git repository. Both are clean-runner
  // dependencies, so the suite is CI-safe.
  'integration/presentation/web-create-draft-start-e2e.test.ts',
  'integration/stats/board-metrics-persistence.test.ts',
  'integration/stats/metrics-review-fix-observations.test.ts',
  'integration/presentation/flow-persisted-decision-window.test.ts',
  'integration/stats/measurement-review-fix-nullability.test.ts',
  'integration/lifecycle/lifecycle-completion-persistence.test.ts',
  'integration/lifecycle/lifecycle-telemetry-completion-authority.test.ts',
  'integration/lifecycle/lifecycle-historical-completion-repair.test.ts',
  'integration/sqlite/telemetry-completion-schema.test.ts',
  'integration/integrate/integration-landed-completion.test.ts',
  'integration/presentation/board-live-work-refresh.test.ts',
  'integration/presentation/board-shutdown-signals.test.ts',
  'integration/cli/active-invocation-contract.test.ts',
  'integration/sqlite/current-work-operation-identity.test.ts',
  'integration/lifecycle/lifecycle-approval-dwell.test.ts',
  'integration/verification/verification-proof-reuse.test.ts',
  'integration/verification/rebound-gate-recovery.test.ts',
  'integration/integrate/integration-provider-approval-recovery.test.ts',
  'integration/presentation/board-shell-subscription-lifetime.test.ts',
  'integration/presentation/presentation-web.integration.test.ts',
  'integration/presentation/board-worktree-mission-scope.test.ts',
  'integration/presentation/board-task-update-authority.test.ts',
  'integration/sandbox/agent-sandbox-state-bindings.test.ts',
  'integration/cli/config-exit-status.test.ts',
  // TASK-2489: the recovery supervisor and claim suites drive only injected doubles and temp
  // directories; the `git worktree` token in a failure message trips the
  // boundary heuristic, so classify it CI-safe (clean runner is enough).
  'integration/mission/recovery-supervisor.test.ts',
  'integration/mission/recovery-claim.test.ts',
  // TASK-2492: exercises the composed integration command and lifecycle flow
  // against an on-disk repository fixture. All external seams are injected, so
  // a clean GitHub-hosted runner can execute it safely.
  'integration/integrate/integration-gate-repair-routing.test.ts',
  // TASK-2601 uses temporary SQLite Mission and measurement stores only.
  'integration/sqlite/mission-classification-authority.test.ts',
  // TASK-2609: seeds a temporary SQLite operator database and drives the
  // production `px classification set` composition path to prove the command
  // discovers the version itself. Real SQLite is a clean-runner dependency, so
  // this CLI-composition test runs in the integration layer rather than the
  // CPU-budgeted unit tier.
  'integration/sqlite/mission-classification-update.test.ts',
  // TASK-2599 spawns the dev entry in a child process and materialises a
  // temporary SQLite Mission store, so it crosses the process and SQLite
  // boundaries and runs only in the integration layer (clean runner is enough).
  'integration/cli/cli-command-exit-and-output.test.ts',
  // TASK-2614 opens a migrated SQLite Mission store in a temporary directory;
  // clean GitHub-hosted runners provide every required dependency.
  'integration/review/review-native-mission-recovery.test.ts',
  // TASK-2502: CodeQL gate tests. --dry-run resolves the plan without spawning
  // the CLI, and the clean-cache test skips when no pinned codeql is on PATH, so
  // both run on a clean GitHub-hosted runner with only bash.
  'integration/verification/codeql-suite-options.test.ts',
  // TASK-2622.17: version allocation and NOTICES tracking run the real bump script and `git ls-files`
  // against temporary Git repositories; the workflow cases only read committed files.
  'integration/packaging/release-publication-and-version-allocation-contract.test.ts',
  // TASK-2585: injects GitHub Actions API responses to prove the durable
  // publication-proof reader; it makes no live provider call.
  'integration/verification/github-publication-proof.test.ts',
  'integration/verification/github-release-proof-reuse.test.ts',
  // TASK-2516: landed-mission recovery crosses the git boundary with a real
  // temporary Git repository and worktrees, so it runs in the integration layer.
  'integration/integrate/recover-landed-mission.test.ts',
  // TASK-2620: composes the production `px integrate` CLI against a temporary
  // Git repository and a migrated SQLite Mission store. A red integration gate
  // revokes the approval, the bounded implementer budget repairs once, the
  // repaired revision re-reviews through the single live `px review --continue`
  // route, and the mission stops in the integration lane. Only the agent
  // launcher, the Forgejo HTTP layer, and the gate runner are injected, so the
  // real Git and SQLite boundaries are clean-runner dependencies and the suite
  // is CI-safe. It is a full CLI composition (real git + SQLite), so it runs in
  // the integration layer rather than the CPU-budgeted unit tier.
  'integration/integrate/integration-repair-review-loop.test.ts',
  // TASK-2525.03: reads repository configuration and creates a temporary Git
  // repository to prove local branch discovery. A clean GitHub runner provides
  // every dependency, so it is CI-safe.
  'integration/verification/hosted-quality-gate-contract.test.ts',
  // TASK-2620: approval coverage of bookkeeping commits against a temporary
  // Git repository; git is on every GitHub runner, so CI-safe.
  'integration/integrate/approval-bookkeeping-coverage.test.ts',
  // TASK-2555: runs px rebase against a temporary Git repository and a migrated
  // SQLite Mission store; git and SQLite are on every GitHub runner, so CI-safe.
  'integration/rebase/rebase-approval-coverage.test.ts',
  // TASK-2582 / TASK-2322.05: real migrated SQLite lifecycle boundaries; CI-safe.
  'integration/sqlite/mission-use-case-persistence-contract.test.ts',
  'integration/integrate/workflow-repair-lane-boundaries.test.ts',
  // TASK-2514: real migrated SQLite lifecycle boundary for the human approve
  // after an active-state repair; CI-safe.
  'integration/review/review-active-repair-approval.test.ts',
  // TASK-2566: creates temporary Git repositories (mission/non-mission
  // branches) and injects a fetch spy for the Sonar API, so it crosses the
  // git/process boundary; every dependency is what a clean GitHub runner
  // provides, so it is CI-safe.
  'integration/verification/sonar-short-branch-confirmation.test.ts',
  // TASK-2580: drives the real `px active` command and a loopback web snapshot
  // to measure command-to-rendered-card delivery; both are CI-safe boundaries.
  // TASK-2521.03: seeds an isolated SQLite operator database and drives the
  // production `px status --json` composition path; the ad hoc lifecycle section
  // (TASK-2468) runs the real `px` entry against an isolated Parallix home.
  'integration/cli/mission-adhoc-and-context-cli-contract.test.ts',
  'integration/backlog/legacy-import-trace.integration.test.ts',
  'integration/backlog/legacy-persistence-audit.integration.test.ts',
  // Reads and commits artifacts in temporary Git repositories; standard Git is enough for CI.
  'integration/backlog/legacy-content-history.integration.test.ts',
  // TASK-2627 drives production squash landing through temporary Git repos;
  // standard Git is the only external dependency, so it is CI-safe.
  'integration/integrate/integration-squash-staged-payload.test.ts',
  // TASK-2613: lands two missions through the production integrate ports in a
  // throwaway Git repo to prove closeout archives the task file and re-arms the
  // stale-copy guards, so it crosses the git boundary and runs only in the
  // integration layer.
  'integration/integrate/integration-backlog-closeout.test.ts',
  // TASK-2551: one real subprocess (node --import tsx, missing SONAR_TOKEN) to
  // prove the delete-branch subcommand's exit-0 failure semantics; the rest is
  // request-injected, so it crosses only the process boundary.
  'integration/verification/sonar-branch-cleanup.test.ts',
  // TASK-2554: probes the real bootstrap chain in Node subprocesses with
  // temporary SQLite databases; no operator database or service is required.
  'integration/test-harness/operator-database-pollution-guard.test.ts',
  'integration/storage/storage-bootstrap-isolation.test.ts',
  // TASK-2577: checks fixture teardown in local Node subprocesses under
  // private temporary directories, using only clean-runner dependencies.
  'integration/test-harness/test-fixture-process-cleanup.test.ts',
  'integration/test-harness/test-hygiene.test.ts',
  'integration/presentation/presentation-tui.integration.test.ts',
  // Real filesystem and TypeScript emit contract; only npm dependencies required.
  'integration/verification/type-only-coverage.integration.test.ts',
  'integration/verification/verification.test.ts',
  // TASK-2622.13: canonical repository identity over the real sqlite operator
  // database via test/fixtures/statistics-database.ts. The fixture
  // hides the sqlite boundary from the content heuristic, so this integration-ci
  // test is declared here rather than silently inheriting unit membership.
  'integration/sqlite/canonical-repository-identity.test.ts',
  // TASK-2622.13: windowed default FLOW cohort over the real sqlite operator
  // database via test/fixtures/statistics-database.ts. The fixture
  // hides the sqlite boundary from the content heuristic, so this integration-ci
  // test is declared here rather than silently inheriting unit membership.
  'integration/stats/cohort-windowing.test.ts',
  // TASK-2622.13: deriveImplementerAndFixRounds, the production stats adapter
  // reaching the Review aggregate, and the closed rollup row as the grouping
  // authority. Real sqlite operator database behind clearOperatorStateCache and
  // throwaway git repos, so declared here rather than inheriting unit membership.
  'integration/stats/stats-internals.test.ts',
  // TASK-2622.13: the completed-mission population shared by the board and the
  // CLI mission-flow report. The sqlite boundary lives in the statistics
  // fixture, so this integration-ci test is declared here.
  'integration/stats/stats-population.test.ts',
  // TASK-2622.13: per-metric low-sample cohort judgement over the real sqlite
  // operator database and the production cohort report. The fixture hides the
  // sqlite boundary, so this integration-ci test is declared here.
  'integration/stats/stats-cohorts.test.ts',
  // TASK-2622.13: the lifecycle event stream leaves exactly one gap-free,
  // ordered lane event per transition. Real sqlite fixture plus throwaway git
  // repos, so declared here rather than inheriting unit membership.
  'integration/lifecycle/lifecycle-events.test.ts',
  // TASK-2622.13: gap-free ordered lane history and the repository-scoped
  // legacy lifecycle-entry fallback. The sqlite boundary lives in the
  // statistics fixture, so this integration-ci test is declared here.
  'integration/lifecycle/lifecycle-history.test.ts',
  // TASK-2622.09: Git integration, rebase, landing, and closeout safety suites
  // consolidated by behavior. Each case builds a disposable Git repository (or
  // runs a real child process) that a clean hosted runner provides.
  'integration/integrate/integrate-squash-payload-pathspec-contract.test.ts',
  'integration/integrate/integrate-squash-commit-and-landed-detection-contract.test.ts',
  'integration/integrate/integrate-variant-b-landing-contract.test.ts',
  'integration/integrate/integrate-lifecycle-recovery-and-closeout-contract.test.ts',
  'integration/integrate/integrate-stale-state-and-stash-safety-contract.test.ts',
  'integration/rebase/rebase-before-review-contract.test.ts',
  'integration/rebase/pre-review-launcher-configuration.test.ts',
  'integration/forgejo/forgejo-sync-merged-force-push-contract.test.ts',
  'integration/packaging/post-integrate-global-install-contract.test.ts',
  'integration/integrate/integrate-gate-and-exclusivity-process-contract.test.ts',
  // TASK-2625: exercises the sha-keyed integration-validation skip. The
  // real-SQLite round-trip test opens a migrated SQLite operator database in a
  // temporary directory and writes an operational_history row; git and SQLite
  // are clean-runner dependencies, no Forgejo or agent runner is contacted, so
  // it is CI-safe. It runs in the integration layer because it crosses the
  // real SQLite boundary rather than the CPU-budgeted unit tier.
  'integration/integrate/integration-gate-skip-contract.test.ts',
];

/**
 * Integration tests that keep their coverage but stay out of GitHub CI because
 * they need workstation tooling. These remain required by local verification.
 */
export const INTEGRATION_LOCAL_TESTS: readonly string[] = [
  'integration/presentation/web-board-pointer.test.ts',
  'integration/sandbox/bubblewrap-worktree-git.test.ts',
  'integration/sandbox/bubblewrap-symlink-mount.test.ts',
  'integration/agents/graphify-mission-document-exclusion.test.ts',
  'integration/packaging/native-sea-executable-smoke.test.ts',
  'integration/lifecycle/lifecycle-timing-local.test.ts',
  'integration/sandbox/codex-sandbox-mission-state-write.test.ts',
  'integration/sandbox/claude-credential-refresh-isolation.test.ts',
  'integration/sandbox/claude-sandbox-credential-persistence.test.ts',
  'integration/agents/codex-approval-policy-config.test.ts',
  'integration/test-harness/unit-test-timeout-guard.test.ts',
  'integration/process/tmux-terminal-host.test.ts',
];

/** Why each local-only entry cannot run on a clean GitHub-hosted runner. */
export const INTEGRATION_LOCAL_REASONS: Readonly<Record<string, string>> = {
  'integration/presentation/web-board-pointer.test.ts':
    'Real coordinate pointer coverage requires a provisioned Chromium executable (PARALLIX_CHROMIUM or /usr/bin/chromium), absent from the clean runner contract.',
  'integration/process/tmux-terminal-host.test.ts':
    'Spawns the real `tmux` binary (and `bwrap` for the socket-mask case) to certify the optional terminal host; neither is part of the GitHub-hosted runner image.',
  'integration/sandbox/bubblewrap-worktree-git.test.ts':
    'Spawns the real `bwrap` binary to certify sandbox profiles; bubblewrap is not part of the GitHub-hosted runner image.',
  'integration/sandbox/bubblewrap-symlink-mount.test.ts':
    'Spawns the real `bwrap` binary to certify symlinked destination mounts; bubblewrap is not part of the GitHub-hosted runner image.',
  'integration/agents/graphify-mission-document-exclusion.test.ts':
    'Spawns the uv-installed `graphify` CLI; neither uv nor graphify exists on a clean GitHub-hosted runner.',
  'integration/packaging/native-sea-executable-smoke.test.ts':
    'Builds and runs the native single-executable artifact, which needs a Node >= MINIMUM_SEA_NODE_MAJOR SEA toolchain and per-OS packaging; the portable npm package and bundle checks cover packaging in the CI lane instead.',
  'integration/lifecycle/lifecycle-timing-local.test.ts':
    'TASK-2622.13: consolidates task-2376 lifecycle-approval timing over a real migrated SQLite Mission store and the production review-persistence + MissionLifecycleService composition; the SQLite boundary is not visible to the content heuristic, so it stays in required local verification rather than the GitHub CI lane.',
  'integration/sandbox/codex-sandbox-mission-state-write.test.ts':
    'Spawns the real `bwrap` binary to run `px` inside the codex sandbox profile; bubblewrap is not part of the GitHub-hosted runner image.',
  'integration/sandbox/claude-credential-refresh-isolation.test.ts':
    'Spawns the real `bwrap` binary to run every Claude lifecycle sandbox profile against a stand-in CLI; bubblewrap is not part of the GitHub-hosted runner image.',
  'integration/sandbox/claude-sandbox-credential-persistence.test.ts':
    'Spawns the real `bwrap` binary to refresh Claude credentials inside the claude sandbox profile; bubblewrap is not part of the GitHub-hosted runner image.',
  'integration/agents/codex-approval-policy-config.test.ts':
    'Downloads and launches the pinned Codex v0.156.1 CLI to verify its real configuration parser; that versioned CLI and registry access are not clean-runner dependencies.',
  'integration/test-harness/unit-test-timeout-guard.test.ts':
    'Proves local CPU/timing guards through real runner fixtures; integration descendant accounting needs a C compiler and Node N-API headers. Hosted timing enforcement is disabled, so this proof remains required local verification.',
};

/**
 * Real-agent / lifecycle suites. They run in neither `npm test` nor
 * `npm run test:integration`; each has its own command and its own local gate.
 */
export const AGENT_E2E_TESTS: readonly string[] = [
  'e2e/lifecycle/mission-lifecycle.test.ts',
  // Live Jev backend and a disposable Docker Forgejo instance are required.
  'e2e/lifecycle/repeat-review-classification.test.ts',
  'e2e/agents/real-agent-smoke.test.ts',
  // TASK-2642 criterion 6: bounded real-agent evaluation that the agent actually
  // retrieves the hidden failure from durable recovery evidence and names the
  // repair target, reporting retrieval success, repair outcome and context cost.
  'e2e/agents/recovery-retrieval.test.ts',
  // TASK-2643 criterion 8: bounded real-agent evaluation that a fresh agent
  // retrieves an omitted earlier-run failure from the correct run through
  // px history, against a headless tail baseline.
  'e2e/agents/run-history-retrieval.test.ts',
];

/**
 * Markers of a prohibited GitHub-CI dependency. The test-categories suite
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
