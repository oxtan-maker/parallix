# CP-3: Ordered progress diagnostics and PTY cancellation

Connected controller progress callbacks to the shell’s transient operation log,
ordered by controller sequence number. These events affect diagnostic rendering
only; they never mutate the immutable board projection or a card lane. The real
PTY harness now verifies confirmation, cancellation before dispatch, navigation,
resize, and clean exit without launching an agent.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Progress events append to the command log in sequence order | `src/interfaces/tui/shell.tsx:131`, `src/interfaces/tui/shell.tsx:135`, "progress events render in the command log without changing the card lane" | PASS |
| A progress event cannot move a mission card between lanes | `test/tui-command-flow.test.ts:77`, "progress events render in the command log without changing the card lane" | PASS |
| PTY flow confirms then cancels before dispatch and exits with code 0 | `test/tui-pty-smoke.test.ts:31`, "real PTY smoke: launch, keyboard navigation, resize, clean exit, timeout bound, and terminal restoration" | PASS |
| Final verification commands pass on the committed mission tree | `./scripts/verify-local.sh all`, `./scripts/verify-local.sh static-analysis` | PASS |

Next action: hand the committed checkpoint set to Parallix; lifecycle transition remains external to this mission.
