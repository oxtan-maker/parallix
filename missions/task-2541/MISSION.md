# Mission: remove timing tests from the GitHub CI lane (task-2541)

## Goal
Remove timing-dependent tests from the GitHub-hosted CI lane so the slow GitHub
runner no longer fails them with `'test timed out after 1000ms'`. The concrete,
failing example this mission exists to close is:

```
✖ failing tests:
test at test/task-1039-integrate.test.ts:1:10834
✖ integrate aborts before merge when a pre-integration gate fails (1231.664883ms)
  'test timed out after 1000ms'
```

Timing tests are relocated out of the GitHub-safe lane, not deleted, so their
coverage survives in local verification.

## Why Now
GitHub-hosted runners are materially slower than the local workstation, and the
unit-test timeout budget is hard-capped at `1000ms` (`test/lib/unit-test-budget-reporter.ts`,
`UNIT_TEST_BUDGET_MS`). Tests that assert on wall-clock timing or that spawn real
subprocesses/pty/git cross that 1000ms ceiling on GitHub and fail with a timeout,
while passing locally. This is a recurring, repeat failure: the backlog carries
prior timing-test removals and the current task is "remove **another** timing
test". Stopping these from running on GitHub turns a flaky, slow CI lane into a
stable one without touching production code.

## Refinement Signals
- Predicted NEL bucket: Small (0–80)
- Confidence: High
- Selection note: activate as-is
- Main drivers: GitHub CI timeout failures on timing-dependent tests; the 1000ms
  unit-test budget; coverage-preserving relocation via the existing test-category
  registry rather than deletion.

## Scope
- In scope:
  - Identify every timing-dependent test that runs in the GitHub-safe lane
    (`INTEGRATION_CI_TESTS` in `test/lib/test-categories.ts`) and relocate it to
    the local-only lane (`INTEGRATION_LOCAL_TESTS`) with a written reason in
    `INTEGRATION_LOCAL_REASONS`.
  - A timing-dependent test is either (a) a test whose assertions depend on
    wall-clock timing, durations, dwell times, or cycle times, or (b) a test
    that exceeds the 1000ms unit-test budget when run and therefore times out on
    GitHub's slow runners.
  - Primary confirmed target: `test/task-2376-lifecycle-timing.test.ts` (asserts
    on lifecycle dwell/cycle timing) — move from `INTEGRATION_CI_TESTS` to
    `INTEGRATION_LOCAL_TESTS`.
  - Named repro target: resolve the timeout in
    `test/task-1039-integrate.test.ts` (`integrate aborts before merge when a
    pre-integration gate fails`) by moving that test's file out of the GitHub CI
    lane if it is timing/slow-dependent; confirm locally whether the file is the
    slow boundary before relocating.
  - Enumerate the full set at execution by running the unit budget locally and
    flagging any discovered test that exceeds 1000ms or asserts on timing.
- Out of Scope:
  - Raising `UNIT_TEST_BUDGET_MS` or otherwise changing the timeout budget.
  - Modifying, optimizing, or refactoring any production code under `src/`.
  - Speeding up the slow tests so they pass on GitHub — the mission relocates
    them, it does not make them fast.
  - Adding new tests, new CI gates, or new configuration beyond
    `test/lib/test-categories.ts`.
  - Removing or skipping tests with bare `.skip`/`.only` markers.

## Out of Scope
- See Scope. Anything outside the relocation of timing-dependent tests from
  `INTEGRATION_CI_TESTS` to `INTEGRATION_LOCAL_TESTS` is out of scope.

## Success Criteria
> **Falsifiability rule (ADR 0039 Part 2):** each criterion below is
> falsifiable and cites durable evidence.

- The confirmed timing test `test/task-2376-lifecycle-timing.test.ts` no longer
  appears in `INTEGRATION_CI_TESTS` and appears in `INTEGRATION_LOCAL_TESTS`.
  → `grep -n "task-2376-lifecycle-timing.test.ts" test/lib/test-categories.ts`
  (present under `INTEGRATION_LOCAL_TESTS`, absent from `INTEGRATION_CI_TESTS`).
- Every relocated timing test has a non-empty written reason in
  `INTEGRATION_LOCAL_REASONS` keyed by its filename.
  → `grep -n "task-2376-lifecycle-timing.test.ts" test/lib/test-categories.ts`
  shows a matching entry in `INTEGRATION_LOCAL_REASONS`.
- The named repro timeout no longer times out on the GitHub CI lane:
  `integrate aborts before merge when a pre-integration gate fails` is not run
  in `integration-ci` (either its file is moved to local-only, or it is removed
  from the CI-slow set).
  → `grep -n "task-1039-integrate.test.ts" test/lib/test-categories.ts` confirms
  CI-lane status; `./scripts/verify-local.sh all` runs green.
- `test/lib/test-categories.ts` still validates: any integration-layer test is
  classified, and no prohibited CI dependency marker is present.
  → `test/test-categories.test.ts` passes.
- No focused or unannotated skipped tests introduced: no `.only`, no bare
  `.skip` in changed files.
  → `./scripts/verify-local.sh static-analysis` (test-hygiene) passes.
