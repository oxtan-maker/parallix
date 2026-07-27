# CP-4 — final verification and reversible boundary

The committed policy flip passed both mission-declared gates on the final implementation tree. The implementation commit is `2bf8220fd` (`feat(cli): launch board for bare TTY invocation`); it contains the two routing files, focused tests, help/user documentation, and the prior checkpoint records. The only later commit records this final checkpoint, so reverting `2bf8220fd` restores the explicit-only policy implementation without mixing in unrelated work.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC1: Interactive bare `px` dispatches the existing explicit UI command | `src/platform/runtime/index.ts:166`; `src/platform/runtime/index.ts:70`; "no-command TTY dispatches the same ui command as explicit px ui" | PASS |
| SC2: Pipe, CI, and redirected no-command paths retain legacy usage bytes and exit code | `src/platform/runtime/index.ts:175`; `test/no-command-tty.test.ts:41`; "no-command non-TTY scenarios preserve legacy usage bytes, exit code, and UI isolation" | PASS |
| SC3: A documented opt-out restores prior TTY no-command behavior | `src/platform/runtime/index.ts:141`; `docs/tui-board.md:9`; "PARALLIX_NO_TUI=1 restores legacy bare-command behavior on a TTY" | PASS |
| SC4: Non-TTY routing neither imports nor initializes the UI command | `src/platform/runtime/index.ts:70`; `test/no-command-tty.test.ts:56`; `test/tui-headless-isolation.test.ts` | PASS |
| SC5: Help and user documentation state the new default, explicit command, and opt-out | `src/platform/runtime/index.ts:315`; `docs/tui-board.md:94`; `docs/npm-package-major-migration.md:80`; "help documents the TTY default, explicit ui command, and opt-out" | PASS |
| SC6: Implementation, tests, and user documentation are one reversible policy commit | `git show --stat 2bf8220fd`; `src/platform/runtime/px.ts:218`; `test/no-command-tty.test.ts` | PASS |
| SC7: Required general and static-analysis gates pass on the final implementation tree | `./scripts/verify-local.sh all`; `./scripts/verify-local.sh static-analysis` | PASS |

Next action: provide the committed checkpoint set to Parallix for its lifecycle-managed review transition; do not run `px review` or `px integrate` from this mission worktree.
