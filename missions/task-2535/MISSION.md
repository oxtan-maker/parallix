# Mission: Restore the 90-line coverage gate by covering low-coverage modules (task-2535)

## Goal
Raise the aggregate line coverage reported by `npm run test:coverage -- --lcov`
(from `src/adapters/verification/coverage-gate.ts`, threshold `90`) from ~57%
back to **>= 90% across the whole `src/` denominator**, by adding focused unit
tests that exercise the uncovered branches of the lowest-coverage production
modules listed in the backlog task. The gate, its `threshold = 90` default, and
the `COVERAGE_INCLUDES`/`COVERAGE_EXCLUDES` lists stay byte-for-byte unchanged.

## Why Now
`npm run test:coverage -- --lcov` (the `quality-gate` pre-integration gate) now
exits 1 because aggregate line coverage fell to ~57%. This is a pure agent
regression, not a threshold change: `coverage-gate.ts` still defaults to
`threshold = 90` and git history confirms 90 was always the default. The
lowest-coverage production modules were never given focused tests and several
large modules slipped below where they once sat. Leaving the gate red blocks the
merge-gate plan; restoring coverage by testing the dead branches (not by
lowering the bar) is the only fix that resolves the regression instead of hiding
it.

The current test additions have restored the measured aggregate to 90.08%, but
the command still exits 1 before it can serve as TASK-2525.03's shared required
quality command: its direct Node invocation omits the test-runner support used
by `npm test` for module-mock tests. This mission may make the smallest
coverage-gate runner-alignment change needed to make that existing suite run
honestly. It must preserve the production denominator and the 90% threshold;
this is compatibility repair, not an exemption from the gate.

## Refinement Signals
- Predicted NEL bucket: Medium (81–235)
- Confidence: High
- Selection note: activate as-is
- Main drivers: failing quality gate blocks the pre-integration merge gate; the
  denominator lost coverage on pure, cheap-to-drive modules where added tests
  move the aggregate the most.

## Scope
- Add focused unit tests under `test/` that drive the uncovered branches of the
  modules the backlog ranks lowest-first:
  - `src/adapters/config/product-config.ts` — `resolveTaskProvider` /
    `isSupportedTaskProvider` (SUPPORTED_TASK_PROVIDERS rejection),
    `resolveIntegrationMode` / `parseIntegrationMode` happy + invalid paths,
    `validateWorkflowConfig` adapter-section branches not yet hit,
    `resolveGithubPublishConfig`, `resolvePromptOverride`,
    `resolveCanonicalRepositoryRoot`, `adapterChecklist`,
    `resolveReviewArtifactDir`, `isForgejoReviewEnabled`.
  - `src/adapters/config/repository-gates.ts` — `loadPhaseGates`,
    `loadRequirePreIntegration`, `loadRepositoryGates`, `normalizeGates`
    malformed-entry rejection, `validateRepositoryGates` unknown-key / type
    branches, `buildGateEnv` (BASH_ENV scrub, real-agent scrub+set),
    `runPhaseGates` dry-run, empty-phase no-op, and a failing-gate abort path
    via an injected `commandRunner`.
  - `src/adapters/git/git.ts` — `findIgnoredSourceFiles`, `getWorktreeStatus`,
    `getUncommittedCount`, `parseUnmergedFiles`, `detectRebaseState` (in-progress
    and clean states, injected `gitRunner`), `getLastCommit`, `getLastThreeCommits`.
  - `src/adapters/cli/commands/stats.ts` / `stats-backfill.ts` — the pure
    formatting/mapping helpers, mocking the data source rather than the DB.
  - `src/application/presentation/cli-format.ts` — `colorize`, `stripAnsi`,
    `visibleWidth`, `padVisibleEnd`, `status`, `agent`, `table`, `list`, and the
    `log` variants (no existing test file covers this module).
  - `src/adapters/review/review-loop.ts`, `src/adapters/github/github-pr.ts`,
    `src/adapters/verification/verification.ts` — targeted assertions for the
    branches the current suite does not reach (`observeGithubPr`,
    `isTransientVerificationFailure`, `detectAreasFromChangedFiles`,
    `resolveEffectiveArea`, `formatVerificationCommand`, `recordGateResult`,
    `renderReviewVerdict`, `reviewIndependence`).
