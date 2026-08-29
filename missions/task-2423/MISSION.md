# Mission: Stabilize the one-second unit-test budget under parallel load (task-2423)

Reproduction-Test: test/task-2423-repro.test.ts

## Goal
Restore timing headroom in the default (non-`--integration`) unit suite so the
existing 1,000 ms per-test hard cap in `test/lib/unit-test-budget-reporter.ts`
stops firing on unrelated missions when several mission worktrees verify at the
same time.

Concretely: every test file in the default suite selected by
`buildTestRunPlan()` (`test/lib/test-run-plan.ts`) must complete each of its
tests in <= 500 ms when that suite runs alone on the machine, and the repo must
own a gate that measures and enforces that 500 ms headroom on an isolated run.
Tests that cannot meet 500 ms because they cross a real process, Git, SQLite,
or network boundary are made hermetic, or moved into
`knownIntegrationTestFiles` with a per-file justification comment — they are not
exempted in place.

`UNIT_TEST_BUDGET_MS` stays at 1,000 ms and remains a hard failure. No retry,
allowlist, per-mission bypass, or suppression of `[unit-test-budget:exceeded]`
is introduced.

## Why Now
On 2026-08-27 the default verifier failed on `main` and on an unrelated
TASK-2414 worktree at the same time, with adapter, review, setup, and rebound
tests reported above 1,000 ms. Those tests are not slow because of the mission
under verification; they are slow because four mission agents were running
`./scripts/verify-local.sh all` concurrently on one machine, each with
`--test-concurrency=4` (`test/lib/test-run-plan.ts`,
`UNIT_TEST_CONCURRENCY`).

`src/adapters/verification/verification.ts` classifies
`[unit-test-budget:exceeded]` as a non-transient verification failure by
design, so a rebounce cannot clear it. The mission that happens to be verifying
when contention peaks is stranded through no fault of its own, and the failure
is a coin flip on machine load rather than a signal about the diff. The cheapest
durable fix is headroom: if the worst ordinary unit test finishes in 500 ms
solo, the 1,000 ms cap survives the observed 2x contention factor instead of
being crossed by it.

## Refinement Signals
- Predicted NEL bucket: Medium (81–235)
- Confidence: High
- Selection note: activate as-is
- Main drivers: one new hermetic repro test; a headroom threshold plus
  diagnostic in `test/lib/unit-test-budget-reporter.ts`; an isolated-run
  headroom gate wired through `test/lib/test-run-plan.ts` and
  `test/run-default-tests.ts`; and edits to the handful of default-suite test
  files that measure over 500 ms solo (each either made hermetic or relocated to
  `knownIntegrationTestFiles` with a justification comment). Bounded by the fact
  that the runner, reporter, and integration-boundary mechanism all already
  exist and are reused rather than replaced.

## Scope
- `test/lib/unit-test-budget-reporter.ts`: add a headroom threshold constant
  (500 ms) and a distinct diagnostic marker for tests between the headroom
  threshold and `UNIT_TEST_BUDGET_MS`, without changing the existing
  `[unit-test-budget:exceeded]` text, threshold, or emission conditions.
- `test/lib/test-run-plan.ts` and `test/run-default-tests.ts`: expose the
  headroom check as an explicitly requested isolated-run mode (flag and/or
  environment variable) that fails the run when any ordinary unit test exceeds
  the headroom threshold, and leave the default `npm test` per-test hard
  failure threshold at 1,000 ms.
- `test/task-2423-repro.test.ts`: new hermetic reproduction test (CP 1).
- The default-suite test files that measure above 500 ms in the CP 2 solo
  timing capture: make them hermetic (replace real timers, real filesystem
  churn, real database/process work with fakes or injected dependencies), or
  add them to `knownIntegrationTestFiles` in `test/lib/test-run-plan.ts` with a
  comment naming the specific boundary they cross.
- `test/unit-test-timeout-guard.test.ts` and
  `test/unit-test-budget-reporter.test.ts`: extend to cover the new headroom
  constant and diagnostic alongside the existing 1,000 ms assertions.
- Documentation of the two-tier rule (500 ms authoring target, 1,000 ms hard
  cap) in `AGENTS.md` under `## unit tests`.
- Reducing `UNIT_TEST_CONCURRENCY` in `test/lib/test-run-plan.ts` is permitted
  as a supporting control, but only in addition to the 500 ms headroom work.

## Out of Scope
- Changing `UNIT_TEST_BUDGET_MS` from 1,000 ms, or making the per-test cap
  configurable per mission.
