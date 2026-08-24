# CP-1 — Baseline and classification inventory

The uncontended default unit command completed 2,029 tests in 22,569 ms (runner elapsed 22,615 ms) with the existing 30,000 ms per-test setting. The runtime-only entries in `test/lib/test-run-plan.ts` were audited: `pi-runner.test.ts`, `task-1104-call-order.test.ts`, `task-1268-pre-review-gate-per-round.test.ts`, `task-2311-console-empty-repro.test.ts`, `task-2313-repro.test.ts`, `tui-action-bar.test.ts`, `tui-confirmation.test.ts`, `tui-lane-columns.test.ts`, `tui-outcome-banner.test.ts`, `tui-responsive-layout.test.ts`, and `test/adapters/status-characterization-cp4.test.ts` use mocks, deterministic fixtures, or in-process Ink rendering and are proposed returns to the unit suite. `tui-pty-smoke.test.ts` remains integration because it launches a real PTY child process through `test/helpers/pty-smoke-harness.ts`.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Unit timeout is at most 1,000 ms | `npm test`; `test/run-default-tests.ts` currently reports `timeout=30000ms per test` | FAIL — CP-2 changes the runner |
| Every default-selected test is constrained by the timeout | `npm test`; `test/unit-test-timeout-guard.test.ts` | PENDING — current bound is 30,000 ms |
| Runtime-classified integration tests have a real boundary or return plan | `test/lib/test-run-plan.ts`; `test/tui-pty-smoke.test.ts`; `test/helpers/pty-smoke-harness.ts` | PASS — eleven return candidates and one PTY boundary recorded |
| Integration classification is not based solely on runtime | `test/lib/test-run-plan.ts` | FAIL — the TASK-2326 round-3 list is runtime-based |
| Changed tests retain assertions with no focused or bare skipped tests | `npm test`; `test/unit-test-timeout-guard.test.ts` | PASS — baseline reports 0 skipped |
| Default unit duration does not exceed the uncontended baseline | `npm test` — 22,569 ms test duration / 22,615 ms runner elapsed | PASS — baseline recorded for CP-3 comparison |
| Integration tests remain exempt from the unit timeout | `npm run test:integration`; `test/run-default-tests.ts` | PASS — `runsIntegrationSuite` omits the timeout argument |

Next action: remove the runtime-only integration entries, enforce the 1,000 ms unit timeout, then repair any returned test that exposes a non-hermetic seam.