- Prioritise the purest, highest-gap modules first (`product-config`,
  `repository-gates`, `git`, `cli-format`) so every added test moves the
  aggregate the most.
- Align the coverage gate's Node test invocation with the repository's normal
  test runner only as needed for module-mock compatibility (including the
  existing TypeScript/bootstrap setup). Keep one authoritative coverage command
  and prove it exits 0 with the same `src/**/*.ts` denominator. Do not suppress
  test failures or accept a coverage report from mocked production facades.

## Out of Scope
- Changing the `threshold` value or `COVERAGE_INCLUDES`/
  `COVERAGE_EXCLUDES` in `src/adapters/verification/coverage-gate.ts`.
- Editing any production source module to reduce its branch count or stub logic.
- Lowering the threshold, narrowing the include/exclude lists, or otherwise
  hiding the regression.
- Spawning real CLIs, real forgejo, real agents, or hitting the network/DB — all
  external boundaries are mocked or injected doubles.
- Adding `.only` or unannotated `.skip`; adding new dependencies.
- Running the full test suite beyond the single `./scripts/verify-local.sh all`
  gate during drafting.

## Success Criteria
> **Falsifiability rule (ADR 0039 Part 2):** Each criterion below is
> falsifiable and carries an attached metric or exact command.

- `npm run test:coverage -- --lcov` reports aggregate line coverage >= 90% across
  all production modules in the `src/` denominator and exits 0.
- The coverage invocation supports the repository's module-mock tests without
  turning production imports into facades for the reported coverage run; a
  focused `coverage-gate` test covers the invocation and the full command is
  the acceptance proof.
- `coverage/lcov.info` aggregate coverage is strictly greater than the pre-mission
  baseline captured at the mission's parent commit.
- The 90% threshold is unchanged: `grep -n "let threshold = 90" src/adapters/verification/coverage-gate.ts` still matches the literal `90`.
- `COVERAGE_INCLUDES`/`COVERAGE_EXCLUDES` are unchanged: the include list still
  contains exactly `'src/**/*.ts'` and the exclude list still contains
  `'test/**'`, `'prompts/**'`, `'config/*.json'`, `'.workflow/**'`, `'node_modules/**'`
  (verified by reading `src/adapters/verification/coverage-gate.ts`).
- `./scripts/verify-local.sh static-analysis` passes (ESLint + `tsc --checkJs` +
  test-hygiene).
- No new test file introduces `.only` or an unannotated `.skip`:
  `grep -rnE "\.only\(|^\s*\.skip\(" test/` returns no matches in newly added files.
- Every new test runs under the unit-test budget: `npm test -- --unit-test-headroom` passes.
- Aggregate coverage rises on the individually named highest-gap modules
  (`product-config`, `repository-gates`, `git`, `cli-format`) versus the baseline
  in `coverage/lcov.info`.

## Risks and Assumptions
- The full suite regularly exceeds 10 minutes under cold caches (see
  `coverage-gate.ts` `DEFAULT_TEST_TIMEOUT_MS`); each new test must stay under the
  500 ms unit budget so it does not inflate the unit lane.
- `product-config.ts` and `repository-gates.ts` call into each other and into
  `loadEffectiveConfig`, which reads real files; tests must pass an explicit
  `rootDir` fixture or inject doubles to avoid touching the repo's own
  `workflow.config.json`.
- `git.ts` and `verification.ts` call `spawnSync`/`git`; tests must inject a
  `gitRunner`/`gitFn` double rather than invoking real git.
- The aggregate is a denominator-wide metric: a single file can hit 100% while
  the aggregate stays below 90%. Coverage must be measured on the whole `src/`
  aggregate, not per-file.
- Assumption: the ~57% figure in the backlog is representative; the true baseline
  is whatever `coverage/lcov.info` reports at the parent commit and is captured
  before any test is added.

