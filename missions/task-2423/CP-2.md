# CP-2 — Headroom mechanism and measurement

Added opt-in `--unit-test-headroom` mode. It preserves Node's 1,000 ms test
timeout, enables a reporter-only 500 ms check, emits each measured offender,
and makes the runner return non-zero when that diagnostic appears. Default
`npm test` does not enable the mode.

The three isolated captures found no confirmed offender. One initial sample of
`"default test runner classifies tui-spawn as default (not integration) and pins
bootstrap bypass"` was 613.186038 ms; required remeasurement was 358.673583 ms
and 379.110233 ms, so it is not a CP-3 target. The concurrent captures were
60,250 ms and 60,835 ms versus a fastest solo elapsed time of 54,543 ms, a
1.11x suite-elapsed factor, below the 2x assumption.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC2 exports and reports the 500 ms headroom threshold | `test/lib/unit-test-budget-reporter.ts`; `npm test -- test/task-2423-repro.test.ts` passes `"TASK-2423: headroom mode reports 501ms work while preserving the 1000ms hard cap"` | PASS |
| SC3 preserves the exact 1,000 ms hard-cap diagnostic | `test/lib/unit-test-budget-reporter.ts`; `npm test -- test/task-2423-repro.test.ts` reports `[unit-test-budget:exceeded] hard-cap work: 1001ms > 1000ms` | PASS |
| SC4 headroom command fails on named measured offenders | `npm test -- --unit-test-headroom`; `test/lib/unit-test-budget-reporter.ts` emitted `[unit-test-budget:headroom] default test runner classifies tui-spawn as default (not integration) and pins bootstrap bypass: 613ms > 500ms` in the first isolated capture | PASS |

Next action: CP-3 will retain the default suite because `test/default-test-suite.test.ts` had no confirmed >500 ms result across the required remeasurements.
