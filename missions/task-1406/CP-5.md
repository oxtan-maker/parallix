# CP-5: Unit Tests for processResult Wiring + Review Rounds 1-2 Fixes

## Summary

### Original Implementation (Round 0)
Added 10 new unit tests to `test/mistral.test.js` covering the `processResult` function:

1. **Null input handling** — returns `{sessionId: null, telemetry: null}`
2. **Empty object input** (isolated FS) — returns null telemetry when no sessions on disk
3. **Full telemetry population** — verifies all 9 fields match expected values from sample meta.json
4. **sessionId preservation** — input sessionId is preserved in output
5. **All-zero stats handling** — returns null telemetry when session has zero stats
6. **No session directories** — returns null telemetry for empty session dir
7. **Fallback to older session** — picks valid session when newer has zero stats
8. **getMistralProviderModel export** — verifies `{provider: 'mistral', model: 'mistral'}`
9. **Extra result fields preservation** — status, exitCode, stderr passed through

### Review Round 1 Fixes

**Finding 1 (Fixed): Telemetry misattribution risk**
- Rewrote `processResult` to inline its own session-scanning loop instead of calling `extractMistralTelemetry` (which always returned the globally newest session). The new loop reads each session's `meta.json` `start_time`, applies a 120-minute invocation window, and picks the session closest to the invocation start time.
- `startMistralAgent` now records `invocationStart` and passes it to `processResult`
- Added 5 new tests: within-window acceptance, too-old rejection, future-session rejection, missing start_time rejection, backward compatibility (no invocationStart)

**Finding 2 (Fixed): Undisclosed scope creep**
- Typescript bump from `^5.4.0 → ^5.9.3` was indeed part of the mission's round-0 diff. Reverted only the `typescript` line.
- `backlog/tasks/task-1408 - more-ts-errors.md` was deleted and has been restored from git history.
- Package.json was over-reverted in round-1; corrected in round-2 to only revert the `typescript` line.

### Review Round 2 Fixes

**Finding 1 (Fixed): package.json regression**
- The round-1 "revert scope creep" commit (`ff78ed37`) over-reverted `package.json` to an old snapshot (version 1.1.1, eslint ^8.57.0, @typescript-eslint ^7.0.0, removed tsx/build:cjs/pretest). Restored `package.json` from merge-base (`ca7a3522`) which has the correct pre-mission state with only `typescript: ^5.4.0` (matching the mission's original bump target).

**Finding 2 (Fixed): CP-5 Goal Check accuracy**
- Corrected all Goal Check citations to match the actual `processResult` implementation (no longer cites `extractMistralTelemetry` call or `isSessionScopedToInvocation` function).

All 41 tests pass (13 telemetry-stubs + 28 mistral including 15 new processResult tests).

## Goal Check

| Criterion | file:line | Evidence |
|-----------|-----------|----------|
| `processResult` scans sessions and correlates by start_time | `lib/agents/mistral.ts:58-157` | Inlined session-scanning loop with invocation window |
| `contextTokens` maps to `cachedTokens` | `lib/agents/mistral.ts:150` | `cachedTokens: bestTelemetry.contextTokens` |
| Tool calls aggregated correctly | `lib/agents/mistral.ts:136-140` | Sum of agreed+rejected+failed+succeeded |
| `sessionCost` maps to `cost_usd` | `lib/agents/mistral.ts:154` | `cost_usd: bestTelemetry.sessionCost` |
| `usagePercent` set to null | `lib/agents/mistral.ts:153` | `usagePercent: null` |
| `provider` and `model` set | `lib/agents/mistral.ts:145-147` | `provider: pm.provider, model` |
| `startMistralAgent` uses `processResult` | `lib/agents/mistral.ts:211` | `return processResult(result, undefined, invocationStart)` |
| `startMistralAgent` records invocationStart | `lib/agents/mistral.ts:206` | `const invocationStart = new Date().toISOString()` |
| Session scoping: start_time window filtering | `lib/agents/mistral.ts:108-111` | Rejects sessions outside 120-min window of invocationStart |
| Session scoping: picks closest match | `lib/agents/mistral.ts:122-126` | `Math.abs(sessionTime - invokeTime)` selects nearest session |
| `parseMistralMeta` test passes | `test/telemetry-stubs.test.js:67` | Test: "extracts telemetry from meta.json stats" |
| `extractMistralTelemetry` tests pass | `test/telemetry-stubs.test.js:113-225` | All 7 extract tests pass |
| `processResult` full telemetry test passes | `test/mistral.test.js:232` | Test: "populates telemetry with correct field names" |
| `processResult` null input test passes | `test/mistral.test.js:215` | Test: "returns telemetry null for null input" |
| `processResult` within-window test passes | `test/mistral.test.js:330` | Test: "accepts telemetry when session start_time is within invocation window" |
| `processResult` too-old rejection test passes | `test/mistral.test.js:346` | Test: "rejects telemetry when session is too old" |
| `processResult` future-session rejection test passes | `test/mistral.test.js:362` | Test: "rejects telemetry when session start_time is in the future" |
| `processResult` missing start_time rejection test passes | `test/mistral.test.js:378` | Test: "rejects telemetry when meta.json has no start_time field" |
| `processResult` backward compat test passes | `test/mistral.test.js:399` | Test: "accepts telemetry when no invocationStart is provided" |
| All tests pass | `test/telemetry-stubs.test.js` + `test/mistral.test.js` | 41/41 pass |
| ESLint clean | `./scripts/verify-local.sh static-analysis` | PASS |
| tsc typecheck clean | `./scripts/verify-local.sh static-analysis` | PASS |
| Docs gate passes | `./scripts/verify-local.sh docs` | PASS |

## Next action

Mission complete. All checkpoints done, all gates pass, all tests pass. Both review findings addressed.
