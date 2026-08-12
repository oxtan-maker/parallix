# CP-1: Rebase-failure reproduction test

Added the focused regression test for the generic pre-handoff rebase failure.
The test is red on the parent implementation: `classifyError` returns
`InfraBlocker` rather than the required relaunchable `GateFailure`.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Reproduction covers the generic pre-handoff rebase error | `test/task-2366-repro.test.ts`, `"task-2366 repro: classifyError maps rebase failure to GateFailure/AutoSendBack"` | PASS |
| Reproduction is red before the classifier fix | `npm test -- test/task-2366-repro.test.ts` | PASS (red: `InfraBlocker` received where `GateFailure` is required) |

Next action: Add the narrowly scoped rebase-failure classification in `classifyError` and run static analysis.
