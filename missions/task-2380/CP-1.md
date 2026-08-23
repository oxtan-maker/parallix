# CP-1: Failing reproduction for Claude stale-session resume failure

## Work done
Added a red-to-green reproduction in `test/claude.test.ts` before any fix. Two tests simulate a Claude launch resumed from a stored marker (`resume: true`, `sessionId: 'ses_stale'`) whose spawn reports the real CLI missing-session message `No conversation found with session ID: <id>` — one on stderr, one on stdout. Assertions require: spawn twice (stale then fresh), original invocation keeps `--resume`, stored marker deleted through the `SessionMarkerPort`, and final result status 0. At the parent commit these are red because `isStaleSessionResult` in `src/adapters/agents/claude.ts` only matches `Session not found`.

Committed as `34d6ec081 test(task-2380): add failing Claude stale-session reproduction`. The parent commit `8bf63ffe2` is the red baseline.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| First committed test is `test/claude.test.ts` and reproduces the real missing-session resume result at parent commit | `test/claude.test.ts`, tests `startClaudeAgent retries without --resume when spawn reports No conversation found with session ID` / `startClaudeAgent recognizes No conversation found on stdout too` fail at parent commit `8bf63ffe2` | PASS |
| Red assertions capture marker deletion + fresh no-resume relaunch | `test/claude.test.ts` asserts `spawnCount === 2`, `invocation.args.includes('--resume')`, `mockSessionPort.deleted`, `result.status === 0` | PASS |

## Gates
- `./scripts/verify-local.sh static-analysis` — not yet run for this checkpoint (test-only change; will run at mission end).

## Next action
Implement the narrowly scoped Claude detector in `src/adapters/agents/claude.ts` (recognize `No conversation found with session ID`) and extend `NON_BLOCKING_LAUNCH_ERROR_PATTERNS` in `src/adapters/agents/agents.ts` so the stale-session resume result cannot persist an `AgentBlock` (CP-2).
