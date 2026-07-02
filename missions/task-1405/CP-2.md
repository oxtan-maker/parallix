# CP-2: Non-Blocking Patterns Added

## Summary

Added three missing non-blocking error patterns to `NON_BLOCKING_LAUNCH_ERROR_PATTERNS` in `lib/agents/agents.ts`:

1. `/\bunsupported\s+(flag|option)\b/i` — Unsupported CLI flags (line 118)
2. `/\b(home|bootstrap)\s+(error|failed|cannot|denied|not\s+found)\b/i` — Home / bootstrap failures (line 124)
3. `/\bpermission\s+denied\b/i` — Permission denied on home dirs (line 125)

After rebuilding with `npm run build:cjs`, all 6 `shouldPersistLaunchFailureBlock` tests pass (was 3/6), and all 22 tests in `test/agents-limit-hit.test.js` pass without modification.

## Goal Check

| Criterion | Evidence | Status |
|-----------|----------|--------|
| SC-1: unsupported flag returns false | `lib/agents/agents.ts:118`, test `test/agents-limit-hit.test.js:605-609` | Pass |
| SC-2: home/bootstrap failure returns false | `lib/agents/agents.ts:124`, test `test/agents-limit-hit.test.js:612-617` | Pass |
| SC-3: transient crash returns true | `test/agents-limit-hit.test.js:625-630` | Pass |
| SC-4: custom agent returns false | `test/agents-limit-hit.test.js:639-642` | Pass |
| SC-5: signal kill returns true | `test/agents-limit-hit.test.js:633-637` | Pass |
| SC-6: all existing tests pass | `node --test test/agents-limit-hit.test.js` — 22 pass, 0 fail | Pass |

## Next action

Add rationale comment to `shouldPersistLaunchFailureBlock` and enhance the block-persistence log message with a reason label (CP-3).
