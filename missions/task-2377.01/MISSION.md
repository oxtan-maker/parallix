# Mission: Fix board Ctrl+C shutdown race and PTY terminal-restore postcondition (task-2377.01)

Reproduction-Test: test/task-2377-sigint-pty-repro.test.ts

## Goal
Make Ctrl+C shutdown of a real `px board` deterministic and make the PTY smoke harness's terminal-restore postcondition structurally signal-safe. Two coordinated changes:

1. **Board**: register a SIGINT handler that performs the same clean exit as the Ctrl+C key path (Ink app unmount, raw-mode restore, numeric exit code instead of death-by-signal). This also fixes a real user bug: Ctrl+C during board startup currently hard-kills the board with no cleanup, although `docs/tui-board.md` documents Ctrl+C as a board exit key.
2. **Harness** (`test/helpers/pty-smoke-harness.ts`): the terminal-restore comparison no longer reads `stty-after` from the outer shell's temp directory. The test process captures the after-state from the tty device itself, after `waitForExit`, and compares against the pre-launch capture. No postcondition may depend on a process inside the Ctrl+C signal blast radius.

Both changes are required to make SC20 stop flaking with `ENOENT: .../stty-after`.

## Why Now
SC20 (`Ctrl+C terminates a real idle px board and leaves its spawned PID gone`, `test/task-2373-shutdown.test.ts`) is flaky with `ENOENT: .../stty-after`, blocking a green integration of the deterministic-shutdown work (TASK-2373 family). Root cause is verified, in two parts:

- **Board**: Ink v6's `exitOnCtrlC` only handles the `\x03` *byte* on stdin (see `node_modules/ink/build/components/App.js`); it installs no process-level SIGINT handler. If Ctrl+C lands before Ink's raw mode is active (raw mode is enabled in a `useEffect` after the first frame paints), the PTY line discipline converts 0x03 into a SIGINT delivered to the PTY session's foreground process group. With no handler registered anywhere in Parallix or Ink, the board dies by signal (WIFSIGNALED).
- **Harness**: the outer `script` shell runs without job control and shares that foreground group, so it dies with the board before writing `stty-after`; the terminal-restore assertion then fails with ENOENT. The postcondition depends on a process inside the blast radius — structurally unreliable. Additionally `script` uses `$SHELL` for its outer shell, and dash exits on this path even when the child handles the signal cleanly, so outcomes are machine-dependent.

## Refinement Signals
- Predicted NEL bucket: Medium (81–235)
- Confidence: High
- Selection note: activate as-is
- Main drivers: board SIGINT handler in `src/interfaces/tui/ui-command.ts` (~20 lines); harness after-capture rework in `test/helpers/pty-smoke-harness.ts` (~40 lines); new red reproduction test file; new pre-raw-window regression tests in `test/task-2373-shutdown.test.ts`.

## Scope
- Board: SIGINT handler in `src/interfaces/tui/ui-command.ts` (the `runUiCommand` Ink render site) performing the same clean exit as the Ctrl+C key path (Ink app exit → unmount → raw-mode restore → numeric exit code). Must cover signals arriving before and after raw mode is active, and be idempotent under repeated signals.
- Harness: `test/helpers/pty-smoke-harness.ts` — after-state terminal settings captured by the test process from the tty device fd (the harness already opens that fd for `runStty`/`getSttyA`) after `waitForExit`; compared against the pre-launch capture. The outer shell stops writing `stty-after`.
- New red reproduction test `test/task-2377-sigint-pty-repro.test.ts` (CP 1) locking the bug before any fix is written.
- Board-side regression coverage in `test/task-2373-shutdown.test.ts` for SIGINT/Ctrl+C delivered in the pre-raw-mode window.
- Rebuild of the bundled CLI (`npm run build`) before PTY-test runs, since the tests launch `build/px.mjs`.

## Out of Scope
- Patching or forking Ink. The fix must live in Parallix source; if a fix requires changing Ink, stop (see Stop Rules).
- Board key handling, navigation, or confirmation-dialog logic beyond signal registration.
- TASK-2375 in-flight-dispatch shutdown semantics (fire-and-forget detach; child reaped by SIGHUP/group-broadcast SIGINT, never a board-sent signal). Those tests must stay green unchanged.
- Replacing the `script`/util-linux launch mechanism, and moving the `stty-before` pre-launch capture (it is written by the shell before launch, outside the blast radius, and is safe to keep).
- `test/helpers/sea-pty-session.ts` (separate harness, untouched by this mission).
- New authored documentation: `docs/tui-board.md` already documents `q`/Ctrl+C as board exit; this fix makes the code match the doc, so no doc change is expected.

