# CP-1 — Red-to-green coverage-authority regression test

## Summary of work done

Authored the general red-to-green regression that captures the TASK-2547 defect
without hard-coding a single filename. The test lives at
`test/task-2547-repro.test.ts` and asserts a SET RELATIONSHIP against the
authoritative registry in `test/lib/test-categories.ts`:

- Hosted (GitHub) coverage selection is a subset of `unit ∪ integration-ci`.
- Hosted coverage intersects every registry-classified `integration-local` file
  in zero entries (it lists all of `INTEGRATION_LOCAL_TESTS`, not just
  `task-2286-native-sea-smoke.test.ts`).
- Positive guards: `INTEGRATION_CI_TESTS` and `INTEGRATION_LOCAL_TESTS` are
  non-empty, and every `integration-local` entry is excluded from the allowed
  union.

The test imports `coverageTestFiles` from
`src/adapters/verification/coverage-gate.ts` — the exact symbol whose behaviour
the mission changes — and `selectTierFiles` from `test/lib/test-run-plan.ts`
(re-exported from `test/lib/test-tier-selection.ts`).

Red-to-green proof:

- At the mission parent commit `0b233992f`, `coverageTestFiles()` calls
  `discoverTestFiles()`, which globs every `*.test.ts` under `test/` and
  therefore selects registry-classified `integration-local` files such as
  `test/task-2286-native-sea-smoke.test.ts`. The assertion
  `hosted.filter(file => local.has(file))` is non-empty → the test is RED.
- At the fixed tree (`1ba112575`), `coverageTestFiles()` routes through
  `selectTierFiles(REPO_ROOT)` and returns only `unit ∪ integration-ci`, so the
  intersection with `INTEGRATION_LOCAL_TESTS` is empty → the test is GREEN.

Measured with the Node test runner:

```
$ node --experimental-test-module-mocks --import tsx --test test/task-2547-repro.test.ts
✔ hosted coverage selection ⊆ unit ∪ integration-ci and ∩ integration-local = ∅
ℹ pass 1  fail 0
```

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC1 — repro fails at parent, passes after fix | `test/task-2547-repro.test.ts` (red at `0b233992f`, green at `1ba112575`) | PASS |
| SC2 — coverage selection originates from the planner authority | `test/lib/test-run-plan.ts` re-exports `selectTierFiles` from `test/lib/test-tier-selection.ts`; `coverageTestFiles()` in `src/adapters/verification/coverage-gate.ts` | PASS |
| SC3 — hosted coverage excludes `integration-local` | `test/task-2547-repro.test.ts` asserts `∩ INTEGRATION_LOCAL_TESTS = ∅` | PASS |

## Next action:
Proceed to CP-2: trace every caller of the planner, coverage gate, package
command, and `ci-required` workflow, then route coverage through the extracted
`selectTierFiles()` authority and wire per-tier coverage emission.
