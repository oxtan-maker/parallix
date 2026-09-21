# CP-4 — Focused coverage tests: selector invariant, single-execution, merged LCOV

## Summary of work done

Confirmed / added focused coverage that pins the mission invariants at the unit
level without touching real boundaries:

- Selector invariant — `test/task-2547-repro.test.ts`: hosted coverage is a
  subset of `unit ∪ integration-ci` and intersects `INTEGRATION_LOCAL_TESTS` in
  zero files (proves the set relationship, not a single filename).
- Single-execution command boundary — `test/task-2525.03-sonar-enforcement.test.ts`
  asserts `.github/workflows/ci-required.yml` contains `npm run coverage:merge`,
  does NOT contain `npm run test:coverage` (no second coverage pass), and reaches
  the single `npm run sonar` entrypoint shared with the local pre-integration
  gate in `workflow.config.json` `adapters.gates.preIntegration`.
- Correct merged LCOV behavior — `test/coverage-gate.test.ts`
  `normalizeLcov unions duplicate worker records by source line` asserts a
  source/line present in two fragments keeps the larger hit count
  (`DA:1,0` + `DA:1,2` → `DA:1,2`) instead of a duplicated `DA` record, and the
  authoritative-discovery test asserts `coverageTestFiles()` excludes
  `e2e-real-agent-smoke.test.ts` / `e2e-mission-lifecycle.test.ts` and includes
  real integration files such as `task-1209-review-loop.test.ts`.
- Local tier paths preserved — `test/test-categories.test.ts` (7 tests) asserts
  the real-agent and lifecycle suites stay out of the unit and integration lanes
  and that the verification tiers have stable npm commands.

Measured:

```
$ node --experimental-test-module-mocks --import tsx --test test/test-categories.test.ts
ℹ pass 7  fail 0
$ node --experimental-test-module-mocks --import tsx --test test/task-2525.03-sonar-enforcement.test.ts
ℹ pass 2  fail 0
$ node --experimental-test-module-mocks --import tsx --test test/coverage-gate.test.ts
ℹ pass 20  fail 0
```

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC2 — selector invariant pinned | `test/task-2547-repro.test.ts`, `test/coverage-gate.test.ts` | PASS |
| SC3 — single-execution boundary pinned | `test/task-2525.03-sonar-enforcement.test.ts` | PASS |
| SC4 — merged LCOV behavior pinned | `test/coverage-gate.test.ts` `mergeLcov` regression test (multi-fragment union, no `DA:` duplication, recomputed LF/LH, distinct `SF:`, empty input) | PASS |
| SC6 — local tier paths preserved | `test/test-categories.test.ts` | PASS |

## Next action:
Proceed to CP-5: run the repository gates and capture final Goal Check evidence,
including the real `github-publish/<sha>` `ci-required` log showing the CI-safe
tests, LCOV artifact, Sonar scan, quality-gate result, and green job.