- No production behavior changed: nothing under `src/` is modified.
  → `git diff --stat -- src/` is empty.

## Risks and Assumptions
- The backlog text ("tests that check timings") is slightly ambiguous between
  timing-*assertion* tests and slow *time-out* tests. This mission treats both
  as in scope and requires the implementer to enumerate the set by local timing
  measurement, so the wrong (too-narrow or too-broad) set is not shipped.
- Assumption: relocation to `INTEGRATION_LOCAL_TESTS` preserves coverage and is
  the intended "remove from GitHub" mechanism, per the existing registry and
  DOD item #3 (no bare `.skip`). If a timing test has no local-execution value,
  deletion is acceptable and must be justified in the checkpoint.
- Assumption: `test-categories.test.ts` is the acceptance gate for category
  hygiene; moving a file between lists must keep it classified.
- Risk: over-broad relocation could drop valuable integration coverage from CI.
  Mitigation: relocate only timing-dependent tests, and keep the non-timing
  integration tests in `INTEGRATION_CI_TESTS`.

## Checkpoints
- CP 1: Identify the timing-dependent test set. Enumerate every test that asserts
  on timing or exceeds the 1000ms unit budget; record the confirmed members
  (`test/task-2376-lifecycle-timing.test.ts` and the `task-1039-integrate.test.ts`
  repro).
- CP 2: Relocate the identified timing tests from `INTEGRATION_CI_TESTS` to
  `INTEGRATION_LOCAL_TESTS` in `test/lib/test-categories.ts`, writing a reason
  for each in `INTEGRATION_LOCAL_REASONS`.
- CP 3: Verify. Run `./scripts/verify-local.sh all`; confirm
  `test/test-categories.test.ts` passes, no `.only`/`.skip` introduced, and
  `src/` is untouched.

### Checkpoint Documentation Requirements
Every checkpoint document (CP-N.md) MUST include:
- A summary of work done
- A `## Goal Check` section
- A 3-column pipe-delimited markdown table with columns: Criterion | Evidence | Status
- At least one evidence row per criterion using durable, verifiable references.
  Parallix already accepts, in priority order:
  1. **Recognized repo commands or paths** — e.g., `` `grep -n "task-2376-lifecycle-timing.test.ts" test/lib/test-categories.ts` ``,
     `` `test/test-categories.test.ts` ``,
     `` `./scripts/verify-local.sh all` ``,
     `` `git diff --stat -- src/` ``
  2. **Test names** — must match a test name in the repo, e.g.
     `"R2: delayed integration dwell — review 30m, integration 225m"`
  3. **Test file paths** — must be an existing test file, e.g.
     `test/task-2376-lifecycle-timing.test.ts`
  4. **ADR references** — must correspond to an existing file under `docs/adr/`,
     e.g. `ADR 0039`
  5. **File:line references** — accepted when needed, but line numbers eventually
     rot; prefer the forms above (mention parenthetically, do not lead with them)
- Raw `stat`/`ls` output or generic prose may appear as supplemental context, but
  pair them with one of the accepted references above. Raw `ls` of `test/` with
  no `grep`/command anchor, or a sentence like "the test was moved", is NOT
  enough — a weak agent fails here because it reports the action without the
  durable reference that proves it.
- A non-generic `Next action:` line at the bottom.

Example Goal Check table:

| Criterion | Evidence | Status |
|---|---|---|
| timing test left the CI lane | `grep -n "task-2376-lifecycle-timing.test.ts" test/lib/test-categories.ts` (absent from `INTEGRATION_CI_TESTS`, present in `INTEGRATION_LOCAL_TESTS`) | PASS |
| reason written for relocation | `test/lib/test-categories.ts` `INTEGRATION_LOCAL_REASONS['task-2376-lifecycle-timing.test.ts']` non-empty | PASS |
| category registry validates | `test/test-categories.test.ts` | PASS |
| no focused/unannotated skips | `./scripts/verify-local.sh static-analysis` | PASS |
| production code untouched | `git diff --stat -- src/` empty | PASS |

## Gates
- [ ] ./scripts/verify-local.sh all

## Restricted Areas
- `src/` — production code is off-limits; this mission only re-lanes tests.
- `test/lib/unit-test-budget-reporter.ts` / the `1000ms` budget — do not change.
- Any test file other than relocating membership in `test/lib/test-categories.ts`
  — do not edit test bodies; do not add `.skip`/`.only`.
- The backlog `assignee` field — do not touch (workflow records ownership).

## Stop Rules
- Stop before implementing: this draft phase produces the contract only.
- Stop if the timing-test set cannot be enumerated locally: record the ambiguity
  in the checkpoint and escalate rather than guessing a broad deletion.
- Stop if relocating a test would remove the only coverage of a non-timing
  behavior; keep that test in `INTEGRATION_CI_TESTS`.
- Do not run any verification gate other than `./scripts/verify-local.sh all`.
- Do not push the mission branch to `origin`; only `main` may be pushed there.
