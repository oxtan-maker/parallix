# CP-1: Failing regression test authored and red result recorded

## Summary

Checkpoint 1 is complete. The regression test `test/task-2231-unit-tests-hang-repro.test.js` reproduces the draft custom-agent launch/retry hang: a draft-stage `startAgent` run whose first attempt (custom → opencode) dies with SIGKILL and must retry onto the next eligible agent (vibe). The scenario runs in a child process under the repository test bootstrap (`test/bootstrap-parallix-home.js`), with `OPENCODE_BIN` pointing at a controlled "expensive CLI" stand-in that records every invocation and sleeps far past the bound — simulating the operator workstation where the hang was observed.

Behavior examined: `resolveOpencodeCommand()` (`lib/agents/opencode.ts:106`) prefers the `OPENCODE_BIN` env var over `PATH`, so the bootstrap harness's PATH-shadowing fake launchers (`test/bootstrap-parallix-home.js:31`) are bypassed and the draft launch/retry path starts the operator's real opencode CLI — an unmocked expensive child process. The red run's diagnostic recorded the exact launch from the backlog report: `run --pure --dangerously-skip-permissions --format json …`.

## Red parent-commit result

Command: `node --require ./test/bootstrap-parallix-home.js --test test/task-2231-unit-tests-hang-repro.test.js` at parent commit 2e139d499 (no fix applied).

```
✖ draft custom-agent signal retry settles within its bound and never launches the OPENCODE_BIN override (10006.873817ms)
  AssertionError [ERR_ASSERTION]: draft signal-retry scenario did not settle within 10000ms — an unmocked
  expensive launch is hanging the unit test. Recorded expensive-CLI invocations: --help
  --format json --help
  run --pure --dangerously-skip-permissions --format json Do not spawn more than 2 parallel subagents. ...
```

The explicit bounded-completion assertion is `REPRO_COMPLETION_BOUND_MS = 10_000` raced against child exit at `test/task-2231-unit-tests-hang-repro.test.js:32` and asserted at `test/task-2231-unit-tests-hang-repro.test.js:133`. The red run fails the bound cleanly (no runner hang, no forced termination of the test runner itself).

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Regression test reproduces draft launch failure + retry, red at parent commit within explicit bound | `test/task-2231-unit-tests-hang-repro.test.js:32` (bound), `:133` (assertion); red run of `node --require ./test/bootstrap-parallix-home.js --test test/task-2231-unit-tests-hang-repro.test.js` above; test `"draft custom-agent signal retry settles within its bound and never launches the OPENCODE_BIN override"` | RED RECORDED (green pending CP-2 fix) |
| Fixed test path never invokes the real custom-agent CLI; double records attempted launch and provides failure/retry result | Expensive stand-in + `invoked.log` marker at `test/task-2231-unit-tests-hang-repro.test.js:57-64`; PATH doubles for SIGKILL/retry at `test/task-2231-unit-tests-hang-repro.test.js:70-77` | PENDING (fix in CP-2) |
| Focused draft-launch tests complete without open handles, forced termination, `.only`, or bare `.skip` | `test/task-2231-unit-tests-hang-repro.test.js` contains no `.only`/`.skip`; verification deferred to CP-3 run of `npm test` | PENDING |
| Existing draft watchdog, cwd/PWD, and non-draft watchdog assertions retained | Tests `"draft launch shows agent-stage in no-output watchdog messages"`, `"draft launch preserves the mission worktree in cwd and PWD for child CLIs"`, `"non-draft launch uses generic no-output watchdog"` in `test/agents.test.js` — untouched | PASS (unchanged so far) |
| `./scripts/verify-local.sh all` passes on the completed mission tree | `./scripts/verify-local.sh all` | PENDING (CP-3) |

Next action: implement the CP-2 harness fix — neutralize the `OPENCODE_BIN`/`PI_BIN` launcher-bypass env vars in `test/bootstrap-parallix-home.js` so the PATH safety-net fakes control every unit-test launch, then confirm the regression test turns green.