- Changing the suite-level budget default (180 s) or the
  `PARALLIX_UNIT_TEST_BUDGET_MS` override semantics in
  `test/run-default-tests.ts`.
- Changing how `src/adapters/verification/verification.ts` classifies
  `[unit-test-budget:exceeded]` or `[unit-test-budget] SUITE BUDGET EXCEEDED:`,
  or any change to rebound classification in
  `src/application/rebound-kernel.ts`.
- Adding retries, timing-based reruns, quarantine lists, or "slow test" skip
  markers anywhere in the runner.
- Speeding up the `--integration` suite, or moving integration tests back into
  the default suite.
- Any production `src/` behaviour change beyond what a hermetic-ification of a
  test legitimately requires (for example, adding a dependency-injection seam
  that a test needs); no feature work.

## Success Criteria
> **Falsifiability rule (ADR 0039 Part 2):** Each criterion must be falsifiable. Forbidden: subjective adjectives ("easy, fast, simple, intuitive, user-friendly, responsive, quick, efficient" without an attached metric) and vague quantifiers ("multiple, several, some, many, few, various"). For refactor / condense / migration missions, the criterion must enumerate the specific elements (rules, files, behaviours) that must survive — generic phrases like "preserve critical content" are not sufficient.

- SC1: `test/task-2423-repro.test.ts` exists, runs in the default (non-integration)
  suite, contains no `spawnSync`/`spawn`/`execSync`/`execFileSync`/`fork`/
  `createServer`/`fetch(` call and no `git`/`npm` shell invocation (so
  `boundaryDependencyPattern` in `test/lib/test-run-plan.ts` does not classify
  it as integration), completes in under 500 ms, fails at the mission parent
  commit, and passes on the final tree.
- SC2: `test/lib/unit-test-budget-reporter.ts` exports a headroom threshold
  constant whose value is `500`, and emits a headroom diagnostic for a
  `test:pass` event with `details.duration_ms` of 501 that is textually distinct
  from `[unit-test-budget:exceeded]`.
- SC3: `UNIT_TEST_BUDGET_MS` in `test/lib/unit-test-budget-reporter.ts` is still
  exactly `1_000`, the `[unit-test-budget:exceeded]` diagnostic string is
  unchanged, and a `test:pass` event with `details.duration_ms` of 1001 still
  produces `[unit-test-budget:exceeded] <name>: 1001ms > 1000ms`.
- SC4: A single documented repository command runs the default unit suite with
  the headroom gate enabled, exits non-zero when any ordinary unit test exceeds
  500 ms, and names each offending test with its measured duration in the
  failure output. The command and its exit-code contract are recorded in
  `AGENTS.md`.
- SC5: That headroom command exits 0 on the final tree when run alone on the
  machine, with zero headroom diagnostics reported.
- SC6: The default `npm test` invocation (no headroom flag/env) still passes
  `--test-timeout=1000` and fails only at 1,000 ms; no threshold below 1,000 ms
  can fail a default `npm test` run. Asserted by a test in
  `test/unit-test-timeout-guard.test.ts`.
- SC7: `./scripts/verify-local.sh all` passes on the final tree in three
  consecutive runs launched while a second concurrent
  `./scripts/verify-local.sh all` is running against the same machine, with no
  `[unit-test-budget:exceeded]` line in any of the three outputs.
- SC8: The pattern at `src/adapters/verification/verification.ts` that matches
  `[unit-test-budget:exceeded]` and `[unit-test-budget] SUITE BUDGET EXCEEDED:`
  is byte-identical to the parent commit, and `git diff` on the final tree
  touches no file under `src/application/rebound-kernel.ts`.
- SC9: Every test file added to `knownIntegrationTestFiles` by this mission is
  accompanied by a comment in `test/lib/test-run-plan.ts` naming the concrete
  boundary it crosses (process, Git/worktree, SQLite/file database, package, or
  network); the diff adds no entry justified only by wall-clock duration.
- SC10: The final diff contains no new retry loop, no timing-based rerun, no
  test-name allowlist or skip list keyed on duration, and no environment
  variable that disables the 1,000 ms per-test cap.
- SC11: `./scripts/verify-local.sh all` and
  `./scripts/verify-local.sh static-analysis` both pass on the final tree.

## Risks and Assumptions
- Risk: the headroom gate becomes a second load-sensitive flake. A 400 ms test
  under 2x contention crosses 500 ms, so if the headroom threshold were enforced
  during ordinary parallel mission verification it would strand missions exactly
  as the 1,000 ms cap does today. Mitigation: SC4/SC6 require the headroom check
  to be opt-in for an isolated run, and require the default `npm test` path to
  keep 1,000 ms as its only per-test failure threshold.
