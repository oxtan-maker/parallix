# Mission: disable unit test timecheck on github (only) (task-2531)

## Goal
Disable the unit-test timing budget enforcement when the test suite runs inside
GitHub Actions, so slow GitHub-hosted runners no longer fail `npm test` on a
timing gate the operator cannot control. The local fast-dev timecheck stays
fully intact.

## Why Now
`npm run test:ci` runs `npm test` (`FORCE_COLOR=0 tsx test/run-default-tests.ts`),
which enforces a unit-test timing budget. On a developer workstation that budget
keeps the local suite fast. On GitHub-hosted runners the same budget fails the
pipeline because runner speed is uncontrollable — the CI run
`ci-required` reported `npm run test:ci` failing after ~1m35s with the suite
timing gate the unit-suite runner applies. There is no lever to make GitHub
runners meet a 180 s suite / 1000 ms per-test budget, so the check must be
disabled there while keeping it on for local development.

## Refinement Signals
- Predicted NEL bucket: Small (0–80)
- Confidence: High
- Selection note: activate as-is
- Main drivers: CI pipeline flakiness/failure on GitHub-hosted runners; uncontrollable runner speed; local fast-dev timecheck must be preserved.

## Scope
- Detect the GitHub Actions environment in the unit-suite timing mechanism and
  disable the timing budget there only.
- The two enforcement points are:
  1. `test/lib/unit-test-budget-reporter.ts` — the reporter that emits
     `[unit-test-budget:exceeded]` for any unit test over `UNIT_TEST_BUDGET_MS`
     (1000 ms) and `[unit-test-budget:headroom]` for tests over
     `UNIT_TEST_HEADROOM_MS` (500 ms) in headroom mode.
  2. `test/run-default-tests.ts` — the suite-level budget check that fails the
     unit suite when `suiteElapsedMs > UNIT_TEST_BUDGET_MS` (180 s default via
     `plan.unitTestBudgetMs` / `PARALLIX_UNIT_TEST_BUDGET_MS`).
- Add a unit test asserting the GitHub detection disables the timecheck and that
  local (non-GitHub) behavior is unchanged.
- Keep the detection as a single, shared definition of "on GitHub Actions" so
  both enforcement points read the same source of truth.

## Out of Scope
- Any change to the integration suite timing (`--integration`, `--integration-ci`,
  `--integration-local`), which is already exempt from these budgets.
- Changing the per-test timeout or suite budget values for local development.
- The `--unit-test-headroom` opt-in behavior on a local machine.
- Any production source under `src/`, the canonical bundle, the web build, or
  packaging.
- Adding new CI workflow files or modifying `.github/workflows/`.
- Reworking the test-category registry (`test/lib/test-categories.ts`).

## Success Criteria
> **Falsifiability rule (ADR 0039 Part 2):** Each criterion is falsifiable and
> carries an attached metric or a named surviving element. No subjective
> adjectives without a metric.

1. When `GITHUB_ACTIONS === 'true'`, `unitTestBudgetReporter()` emits neither
   `[unit-test-budget:exceeded]` nor `[unit-test-budget:headroom]`, regardless of
   any test's `durationMs`.
2. When `GITHUB_ACTIONS === 'true'`, `run-default-tests.ts` sets
   `suiteExceeded = false` and never fails the unit suite on the suite-level
   budget (`[unit-test-budget] SUITE BUDGET EXCEEDED` is never printed).
3. When `GITHUB_ACTIONS` is unset or not `'true'`, behavior is unchanged: a unit
   test over `UNIT_TEST_BUDGET_MS` (1000 ms) still yields
   `[unit-test-budget:exceeded]` and the suite over `UNIT_TEST_BUDGET_MS`
   (180 s) still fails.
4. The GitHub detection is defined once and imported by both
   `test/lib/unit-test-budget-reporter.ts` and `test/run-default-tests.ts`.
5. A unit test in `test/` asserts criteria 1–3 (GitHub disables the check; local
   still enforces it).

## Risks and Assumptions
- Assumption: GitHub Actions sets `GITHUB_ACTIONS=true` for all workflow jobs;
  detection keys on `process.env.GITHUB_ACTIONS === 'true'`.
- Risk: over-broad detection (e.g. any env containing "github") could disable the
  check for operators running locally under a similar var. Scope detection to the
  exact `=== 'true'` value.
- Risk: disabling the check must not silently disable it for the integration
  suite or for local runs. Each enforcement point is gated independently.
- Assumption: this does not change the `--unit-test-headroom` opt-in contract on
  local machines (headroom is still enforced off GitHub).

## Checkpoints
- CP 1: Locate and confirm both enforcement points; define the single shared
  "on GitHub Actions" detection; add a unit test that currently fails (GitHub
  detection absent → check still fires under `GITHUB_ACTIONS=true`).
- CP 2: Implement the detection wiring in both `test/lib/unit-test-budget-reporter.ts`
  and `test/run-default-tests.ts`; confirm the failing test turns green and
  local-enforcement tests stay green.

### Checkpoint Documentation Requirements
Every checkpoint document (CP-N.md) MUST include:
- A summary of work done
- A `## Goal Check` section
- A 3-column pipe-delimited markdown table with columns: Criterion | Evidence | Status
- At least one evidence row per criterion using durable, verifiable references. Parallix already accepts:
  1. **Recognized repo commands or paths** — e.g., `` `npm test -- test/unit-test-budget-reporter.test.ts` ``, `` `./scripts/verify-local.sh all` ``, `` `node --import tsx test/...` ``
  2. **Test names** — must match a test name in the repo (see the reporter/runner test files)
  3. **Test file paths** — must be an existing test file under `test/`
  4. **ADR references** — e.g., `ADR 0057` (must correspond to an existing file under `docs/adr/`)
  5. **File:line references** — accepted when needed, but line numbers eventually rot; prefer the forms above
- Raw `stat`/`ls` output or generic prose may appear as supplemental context, but pair them with one of the accepted references above. Example weak evidence: a bare `` `ls test/lib` `` listing or "the reporter no longer fires" with no command, test name, file path, or ADR. That is not enough — pair it with `` `npm test -- test/unit-test-timeout-guard.test.ts` `` or a matching test name.
- A non-generic `Next action:` line at the bottom

Example Goal Check table:

| Criterion | Evidence | Status |
|---|---|---|
| Draft prompt defines checkpoint evidence rules | `prompts/draft.md` | PASS |
| GitHub detection disables the reporter timecheck | `test/unit-test-budget-reporter.test.ts`, `` `npm test -- test/unit-test-budget-reporter.test.ts` `` | PASS |
| Local enforcement still fires off GitHub | `test/unit-test-timeout-guard.test.ts`, `ADR 0057` | PASS |
| Verification gate ran | `./scripts/verify-local.sh all` | PASS |

## Gates
- [ ] `./scripts/verify-local.sh all`

## Restricted Areas
- `src/` production source, `scripts/build-canonical-bundle.ts`, `web/`, and
  packaging — do not touch.
- `.github/workflows/` — do not add or modify.
- `test/lib/test-categories.ts` — do not rework.
- The `assignee` field of the backlog task — the workflow records ownership.

## Stop Rules
- Stop after the mission contract is filled and `./scripts/verify-local.sh all`
  passes on the draft.
- Do not implement the fix; do not run the test suites beyond the single
  `./scripts/verify-local.sh all` gate; do not start a review, execute, or
  integrate phase.
- Do not push the mission branch to `origin`; only `main` may be pushed there.
