# CP-3: Final verification — focused test and full gate green

## Summary

Checkpoint 3 is complete. The mission examined the draft custom-agent launch/retry path: `resolveOpencodeCommand()` (`lib/agents/opencode.ts:106`) preferred the operator's `OPENCODE_BIN` env override over the PATH fake launchers installed by `test/bootstrap-parallix-home.js`, so the signal-failure/retry unit tests could launch the real opencode CLI and hang the suite. The fix (`test/bootstrap-parallix-home.js:28-34`) deletes `OPENCODE_BIN`/`PI_BIN` in the shared test bootstrap; production launch, retry, and watchdog behavior are unchanged. The red-to-green regression contract is held by `test/task-2231-unit-tests-hang-repro.test.js` (red recorded in CP-1 at parent commit 2e139d499; green after the CP-2 fix).

## Verification runs

- Focused test command: `node --require ./test/bootstrap-parallix-home.js --test test/task-2231-unit-tests-hang-repro.test.js` → `✔ draft custom-agent signal retry settles within its bound and never launches the OPENCODE_BIN override (183ms)`, 1 pass / 0 fail / 0 skipped, runner exited cleanly.
- Full gate: `./scripts/verify-local.sh all` → exit 0; 2122 tests, 2099 pass, 0 fail, 23 skipped (all pre-existing annotated skips). The regression test ran green inside the suite.
- Lint/static analysis on changed files: `npx eslint test/bootstrap-parallix-home.js test/task-2231-unit-tests-hang-repro.test.js` → exit 0; `bash scripts/test-hygiene.sh` → `PASS: no test-hygiene violations`.
- Worst-case environment replay (CP-2): full `test/agents.test.js` with `OPENCODE_BIN` exported to an invocation-recording stand-in → 91 pass / 0 fail and zero recorded invocations of the stand-in.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Regression test at `test/task-2231-unit-tests-hang-repro.test.js` reproduces draft launch failure + retry; red at parent commit within explicit bound, green after fix | Red run recorded in CP-1 at 2e139d499 (bound `REPRO_COMPLETION_BOUND_MS` at `test/task-2231-unit-tests-hang-repro.test.js:32`, assertion at `test/task-2231-unit-tests-hang-repro.test.js:133`); green focused run of `node --require ./test/bootstrap-parallix-home.js --test test/task-2231-unit-tests-hang-repro.test.js`; test `"draft custom-agent signal retry settles within its bound and never launches the OPENCODE_BIN override"` | PASS |
| Fixed test path never invokes the real configured custom-agent CLI; test double records the attempted launch command and provides the failure/retry result | Env neutralization at `test/bootstrap-parallix-home.js:28-34`; invocation-recording expensive stand-in at `test/task-2231-unit-tests-hang-repro.test.js:57-64`; SIGKILL-failure/retry PATH doubles at `test/task-2231-unit-tests-hang-repro.test.js:70-77`; marker assertion at `test/task-2231-unit-tests-hang-repro.test.js:146` (zero invocations recorded in green runs) | PASS |
| Focused draft-launch tests complete under the repository test command without open handles, forced termination, `.only`, or bare `.skip` | `./scripts/verify-local.sh all` (runs `npm test`) exited 0 with 0 failures and no forced termination; `bash scripts/test-hygiene.sh` clean; only skip in `test/agents.test.js` is the pre-existing annotated conditional at `test/agents.test.js:244` (task-1302) | PASS |
| Existing assertions verify draft watchdog stage messages, mission-worktree `cwd`/`PWD` propagation, and non-draft generic watchdog | Tests `"draft launch shows agent-stage in no-output watchdog messages"`, `"draft launch preserves the mission worktree in cwd and PWD for child CLIs"`, `"non-draft launch uses generic no-output watchdog"` in `test/agents.test.js` (`test/agents.test.js:1656`, `test/agents.test.js:1704`, `test/agents.test.js:1740`) — file unchanged, all green in the gate run | PASS |
| `./scripts/verify-local.sh all` passes on the completed mission tree | `./scripts/verify-local.sh all` → exit 0 (2122 tests, 0 fail) | PASS |

## Gates

- [x] `./scripts/verify-local.sh all` — exit 0 on the completed mission tree.

Next action: hand off to review — all checkpoints committed, mission gates green, backlog Definition of Done checked off with evidence in CP-1..CP-3.