- Risk: the cheap way to satisfy the 500 ms rule is to bulk-move slow files into
  `knownIntegrationTestFiles`, hollowing out the default suite. Mitigation: SC9
  requires a named boundary per relocated file; duration alone is not a valid
  justification.
- Risk: making a test hermetic changes what it asserts, silently weakening
  coverage. Mitigation: CP 3 requires each edited test to keep its assertion
  count and assertion targets; only the dependency it reaches for changes.
- Risk: the CP 2 solo timing capture is itself polluted by other agents'
  verification runs on the shared machine, producing a false offender list.
  Mitigation: CP 2 requires two capture runs and treats only tests over 500 ms
  in both runs as confirmed offenders; tests over 500 ms in exactly one run are
  re-measured a third time before being acted on.
- Assumption: the observed contention factor between a solo run and four
  concurrent mission verifications is at most 2x, which is what makes 500 ms
  solo sufficient headroom for a 1,000 ms cap. If CP 2 measurements show a
  larger factor, record the measured factor in CP-2.md and raise it as a stop
  condition rather than silently lowering the headroom threshold.
- Assumption: `--test-concurrency` is supported by the selected test Node
  (`supportsTestConcurrency()` in `test/lib/test-run-plan.ts` probes this), so
  concurrency remains an available supporting control.
- Assumption: node:test reports `details.duration_ms` per test in the default
  suite, which the existing reporter already relies on.

## Checkpoints
- CP 1: Lock the bug. Author `test/task-2423-repro.test.ts` as a hermetic unit
  test (no process, Git, database, or network boundary — see SC1). Reproduction
  scenario: drive `unitTestBudgetReporter` from
  `test/lib/unit-test-budget-reporter.ts` with a synthetic `test:pass` event
  stream containing (a) a test at 501 ms and (b) a test at 1001 ms, and assert
  that the reporter emits a headroom diagnostic for (a) while still emitting
  `[unit-test-budget:exceeded] ... 1001ms > 1000ms` for (b). Add a second
  assertion that the default plan returned by `buildTestRunPlan()` (no headroom
  flag) still carries `--test-timeout=1000`, and a third that the plan built
  with the headroom option requests the headroom threshold. At the mission
  parent commit the headroom assertions fail (red) because no headroom
  threshold, diagnostic, or plan option exists; they pass once CP 2 lands
  (green). Do not write any fix in this checkpoint. Record the red output in
  CP-1.md.
- CP 2: Implement the headroom mechanism and measure. Add the 500 ms headroom
  constant and its distinct diagnostic to
  `test/lib/unit-test-budget-reporter.ts`; wire the opt-in headroom mode through
  `buildTestRunPlan()` and `test/run-default-tests.ts` so the isolated run exits
  non-zero and names every offender with its duration; keep the default path at
  1,000 ms. Then run the headroom command twice, alone on the machine, and
  record in CP-2.md the full list of default-suite tests over 500 ms with both
  measured durations, plus the measured contention factor against a concurrent
  run (see Risks). CP 2 turns CP 1's repro green.
- CP 3: Eliminate the offenders. For each confirmed offender from CP 2, either
  make it hermetic (fake timers, injected dependencies, in-memory fixtures) or
  add it to `knownIntegrationTestFiles` in `test/lib/test-run-plan.ts` with a
  comment naming the boundary it crosses. Record in CP-3.md a per-file table of
  offender, chosen disposition, boundary named (if relocated), and the new
  measured duration. Preserve each edited test's assertion count and assertion
  targets. Optionally reduce `UNIT_TEST_CONCURRENCY` as a supporting control and
  state the new value.
- CP 4: Prove stability and close the contract. Extend
  `test/unit-test-timeout-guard.test.ts` and
  `test/unit-test-budget-reporter.test.ts` for the headroom constant, the
  unchanged 1,000 ms cap, and SC6. Document the two-tier rule and the headroom
  command in `AGENTS.md`. Run the SC5 solo headroom command and the SC7
  under-contention triple run, and record the raw outputs in CP-4.md. Confirm
  SC8 by diffing `src/adapters/verification/verification.ts` against the parent
  commit. Run both gates.

### Checkpoint Documentation Requirements
Every checkpoint document (CP-N.md) MUST include:
- A summary of work done
- A `## Goal Check` section — use exactly that heading
- A 3-column pipe-delimited markdown table with columns: Criterion | Evidence | Status
  (header row exactly `| Criterion | Evidence | Status |`)
