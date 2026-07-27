# CP-3 — default invocation policy and documentation

Implemented the isolated policy flip. The dispatcher opens the existing lazy `ui` command only when the bare invocation is interactive, not marked CI, and not opted out with `PARALLIX_NO_TUI=1`; all other bare invocations retain usage help and exit 0. The runtime runner now delegates bare invocation to that dispatcher, preserving the same explicit `px ui` entry point. Help and the two relevant user documents describe the default, explicit command, and opt-out.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC1: Interactive bare `px` and explicit `px ui` share the lazy board command | `src/platform/runtime/index.ts:163`; `src/platform/runtime/index.ts:70`; "no-command TTY dispatches the same ui command as explicit px ui" | PASS |
| SC2: Non-TTY, CI, and redirected bare invocation preserve usage/zero-exit fallback | `src/platform/runtime/index.ts:142`; `src/platform/runtime/px.ts:217`; "no-command non-TTY scenarios preserve legacy usage bytes, exit code, and UI isolation" | PASS |
| SC3: `PARALLIX_NO_TUI=1` restores the prior TTY behavior | `src/platform/runtime/index.ts:133`; "PARALLIX_NO_TUI=1 restores legacy bare-command behavior on a TTY" | PASS |
| SC4: UI loading stays lazy and non-TTY tests do not invoke it | `src/platform/runtime/index.ts:70`; `test/no-command-tty.test.ts:41`; `test/tui-headless-isolation.test.ts` | PASS |
| SC5: Help and user documents explain default, explicit command, and opt-out | `src/platform/runtime/index.ts:315`; `docs/tui-board.md:3`; `docs/npm-package-major-migration.md:80`; "help documents the TTY default, explicit ui command, and opt-out" | PASS |
| SC6: Policy change is confined to one reversible implementation commit | `src/platform/runtime/index.ts:163`; `src/platform/runtime/px.ts:217`; `test/no-command-tty.test.ts` | PASS — commit pending |
| SC7: Focused policy suite and typecheck pass | `node --import tsx --test test/no-command-tty.test.ts`; `npm run typecheck` | PASS |

Next action: commit the implementation, tests, documentation, and checkpoint records together, then run both mission-declared verification gates on that committed tree.