## Success Criteria
> **Falsifiability rule (ADR 0039 Part 2):** Each criterion must be falsifiable. Forbidden: subjective adjectives ("easy, fast, simple, intuitive, user-friendly, responsive, quick, efficient" without an attached metric) and vague quantifiers ("multiple, several, some, many, few, various"). For refactor / condense / migration missions, the criterion must enumerate the specific elements (rules, files, behaviours) that must survive — generic phrases like "preserve critical content" are not sufficient.

- CR-1: `test/task-2377-sigint-pty-repro.test.ts` fails on the mission's parent commit on the terminal-restore assertion (ENOENT on `stty-after`; reproduced 8/8 during investigation) and passes after the fix.
- CR-2: `SC20: Ctrl+C terminates a real idle px board and leaves its spawned PID gone` passes on 10 consecutive runs of `node --import tsx test/task-2373-shutdown.test.ts` (0 of 10 failures).
- CR-3: In the same 10 runs, `SC19: q terminates a real idle px board and leaves its spawned PID gone`, `SC22: SIGTERM terminates the real interactive board cleanly`, `SC26: ten real start-and-quit cycles leave every spawned board PID gone`, `TASK-2373 defect 6: q terminates a real px board while a confirmation dialog is armed`, and `TASK-2373 defect 6: Ctrl+C terminates a real px board while a confirmation dialog is armed` all pass.
- CR-4: SIGINT delivered to a real board process — raw mode on or off — exits with a numeric exit code (not WIFSIGNALED), `terminalRestored()` is `true`, and the spawned PID is gone; both cases are covered by named tests in `test/task-2373-shutdown.test.ts`.
- CR-5: `test/helpers/pty-smoke-harness.ts` contains no read of `stty-after`; `terminalRestored()` compares a test-process after-exit capture against the pre-launch capture on the tty device.
- CR-6: No `.only` and no unannotated `.skip` in any changed test file (test-hygiene gate clean).

## Risks and Assumptions
- The race window is timing-dependent: Ink enables raw mode in a `useEffect` after the first frame, so a test exercising the pre-raw window must send the byte immediately after the top bar is observed. Red-on-parent reproducibility of the reproduction test was observed 8/8 during investigation; a single non-reproduction is not a pass — re-run before concluding.
- `script` uses `$SHELL` for its outer shell; dash and bash differ in signal behavior on this path. The harness fix must remove the assertion's dependence on outer-shell survival so outcomes no longer vary by `$SHELL`; verify on both shells where available.
- Real-PTY tests are slow under load. The 10-consecutive-run check is the stability evidence; do not shorten assertion budgets (launch 20 s, shutdown 5 s) to make runs fit.
- The PTY tests run the bundled CLI (`build/px.mjs`), not `src/`. A board-side fix with a stale bundle will look like a no-op; rebuild with `npm run build` before PTY runs.
- Assumption: the Ink unmount path restores raw mode reliably when triggered from a SIGINT handler. If unmount hangs under signal, the Stop Rules apply — do not fall back to a hard `process.exit()` that skips the terminal restore.

## Checkpoints
- CP 1 (red reproduction — lock the bug): Author `test/task-2377-sigint-pty-repro.test.ts` **before any fix**. Scenario: a bare long-running node process (idle `node -e` loop), launched through the existing `launchPtySmoke` harness, receives a single Ctrl+C (`\u0003`) after startup output is observed; the test asserts the session exits and `terminalRestored()` resolves `true` (no ENOENT). The test must fail (red) on the parent commit with the terminal-restore assertion; record the exact failure output in CP-1.md. It goes green only after CP 2.
- CP 2 (harness fix): Rework `test/helpers/pty-smoke-harness.ts` so the outer shell no longer writes `stty-after`. After `waitForExit`, the test process opens the tty device fd, captures `stty -g`, and compares against the pre-launch capture inside `terminalRestored()`. The reproduction test must go green.
- CP 3 (board fix + pre-raw coverage): Register the SIGINT handler in `src/interfaces/tui/ui-command.ts` performing the same clean exit as the Ctrl+C key path (idempotent; correct for raw mode on and off). Add regression tests in `test/task-2373-shutdown.test.ts` asserting clean exit (numeric code), terminal restore, and PID-gone for Ctrl+C/SIGINT delivered in the pre-raw-mode window. Rebuild the bundle (`npm run build`) before running PTY tests.
- CP 4 (regression + gates): Run `node --import tsx test/task-2373-shutdown.test.ts` 10 consecutive times — SC19/SC20/SC22/SC26 and both armed-confirmation variants green every run; reproduction test green; no `.only`/`.skip`. Then `npm run build` and `./scripts/verify-local.sh all` green on the final tree. Record the complete Goal Check table in CP-4.md.

