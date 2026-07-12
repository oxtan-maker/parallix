# CP-2: Harness fix — neutralize *_BIN launcher bypasses in the test bootstrap

## Summary

Checkpoint 2 is complete. Tracing the CP-1 reproduction through the draft launcher showed the escape hatch: `resolveOpencodeCommand()` checks `process.env.OPENCODE_BIN` before `PATH` (`lib/agents/opencode.ts:106`), and `resolvePiCommand()` does the same with `PI_BIN` (`lib/agents/pi.ts:52`). The repository test bootstrap shadows `PATH` with harmless fake launchers (`test/bootstrap-parallix-home.js:39-48`) but left those env overrides intact, so an operator shell exporting `OPENCODE_BIN` handed the draft custom-agent launch/retry unit tests the real opencode CLI — an unmocked expensive `opencode run …` that hangs the suite. The watchdog/spawn-tee layer was inspected and is not the leak: `spawnAndTee` unrefs and clears its no-output watchdog timers on settle (`lib/core/spawn-tee.ts:121-156`).

Smallest implementation change: `test/bootstrap-parallix-home.js` now deletes `OPENCODE_BIN` and `PI_BIN` before installing the PATH safety net (`test/bootstrap-parallix-home.js:28-34`). No production launch, retry, or watchdog code changed. Tests that exercise the override behaviour set the vars themselves (`test/opencode.test.js:26`, `test/pi-runner.test.js:54`) and are unaffected.

## Verification on this checkpoint

- Regression test green: `node --require ./test/bootstrap-parallix-home.js --test test/task-2231-unit-tests-hang-repro.test.js` → `✔ draft custom-agent signal retry settles within its bound and never launches the OPENCODE_BIN override (182ms)`, 1 pass / 0 fail.
- Worst-case environment replay: full `test/agents.test.js` run with `OPENCODE_BIN` exported to the expensive stand-in → 92 tests, 91 pass, 0 fail, 1 pre-existing annotated skip (task-1302), and the stand-in recorded **zero** invocations.
- Retained coverage passed in that run: `"startAgent launch failure with signal retries next agent"`, `"draft launch shows agent-stage in no-output watchdog messages"`, `"draft launch preserves the mission worktree in cwd and PWD for child CLIs"`, `"non-draft launch uses generic no-output watchdog"`.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Regression test red at parent commit, green after fix | Red recorded in CP-1 at 2e139d499; green run of `node --require ./test/bootstrap-parallix-home.js --test test/task-2231-unit-tests-hang-repro.test.js`; test `"draft custom-agent signal retry settles within its bound and never launches the OPENCODE_BIN override"` | PASS |
| Fixed test path never invokes the real custom-agent CLI; double records attempted launch and provides failure/retry result | `test/bootstrap-parallix-home.js:28-34` (env neutralization); invocation-recording stand-in and marker assertion at `test/task-2231-unit-tests-hang-repro.test.js:57-64` and `:146-148`; zero recorded invocations in the green run | PASS |
| Focused draft-launch tests complete without open handles, forced termination, `.only`, or bare `.skip` | `test/agents.test.js` full run: 91 pass / 0 fail, runner exited cleanly; only skip is the annotated conditional at `test/agents.test.js:244` (pre-existing, task-1302); no `.only` in `test/task-2231-unit-tests-hang-repro.test.js` | PASS |
| Existing draft watchdog, cwd/PWD, and non-draft watchdog assertions retained | Tests `"draft launch shows agent-stage in no-output watchdog messages"`, `"draft launch preserves the mission worktree in cwd and PWD for child CLIs"`, `"non-draft launch uses generic no-output watchdog"` all pass in `test/agents.test.js`; file unchanged | PASS |
| `./scripts/verify-local.sh all` passes on the completed mission tree | `./scripts/verify-local.sh all` | PENDING (CP-3) |

Next action: run the final verification gate — focused execution of `test/task-2231-unit-tests-hang-repro.test.js` plus `./scripts/verify-local.sh all` — and record the CP-3 Goal Check.
