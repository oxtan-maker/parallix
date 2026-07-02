# CP-1: Failing Reproduction Test

## Summary

The reproduction tests for `shouldPersistLaunchFailureBlock` already existed in `test/agents-limit-hit.test.js` (lines 601-643). Three tests asserted that deterministic config/setup failures should return `false` (no block), while three tests asserted that transient crashes should return `true` (block). Against the parent commit (before the fix), the three non-blocking tests failed:

- `shouldPersistLaunchFailureBlock returns false for unsupported CLI flags` — returned `true` instead of `false`
- `shouldPersistLaunchFailureBlock returns false for home/bootstrap failures` — returned `true` instead of `false`
- `shouldPersistLaunchFailureBlock returns false for permission-denied on home dirs` — returned `true` instead of `false`

The three blocking tests passed as expected:
- `shouldPersistLaunchFailureBlock returns true for transient crashes (ECONNRESET)` — passed
- `shouldPersistLaunchFailureBlock returns true for signal kills (SIGKILL)` — passed
- `shouldPersistLaunchFailureBlock returns false for custom agent regardless of failure` — passed

## Goal Check

| Criterion | Evidence | Status |
|-----------|----------|--------|
| Test for unsupported CLI flags fails before fix | `test/agents-limit-hit.test.js:605-609`, assertion `true !== false` | Failed (as expected) |
| Test for home/bootstrap failures fails before fix | `test/agents-limit-hit.test.js:612-617`, assertion `true !== false` | Failed (as expected) |
| Test for permission-denied fails before fix | `test/agents-limit-hit.test.js:620-622`, assertion `true !== false` | Failed (as expected) |
| Transient crash tests pass before fix | `test/agents-limit-hit.test.js:625-637` | Passed |

## Next action

Add the three missing non-blocking patterns to `NON_BLOCKING_LAUNCH_ERROR_PATTERNS` in `lib/agents/agents.ts` (CP-2).
