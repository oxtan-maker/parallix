# CP-3 — Final verification record

The runner enforces a 1,000 ms unit-test timeout, returned runtime-only tests use the unit selection, and the sole retained audited candidate (`tui-pty-smoke.test.ts`) remains integration because it launches a real PTY child process. TUI test modules preload Ink and React so renderer initialization is not charged to a behavioral test body.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Unit timeout is at most 1,000 ms | `npm test -- test/default-test-suite.test.ts test/unit-test-timeout-guard.test.ts`; `test/lib/test-run-plan.ts` | PASS |
| Every default-selected test is constrained by the timeout | `"unit-test timeout guard: --test-timeout terminates a test exceeding the bound"`; `test/unit-test-timeout-guard.test.ts` | PASS |
| Runtime-classified integration tests have a real boundary or return to unit | `test/lib/test-run-plan.ts`; `test/tui-pty-smoke.test.ts`; `test/helpers/pty-smoke-harness.ts` | PASS |
| Integration classification is not based solely on runtime | `test/default-test-suite.test.ts`; `test/lib/test-run-plan.ts` | PASS |
| Changed tests retain behavioral assertions and no focused or bare skipped tests | `"AgentStrip renders a red dot and countdown for a family blocked until a future timestamp"`; `test/tui-responsive-layout.test.ts` | PASS |
| Default unit duration does not exceed the uncontended baseline | `npm test` — CP-1 baseline 22,615 ms; latest completed full capture `npm test` 26,789 ms | FAIL — remaining duration regression requires follow-up measurement/optimization |
| Integration tests remain exempt from the unit timeout | `npm run test:integration`; `test/lib/test-run-plan.ts` | PASS |
| Required mission gate passes | `./scripts/verify-local.sh all` | PENDING — rerun after this committed checkpoint |

Next action: rerun `./scripts/verify-local.sh all` against this committed checkpoint and resolve any remaining duration regression before handoff.
