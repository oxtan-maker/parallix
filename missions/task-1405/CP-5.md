# CP-5: Final — Mission Complete

## Summary

Fixed `shouldPersistLaunchFailureBlock` in `lib/agents/agents.ts` to prevent deterministic config/setup failures from poisoning the persistent blocklist in `agents.local.json`. The three new patterns added to `NON_BLOCKING_LAUNCH_ERROR_PATTERNS` cover unsupported CLI flags, home/bootstrap failures, and permission-denied errors. A rationale comment was added above the function, and the block-persistence log message was enhanced with a reason label.

## Goal Check

| # | Criterion | Evidence | Status |
|---|-----------|----------|--------|
| SC-1 | `shouldPersistLaunchFailureBlock('codex', { status: 1, stderr: 'unsupported flag: --foobar' })` returns `false` | `lib/agents/agents.ts:118` (pattern), `test/agents-limit-hit.test.js:605-609` (test) | Pass |
| SC-2 | `shouldPersistLaunchFailureBlock('codex', { status: 1, stderr: 'home bootstrap error: cannot create /tmp/test-home' })` returns `false` | `lib/agents/agents.ts:124` (pattern), `test/agents-limit-hit.test.js:612-617` (test) | Pass |
| SC-3 | `shouldPersistLaunchFailureBlock('codex', { status: 1, stderr: 'ECONNRESET: connection reset' })` returns `true` | `test/agents-limit-hit.test.js:625-630` (test) | Pass |
| SC-4 | `shouldPersistLaunchFailureBlock('custom', { status: 1, stderr: 'anything' })` returns `false` | `test/agents-limit-hit.test.js:639-642` (test) | Pass |
| SC-5 | `shouldPersistLaunchFailureBlock('codex', { status: null, signal: 'SIGKILL' })` returns `true` | `test/agents-limit-hit.test.js:633-637` (test) | Pass |
| SC-6 | All existing tests in `test/agents-limit-hit.test.js` pass without modification | `node --test test/agents-limit-hit.test.js` — 22 pass, 0 fail | Pass |
| SC-7 | `./scripts/verify-local.sh static-analysis` reports clean | `./scripts/verify-local.sh static-analysis` — 0 errors, ESLint clean, tsc clean, test-hygiene clean | Pass |

## Next action

Commit changes and hand off to review.