### Checkpoint Documentation Requirements
Every checkpoint document (CP-N.md) MUST include:
- A summary of work done
- A `## Goal Check` section (exact heading)
- A 3-column pipe-delimited markdown table with columns: `| Criterion | Evidence | Status |`
- At least one evidence row per criterion using durable, verifiable references. Parallix already accepts, in preference order:
  1. **Recognized repo commands or paths** — e.g. `` `node --import tsx test/task-2373-shutdown.test.ts` ``, `` `npm run build` ``, `` `./scripts/verify-local.sh all` ``, or `` `test/helpers/pty-smoke-harness.ts` ``
  2. **Exact test names** — e.g. `"SC20: Ctrl+C terminates a real idle px board and leaves its spawned PID gone"` (must match a test name in the repo)
  3. **Test file paths** — e.g. `test/task-2377-sigint-pty-repro.test.ts` (must be an existing test file)
  4. **ADR references** — e.g. `ADR 0039` (must correspond to an existing file under `docs/adr/`)
  5. **File:line references** — accepted parenthetically when needed, but line numbers eventually rot; prefer the forms above
- Weak-evidence failure mode: raw `stat`/`ls` output or generic prose ("ran the tests, looks green") alone is **not** enough. If you quote shell output (e.g. a test-runner transcript showing 10 green SC20 runs), pair it with one of the accepted references above — the command that produced it and/or the exact test name it ran.
- A non-generic `Next action:` line at the bottom

Example Goal Check table (CP-4):

| Criterion | Evidence | Status |
|---|---|---|
| Reproduction test locks the bug, red then green | `test/task-2377-sigint-pty-repro.test.ts`, red failure recorded in CP-1.md, `node --import tsx test/task-2377-sigint-pty-repro.test.ts` | PASS |
| SC20 green on 10 consecutive runs | `node --import tsx test/task-2373-shutdown.test.ts`, `"SC20: Ctrl+C terminates a real idle px board and leaves its spawned PID gone"` | PASS |
| Harness no longer reads `stty-after` | `test/helpers/pty-smoke-harness.ts` | PASS |
| Verification gate green on final tree | `./scripts/verify-local.sh all` | PASS |

## Gates
- [ ] npm run build
- [ ] ./scripts/verify-local.sh all

## Restricted Areas
- `node_modules/ink` — no patching or vendoring Ink; the fix lives in Parallix source.
- `test/helpers/sea-pty-session.ts` — separate harness; untouched by this mission.
- The backlog task file's `assignee` field — workflow-owned; do not edit.
- `backlog/tasks/` — no new or modified backlog tasks from this mission.
- `origin` (GitHub) remote — mission branches must never be pushed to origin; `review` (Forgejo) is the sole push target for code review.
- `graphify-out/` — generated; do not hand-edit (run `graphify update .` after code changes instead).

## Stop Rules
- Stop and re-investigate if the reproduction test cannot be made red on the parent commit, or if the red failure is not the terminal-restore assertion (ENOENT on `stty-after`) — the assumed root cause would be wrong.
- Stop and escalate if the board fix requires patching Ink or a hard `process.exit()` that bypasses the terminal restore.
- Stop and investigate if SC20 fails more than 1 of 10 consecutive runs after both fixes land — the race is not fully closed; never skip, focus, or annotate-skip a test to force green.
- Stop if the only path to green is `.only`, `.skip`, or shortening the launch/shutdown assertion budgets.
- Stop if `stty -g` comparison proves machine-variant (environment-dependent flags) in a way that cannot be reconciled by comparing the same flags both sides capture — widen the comparison contract deliberately rather than weakening the assertion silently.
