# CP-2: Guarded shell dispatch

Replaced the wave-5 placeholder with a confirmation-gated dispatch path. The
shell receives a controller from composition, calls `dispatchWithStatus()` only
after Enter confirmation, renders cancellation without dispatching, and
refreshes/re-presents after a conflict. The TUI guardrail now verifies that its
modules do not perform direct workflow effects.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Shell confirms before controller dispatch and cancellation dispatches nothing | `src/interfaces/tui/shell.tsx:139`, `src/interfaces/tui/shell.tsx:397`, "confirmation cancellation dispatches nothing and renders cancelled outcome" | PASS |
| Conflict refreshes projection and re-presents rather than blindly retrying | `src/interfaces/tui/shell.tsx:160`, "confirmed action dispatches through supplied controller and conflict refreshes before re-prompting" | PASS |
| UI dispatch path is supplied as `BoardCommandController.dispatchWithStatus` | `src/interfaces/tui/shell.tsx:77`, `src/interfaces/tui/ui-command.ts:149` | PASS |
| TUI source has no direct task write, Git, SQL, Forgejo, or subprocess effect | `test/tui-command-guardrail.test.ts`, "TUI modules perform no task-file write, Git call, SQL, Forgejo call, or subprocess spawn" | PASS |
| Existing board navigation behavior remains covered | `test/tui-wave-3-component.test.ts`, `test/tui-wave-4-attention.test.ts` | PASS |

Next action: make controller progress events visible in the operation log and extend the PTY smoke fixture for confirmation cancellation and clean exit.
