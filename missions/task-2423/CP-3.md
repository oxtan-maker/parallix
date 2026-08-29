# CP-3 — Confirmed-offender disposition

No default-suite test was a confirmed offender, so no test was relocated and
no assertion target was changed. The sole first-run candidate was below 500 ms
in both required remeasurements (358.673583 ms and 379.110233 ms).

| Offender candidate | Disposition | Boundary named | Remeasured durations |
|---|---|---|---|
| `"default test runner classifies tui-spawn as default (not integration) and pins bootstrap bypass"` | Retained in default suite; not confirmed | None; it is a pure plan/source assertion | 358.673583 ms; 379.110233 ms |

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC9 relocations name a concrete boundary | `test/lib/test-run-plan.ts`; no TASK-2423 entry was added to `knownIntegrationTestFiles` because `npm test -- --unit-test-headroom` did not confirm an offender | PASS |
| SC10 introduces no timing bypass | `test/lib/test-run-plan.ts`, `test/run-default-tests.ts`; `npm test -- --unit-test-headroom` uses one opt-in reporter marker and no retry, duration allowlist, skip list, or cap-disabling environment variable | PASS |

Next action: CP-4 will extend the existing reporter and timeout-guard tests, document `npm test -- --unit-test-headroom` in `AGENTS.md`, then run the final gates.
