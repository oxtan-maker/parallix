# CP-2 — focused routing and compatibility tests

Added focused dispatcher tests before relying on the new default route. They inject terminal and environment conditions instead of starting real UI processes: the TTY path and explicit `px ui` must invoke the same command, while pipe, redirected-output, and CI conditions must produce the exact captured legacy usage/exit sequence and must not invoke the injected UI command. The tests also define the opt-out and help-text contract.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC1: TTY bare invocation and explicit `px ui` use one board command | `test/no-command-tty.test.ts:21`; "no-command TTY dispatches the same ui command as explicit px ui" | PASS |
| SC2: Pipe, CI, and redirected-output paths compare legacy usage bytes and exit code | `test/no-command-tty.test.ts:41`; "no-command non-TTY scenarios preserve legacy usage bytes, exit code, and UI isolation" | PASS |
| SC3: Opt-out returns the captured legacy bare-command result on a TTY | `test/no-command-tty.test.ts:66`; "PARALLIX_NO_TUI=1 restores legacy bare-command behavior on a TTY" | PASS |
| SC4: Non-TTY scenarios cannot invoke the injected UI command | `test/no-command-tty.test.ts:41`; "no-command non-TTY scenarios preserve legacy usage bytes, exit code, and UI isolation" | PASS |
| SC5: Help wording is covered | `test/no-command-tty.test.ts:88`; "help documents the TTY default, explicit ui command, and opt-out" | PASS |
| SC6: Tests isolate the policy flip at the dispatcher boundary | `src/platform/runtime/index.ts:163`; `test/no-command-tty.test.ts` | PASS — ready for implementation commit |
| SC7: Focused suite and production typecheck pass | `node --import tsx --test test/no-command-tty.test.ts`; `npm run typecheck` | PASS |

Next action: wire the TTY decision through the production runner, update help and TUI docs, then commit the policy flip with its tests as one reversible change.
