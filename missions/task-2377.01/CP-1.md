# CP-1 — red reproduction (lock the bug)

## Work done

Authored `test/task-2377-sigint-pty-repro.test.ts` **before any fix**, per the mission's
CP 1 contract.

The subject is deliberately not the board: a bare idle `node -e` loop launched through
`launchPtySmoke` never enables raw mode and holds no terminal state, so "the terminal is
restored once that pid is gone" is trivially true for the *application*. Any failure of
`terminalRestored()` is therefore a defect in `test/helpers/pty-smoke-harness.ts`, not in
the process under test — which is exactly the structural claim the mission makes.

Scenario: launch the idle process, wait for its `PTY-SMOKE-READY` marker on the PTY,
send a single Ctrl+C (`\u0003`) while the line discipline is still cooked (so 0x03 becomes a
SIGINT to the PTY foreground process group — the outer `script` shell included), then
assert the session exits, the pid is gone, and `terminalRestored()` is `true`.

### Recorded red failure (mission parent commit `c248c7c54`, harness unchanged)

```
✖ TASK-2377: Ctrl+C through the PTY smoke harness still yields an observable terminal-restore postcondition
  Error: ENOENT: no such file or directory, open '/tmp/parallix-pty-smoke-M3FKjj/stty-after'
      at async Object.terminalRestored (test/helpers/pty-smoke-harness.ts:161:29)
      at async TestContext.<anonymous> (test/task-2377-sigint-pty-repro.test.ts:43:7)
    errno: -2, code: 'ENOENT', syscall: 'open'
```

Reproduced 8/8: `for i in $(seq 1 8); do node --import tsx test/task-2377-sigint-pty-repro.test.ts; done`
exited 1 on every run, each with `ENOENT … /stty-after` raised from `terminalRestored()`.
This matches the mission's stop-rule requirement that the red failure be the
terminal-restore assertion and nothing else.

Suite placement was checked: `buildTestRunPlan` (`test/lib/test-run-plan.ts`) puts the new
file in the default suite, alongside its sibling `test/task-2373-shutdown.test.ts`, so
`./scripts/verify-local.sh all` will run it.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| CR-1 (first half): reproduction test exists and is red on the parent commit, failing on the terminal-restore assertion | `test/task-2377-sigint-pty-repro.test.ts`; `node --import tsx test/task-2377-sigint-pty-repro.test.ts` exits 1 with `ENOENT … /stty-after` thrown from `terminalRestored()` in `test/helpers/pty-smoke-harness.ts` | PASS |
| Red failure is deterministic, not a one-off | 8/8 red across `for i in $(seq 1 8); do node --import tsx test/task-2377-sigint-pty-repro.test.ts; done`, test name `"TASK-2377: Ctrl+C through the PTY smoke harness still yields an observable terminal-restore postcondition"` | PASS |
| Test authored before any fix (bug mission red-to-green, DoD #6) | `test/helpers/pty-smoke-harness.ts` and `src/interfaces/tui/ui-command.ts` are unmodified in this commit; only the new test file is added | PASS |
| CR-6: no `.only`, no unannotated `.skip` in the new file | `test/task-2377-sigint-pty-repro.test.ts`; hygiene gate `test/test-hygiene.test.ts` | PASS |
| Test runs under the mission's gate suite | `test/lib/test-run-plan.ts` classifies `task-2377-sigint-pty-repro.test.ts` into the default suite executed by `./scripts/verify-local.sh all` | PASS |

Next action: CP 2 — rework `test/helpers/pty-smoke-harness.ts` so the after-state `stty -g`
capture is taken by the test process from the tty device fd after the launched pid is gone,
delete the outer shell's `stty-after` write, and drive
`test/task-2377-sigint-pty-repro.test.ts` green.
