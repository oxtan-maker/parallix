# CP-2 — harness fix (terminal-restore postcondition leaves the blast radius)

## Work done

Reworked `test/helpers/pty-smoke-harness.ts` so that no terminal postcondition is produced
by a process that Ctrl+C can kill.

**Removed from the outer `script` shell**
- the `stty -g > stty-after` write (the file the flake reported as `ENOENT`), and
- the `stty "$(cat stty-before)"` restore that ran right after it.

Both lived inside the Ctrl+C foreground process group. Nothing reads `stty-after` any more;
the path no longer exists in the harness.

**Moved into the test process**
- `terminalRestored()` now compares the pre-launch `stty -g` capture against an after-state
  that *this* process reads from the PTY device fd (`readStty(device, '-g')`, the same fd
  mechanism the harness already used for `runStty`/raw-mode detection). The test process is
  not in the PTY session, so no signal delivered through the line discipline can skip it.
- `waitForExit(ms)` now waits for the **launched process's own pid** to disappear (polled by
  the test process) rather than for the `script` wrapper to exit, then captures the
  after-state immediately, then reads the launched process's real exit status.
- `waitForExit` returns the launched process's `$?` (published by the shell to a `status`
  file) instead of the wrapper's code, so `128 + n` versus a numeric code is now
  distinguishable by callers — the property CP 3's board tests need.

**Two supporting changes that make the above possible**
- `trap 'true' INT` in the outer shell. A trap bound to a command is reset to the default
  disposition in the forked child, so the launched process still receives the SIGINT
  unmodified; only the shell survives it, which keeps the PTY device open long enough for
  the test process to read the final terminal state.
- After the launched process exits, the shell holds the PTY (bounded loop, 400 × 0.05 s).
  The test process releases the session by terminating the wrapper as soon as it has
  captured the after-state, so the hold costs nothing in the normal path. No release marker
  file is written: the harness's capability guard (`"PTY smoke harness: has no agent,
  Forgejo, repository-write, or network capability"`) forbids `writeFile` in this file, and
  that guard is kept green rather than relaxed.

**The postcondition still has teeth.** With the shell's restore gone, the comparison now
measures what the launched process actually left behind. A probe process that enables raw
mode and then SIGKILLs itself reports `terminalRestored() === false`; the reproduction test
(no raw mode) reports `true`.

## Verification

| Command | Result |
|---|---|
| `node --import tsx test/task-2377-sigint-pty-repro.test.ts` | pass 1, fail 0 (was 8/8 red in CP-1) |
| `node --import tsx test/tui-pty-smoke.test.ts` | pass 2, fail 0 |
| `node --import tsx test/task-2373-shutdown.test.ts` | pass 9, fail 0 |

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| CR-1 (second half): the reproduction test is green after the harness fix | `node --import tsx test/task-2377-sigint-pty-repro.test.ts` → pass 1 / fail 0; `test/task-2377-sigint-pty-repro.test.ts` | PASS |
| CR-5: harness contains no read of `stty-after` | `grep -n 'stty-after' test/helpers/pty-smoke-harness.ts` returns nothing; the shell command list in `test/helpers/pty-smoke-harness.ts` no longer contains that redirect | PASS |
| CR-5: `terminalRestored()` compares a test-process after-exit capture on the tty device against the pre-launch capture | `test/helpers/pty-smoke-harness.ts` — `readStty(device, '-g')` invoked from `captureAfterState()` after the launched pid is gone, compared with `stty-before` | PASS |
| No postcondition depends on a process inside the Ctrl+C blast radius | `test/helpers/pty-smoke-harness.ts`; test name `"TASK-2377: Ctrl+C through the PTY smoke harness still yields an observable terminal-restore postcondition"` passes with the outer shell inside the signalled process group | PASS |
| The postcondition is not vacuous after removing the shell's restore | Probe: a launched process that sets raw mode and SIGKILLs itself yields `terminalRestored() === false`; the non-raw reproduction yields `true` (`test/task-2377-sigint-pty-repro.test.ts`) | PASS |
| Existing harness consumers unaffected | `node --import tsx test/tui-pty-smoke.test.ts` (pass 2/0, including `"PTY smoke harness: has no agent, Forgejo, repository-write, or network capability"`) and `node --import tsx test/task-2373-shutdown.test.ts` (pass 9/0, TASK-2375 in-flight detach tests included) | PASS |

Next action: CP 3 — register the SIGINT handler in `src/interfaces/tui/ui-command.ts` so a
signal arriving before Ink's raw mode is active still unmounts the app and restores the
terminal, add pre-raw-window regression tests to `test/task-2373-shutdown.test.ts`, and
rebuild `build/px.mjs` with `npm run build` before the PTY runs.