## Checkpoints
- CP 1: Capture the pre-mission baseline aggregate coverage from
  `coverage/lcov.info` at the parent commit and record the number.
- CP 2: Author focused tests for the purest, highest-gap modules first
  (`product-config`, `repository-gates`, `git`, `cli-format`), mocking every
  external boundary.
- CP 3: Author focused tests for the remaining mid-size modules
  (`stats`/`stats-backfill` formatting helpers, `cli-format`, `review-loop`,
  `github-pr`, `verification`).
- CP 4: Align the coverage invocation with the normal test-runner support where
  required, then run the coverage gate, confirm aggregate >= 90% and exit 0,
  and confirm `static-analysis` passes.

### Checkpoint Documentation Requirements
Every checkpoint document (CP-N.md) MUST include:
- A summary of work done
- A `## Goal Check` section
- A 3-column pipe-delimited markdown table with columns: Criterion | Evidence | Status
- At least one evidence row per criterion using durable, verifiable references. Parallix already accepts:
  1. **Recognized repo commands or paths** — e.g., `` `npm run test:coverage -- --lcov` ``, `` `./scripts/verify-local.sh static-analysis` ``, `` `node -e "..."` ``, `` `px ...` ``, `` `git ...` ``
  2. **Test names** — must match a test name in the repo, e.g. a `test('...', ...)`.
  3. **Test file paths** — must be an existing test file, e.g. `test/product-config.test.ts`, `test/repository-gates.test.ts`, `test/git.test.ts`.
  4. **ADR references** — e.g., `ADR 0039` (must correspond to an existing file under `docs/adr/`).
  5. **File:line references** — accepted when needed, but line numbers eventually rot; prefer the forms above.
- Raw `stat`/`ls` output or generic prose may appear as supplemental context, but pair them with one of the accepted references above. This is the weak-agent failure mode: a wall of `stat`/`ls` output or a sentence like "coverage is now above 90%" is **not** evidence on its own. Pair any shell output with one accepted reference — e.g. report the aggregate percentage from `` `npm run test:coverage -- --lcov` `` and cite `coverage/lcov.info`.
- A non-generic `Next action:` line at the bottom

Example Goal Check table:

| Criterion | Evidence | Status |
|---|---|---|
| Draft prompt defines checkpoint evidence rules | `prompts/draft.md` | PASS |
| Repair loop has targeted incomplete-evidence coverage | `test/repair-handoff.test.ts`, `"buildRelaunchPrompt returns string containing Goal Check table and mission slug"` | PASS |
| Verification gate ran | `./scripts/verify-local.sh all` | PASS |

## Gates
- [ ] ./scripts/verify-local.sh all

## Restricted Areas
- `src/adapters/verification/coverage-gate.ts` — only the Node test-runner
  invocation may change for module-mock compatibility. Do not modify the
  `threshold` default or `COVERAGE_INCLUDES`/`COVERAGE_EXCLUDES`; do not mask
  failed tests, alter the denominator, or add a second coverage path.
- Production source under `src/` — do not edit to reduce branch count or stub
  logic; only `test/` files and the permitted coverage-gate invocation may
  change.
- The `origin` remote and the `main` branch must never receive mission work;
  mission branches are local-only and reviewed via the `review` (Forgejo) remote.
- The backlog task file — do not delete, rename, or move it; only update content
  and labels. Do not edit the `assignee` field.

## Stop Rules
- Stop editing before running anything other than the single
  `./scripts/verify-local.sh all` verification gate.
- Stop if runner alignment cannot make the command exit 0 while preserving the
  >=90% `src` denominator. Lowering the threshold, narrowing include/exclude
  lists, suppressing failures, or reporting mocked-facade coverage is a blocker
  to report, not a fix to apply.
- Stop if a target module is not pure/cheap to drive and would require spawning a
  real CLI, forgejo, agent, or DB — report it and move to the next module.
- Stop after the draft passes `./scripts/verify-local.sh all`; do not transition
  the task to `ready` — the harness does that after a clean draft.
