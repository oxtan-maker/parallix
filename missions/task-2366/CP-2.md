# CP-2: Classify pre-handoff rebase failure as a gate failure

Added a specific `Rebase failed before handoff` classification before the
fallback paths. It maps to `GateFailure` and `AutoSendBack`, so the existing
relaunch logic treats this wrapper error as a repairable verification failure.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Pre-handoff rebase failures classify as `GateFailure` | `src/adapters/cli/commands/repair-handoff.ts` — `classifyError`; `test/task-2366-repro.test.ts` | PASS |
| Rebase failures dispatch an implementer relaunch | `test/task-2366-repro.test.ts`, `"task-2366 repro: classifyError maps rebase failure to GateFailure/AutoSendBack"` | PASS |
| Static analysis is clean | `./scripts/verify-local.sh static-analysis` | PASS |

Next action: Run the mission’s full verification suite and capture its result in CP-3.
