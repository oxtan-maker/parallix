# CP-3 — board SIGINT handler + pre-raw regression coverage

## Work done

### Board (`src/interfaces/tui/ui-command.ts`)

`runUiCommand` now registers a process-level SIGINT handler that takes the same clean exit
path as the Ctrl+C key: `instance.unmount()` → Ink's own teardown → raw-mode restore →
numeric exit code from `waitUntilExit()`.

Details that matter:

- **Registered before the projection build**, not just around `render`, so a signal arriving
  during board startup is handled too. `docs/tui-board.md` already documents `q`/`Ctrl+C` as
  the board exit keys (lines 154 and 164); this makes the code match the doc. No doc change
  is needed.
- **Correct on both sides of Ink's raw-mode window.** Ink's `exitOnCtrlC` only recognises the
  0x03 *byte*, which it can only see after its raw-mode effect has run. Until then the line
  discipline is cooked and Ctrl+C is a SIGINT to the foreground process group — previously
  unhandled, so the board died by signal (status 130, WIFSIGNALED) with no unmount and no
  terminal restore.
- **Idempotent under repeated signals**: `process.on` (not `once`, which would leave the
  second Ctrl+C to the default kill action) plus an `exitRequested` flag; Ink's `unmount` is
  a no-op after the app has exited. The first signal additionally installs a no-op absorber
  that outlives the handler's own removal: without it, a later Ctrl+C landing after the app
  unmounted but before the process finished winding down hit SIGINT's default action and
  turned a clean shutdown into status 130. That was measured at 3/12 failures on
  `"TASK-2377: repeated SIGINT during board shutdown still exits with a numeric code"`
  before the absorber, and 12/12 green after.
- **No `process.exit()`**: the terminal restore is never bypassed, per the mission's stop rule.
- **Handles the two ordering edges**: signalled before `render` returns (the flag is checked
  right after `render`), and signalled before anything took the terminal at all (returns 0
  without painting a frame).
- The listener is removed in a `finally`, so no listener leaks into other commands or into
  in-process tests.

Ink is untouched (`node_modules/ink` is a restricted area).

### Tests (`test/task-2373-shutdown.test.ts`)

Four named regression tests, asserting for each delivery: exit status **0** (a status of
`128 + n` would mean death by signal — the harness now reports the launched process's own
`$?`, so the two are distinguishable), `terminalRestored() === true`, and the spawned pid gone.

- `"TASK-2377: SIGINT while the board is not in raw mode exits with a numeric code"`
- `"TASK-2377: SIGINT after Ink enables raw mode exits the real board with a numeric code"`
- `"TASK-2377: Ctrl+C typed while the line discipline is cooked exits with a numeric code"`
- `"TASK-2377: repeated SIGINT during board shutdown still exits with a numeric code"`

**How the non-raw cases are made deterministic.** A first attempt delivered the signal
immediately after launch, before the first frame. That failed at ~40 ms with status 130 for a
reason no application fix can address: the signal landed before the 3.1 MB bundle had finished
loading, so *no* handler existed yet in any process. Racing the board's startup would also be
timing-dependent, which the mission explicitly warns about. Instead the tests wait for raw
mode, then put the line discipline back into canonical signalling mode from the **test**
process (new `leaveRawMode()` on the harness, `stty icanon isig` on the device fd) and assert
`isRaw() === false` before delivering. Only `icanon`/`isig` are touched, so the terminal state
still differs from the pre-launch capture and `terminalRestored()` keeps its teeth.

### Harness additions (`test/helpers/pty-smoke-harness.ts`)

`isRaw()` and `leaveRawMode()` — both read/act on the tty device from the test process, in
keeping with CP-2's rule that nothing inside the signal blast radius is trusted. `runStty` was
generalised from a resize-only helper to take a settings list.

## Proof the board fix is load-bearing

With `src/interfaces/tui/ui-command.ts` reverted to the parent-commit version and the bundle
rebuilt (`npm run build`), all four new tests fail with `actual: 130, expected: 0` —
i.e. the board died by SIGINT. With the fix restored and rebuilt, all four pass.

```
✖ TASK-2377: SIGINT while the board is not in raw mode exits with a numeric code       actual: 130, expected: 0
✖ TASK-2377: SIGINT after Ink enables raw mode exits the real board with a numeric code actual: 130, expected: 0
✖ TASK-2377: Ctrl+C typed while the line discipline is cooked exits with a numeric code actual: 130, expected: 0
✖ TASK-2377: repeated SIGINT during board shutdown still exits with a numeric code      actual: 130, expected: 0
ℹ pass 0  ℹ fail 4
```

## Verification

`npm run build` then `node --import tsx test/task-2373-shutdown.test.ts`: **tests 13, pass 13,
fail 0** — SC19, SC20, SC22, SC26, both armed-confirmation variants, the four new TASK-2377
tests, and the three TASK-2375 in-flight-dispatch tests (unchanged semantics: the detached
child is still reaped by SIGHUP or the Ctrl+C group broadcast).

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Board registers a SIGINT handler taking the Ctrl+C key path (unmount → raw-mode restore → numeric code) | `src/interfaces/tui/ui-command.ts` (`requestExit` → `instance.unmount()`, exit code from `waitUntilExit()`) | PASS |
| CR-4: SIGINT with raw mode **off** exits with a numeric code, terminal restored, pid gone | `"TASK-2377: SIGINT while the board is not in raw mode exits with a numeric code"` and `"TASK-2377: Ctrl+C typed while the line discipline is cooked exits with a numeric code"` in `test/task-2373-shutdown.test.ts` | PASS |
| CR-4: SIGINT with raw mode **on** exits with a numeric code, terminal restored, pid gone | `"TASK-2377: SIGINT after Ink enables raw mode exits the real board with a numeric code"` in `test/task-2373-shutdown.test.ts` | PASS |
| Handler is idempotent under repeated signals | `"TASK-2377: repeated SIGINT during board shutdown still exits with a numeric code"` (three SIGINTs, exit status 0) | PASS |
| The board fix is load-bearing (red without it) | Parent-commit `src/interfaces/tui/ui-command.ts` + `npm run build` → all four TASK-2377 tests fail `actual: 130, expected: 0`; fixed source + `npm run build` → pass | PASS |
| No Ink patch, no `process.exit()` bypassing the restore | `src/interfaces/tui/ui-command.ts` contains no `process.exit`; `node_modules/ink` unmodified | PASS |
| TASK-2375 in-flight detach semantics unchanged | `node --import tsx test/task-2373-shutdown.test.ts` → the three `"TASK-2375 SC3: …"` tests pass | PASS |
| Bundle rebuilt before PTY runs (tests exercise `build/px.mjs`) | `npm run build` (`[bundle-size] PASS: 3.1 MB within 5 MB stop rule`) run before every PTY execution above | PASS |
| DoD #5: docs already describe the behaviour, so no doc change | `docs/tui-board.md` lines 154 and 164 document `q`/`Ctrl+C` as board exit | PASS |

Next action: CP 4 — run `node --import tsx test/task-2373-shutdown.test.ts` 10 consecutive
times and record SC19/SC20/SC22/SC26 plus both armed-confirmation variants green on every run,
then `npm run build` and `./scripts/verify-local.sh all` on the final tree.
