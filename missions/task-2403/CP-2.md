# CP-2 — One-second enforcement and hermetic returns

The unit runner and shared test plan now pass `--test-timeout=1000`. The eleven runtime-only entries audited in CP-1 now run in the default unit suite. The sole retained candidate, `tui-pty-smoke.test.ts`, is explicitly integration-classified for its real packaged-CLI PTY child-process boundary. The affected `AgentStrip` assertions retain real Ink renderer coverage.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Unit timeout is at most 1,000 ms | `npm test -- test/default-test-suite.test.ts test/unit-test-timeout-guard.test.ts`; `test/lib/test-run-plan.ts`; `test/run-default-tests.ts` | PASS |
| Every default-selected test is constrained by the timeout | `"unit-test timeout guard: --test-timeout terminates a test exceeding the bound"`; `test/unit-test-timeout-guard.test.ts` | PASS |
| Runtime-classified integration tests have a real boundary or return plan | `test/lib/test-run-plan.ts`; `test/tui-pty-smoke.test.ts`; `test/helpers/pty-smoke-harness.ts` | PASS |
| Integration classification is not based solely on runtime | `test/default-test-suite.test.ts`; `test/lib/test-run-plan.ts` | PASS |
| Changed tests retain assertions with no focused or bare skipped tests | `"AgentStrip renders a red dot and countdown for a family blocked until a future timestamp"`; `"AgentStrip renders live authoritative work separately from coordinator evidence"`; `test/agent-strip.test.ts`; `test/mission-activity.test.ts` | PASS |
| Default unit duration does not exceed the uncontended baseline | `npm test` | PENDING — CP-3 captures the comparable full run |
| Integration tests remain exempt from the unit timeout | `npm run test:integration`; `test/lib/test-run-plan.ts` | PASS |

Next action: run the complete default and integration selections, record the comparable post-change duration, and execute `./scripts/verify-local.sh all`.