- At least one evidence row per criterion in scope for that checkpoint (CP 1 →
  SC1, SC3; CP 2 → SC2, SC3, SC4; CP 3 → SC9, SC10; CP 4 → SC5, SC6, SC7, SC8,
  SC11), using durable, verifiable references. Lead with these forms:
  1. **Recognized repo commands or paths** — e.g. `` `npm test -- test/task-2423-repro.test.ts` ``,
     `` `./scripts/verify-local.sh all` ``, `` `./scripts/verify-local.sh static-analysis` ``,
     `` `git diff <parent-sha> -- src/adapters/verification/verification.ts` ``
  2. **Test names** — e.g. `"unit-test budget reporter marks measured synchronous work over the bound"`
     or `"unit-test timeout guard: runner enforces --test-timeout for the default suite"`
     (must match a test name that exists in the repo)
  3. **Test file paths** — e.g. `test/task-2423-repro.test.ts`,
     `test/lib/unit-test-budget-reporter.ts`, `test/lib/test-run-plan.ts`
     (must be an existing file)
  4. **ADR references** — e.g. `ADR 0041` (must correspond to an existing file
     under `docs/adr/`)
  5. **File:line references** — accepted when needed, but line numbers eventually
     rot; prefer the forms above
- Timing numbers are the core evidence of this mission, so quote the measured
  durations verbatim from the runner output — but a bare timing table, raw
  `stat`/`ls`/`time` output, or generic prose such as "tests are now fast enough"
  is NOT sufficient on its own. Every such row must be paired with one of the
  accepted references above (the command that produced it plus the test name or
  test file path it refers to). A row whose Evidence column contains only shell
  output or only prose fails this requirement.
- A non-generic `Next action:` line at the bottom naming the next checkpoint and
  the first concrete file or command it touches.

Example Goal Check table:

| Criterion | Evidence | Status |
|---|---|---|
| SC1 repro is hermetic and red at parent | `test/task-2423-repro.test.ts`, `npm test -- test/task-2423-repro.test.ts` (exit 1 at parent commit) | PASS |
| SC3 1,000 ms cap unchanged | `test/lib/unit-test-budget-reporter.ts`, `"unit-test budget reporter marks measured synchronous work over the bound"` | PASS |
| SC11 general verifier green | `./scripts/verify-local.sh all` | PASS |

## Gates
- [ ] `./scripts/verify-local.sh all`
- [ ] `./scripts/verify-local.sh static-analysis`

## Restricted Areas
- `src/adapters/verification/verification.ts` — the budget-diagnostic pattern is
  read-only for this mission (SC8).
- `src/application/rebound-kernel.ts` — no edits; budget failures must stay
  non-transient.
- `UNIT_TEST_BUDGET_MS` in `test/lib/unit-test-budget-reporter.ts` — value and
  the `[unit-test-budget:exceeded]` string are frozen at `1_000` and their
  current text.
- The suite-level budget default and `PARALLIX_UNIT_TEST_BUDGET_MS` handling in
  `test/run-default-tests.ts` — no changes.
- `scripts/verify-local.sh` `gate_all()` — do not add timing tolerances,
  retries, or `|| true` around `npm test`.
- Production `src/` code generally — edits only where a hermetic-ification needs
  a dependency-injection seam, and each such edit must be named in CP-3.md.
- Do not delete, rename, or move
  `backlog/tasks/task-2423 - Stabilize-one-second-unit-test-budget-under-parallel-load.md`,
  and do not edit its `assignee` field.

## Stop Rules
- Stop and report if the CP 2 measurement shows a contention factor above 2x
  between a solo run and four concurrent mission verifications: 500 ms of
  headroom would then be insufficient, and the threshold choice needs an
  operator decision rather than a silent adjustment.
- Stop if more than 15 confirmed offender files come out of CP 2. That is a
  suite-wide problem larger than this mission's Medium bucket; report the list
  and propose a split rather than expanding scope.
- Stop if satisfying the 500 ms rule for any offender would require deleting or
  weakening its assertions; report the test and its coverage instead of
  trimming it.
- Stop if a fix requires changing a restricted area, including any relaxation of
  the 1,000 ms cap or of the budget-diagnostic classification.
- Stop if `./scripts/verify-local.sh all` fails on the mission parent commit for
  reasons unrelated to test timing: that is a pre-existing baseline failure and
  must be reported, not repaired inside this mission.
- Stop if the SC7 under-contention triple run still produces a
  `[unit-test-budget:exceeded]` line after CP 3; report the offending test and
  its measured duration rather than adding a retry or raising a threshold.
