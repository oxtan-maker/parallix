# CP-2: Claude stale-session detector + non-blocking classification

## Work done
Implemented the narrowly scoped detector and recovery, and extended shared launch-failure classification so a recognized stale-session resume result cannot persist an `AgentBlock`.

- `src/adapters/agents/claude.ts` — `isStaleSessionResult` now matches both `Session not found` and the real CLI message `No conversation found with session ID:` on stdout or stderr, narrowly (retains the existing `Session not found` literal). The existing `staleSessionHandler` path deletes the failed agent/mission/phase marker via `sessionMarkerPort.delete(slug, role)` and relaunches the same Claude agent with `resume: false` (no `--resume`), so no other agent family is selected before the fresh relaunch.
- `src/adapters/agents/agents.ts` — added `/no conversation found with session id:/i` to `NON_BLOCKING_LAUNCH_ERROR_PATTERNS`, so `shouldPersistLaunchFailureBlock` returns false for the recognized stale-session resume error.

Committed `afb4b5d79`.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Claude resume recognizes `No conversation found with session ID` alongside `Session not found` on stdout/stderr | `test/claude.test.ts`: `startClaudeAgent retries without --resume when spawn reports No conversation found with session ID` (stderr) and `startClaudeAgent recognizes No conversation found on stdout too` (stdout) PASS | PASS |
| Stale marker deleted + same agent relaunched without `--resume`, no other family first | `test/claude.test.ts` asserts `spawnCount === 2`, `invocation.args.includes('--resume')`, `mockSessionPort.deleted === {missionId:'task-2380',role:'reviewer'}`, `result.status === 0` | PASS |
| Recognized stale-session resume never persists an `AgentBlock` | `test/agents-limit-hit.test.ts`: `shouldPersistLaunchFailureBlock returns false for Claude missing-session resume` asserts `false`; `shouldPersistLaunchFailureBlock returns true for transient crashes (ECONNRESET)` retained | PASS |
| Red-to-green reproduction locked in `test/claude.test.ts` | test is red at parent `1465939fd` (fix absent), green after fix `afb4b5d79` (`test/claude.test.ts`) | PASS |

## Gates
- `./scripts/verify-local.sh static-analysis` — not run in isolation this checkpoint (ran full at mission end, CP-3).

## Next action
Verify Codex and opencode real missing-session diagnostics, make only evidence-supported alignment changes, add focused coverage for every changed adapter, and run both required gates (CP-3).
