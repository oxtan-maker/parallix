# CP-5: Add regression tests for all new non-blocking pattern categories

## Work Done

Added 37 new test assertions in `test/agents-limit-hit.test.js` covering all 6 new pattern categories plus the detectLimitHit guard:

- **Timeout errors** (4 tests): timeout, timed out, deadline exceeded, request timed out
- **Sandbox/permission-denial non-auth** (5 tests): sandbox violation, sandbox denied, tool call denied, action denied, approval denied
- **Provider connectivity** (13 tests): EPIPE, ETIMEDOUT, ENETUNREACH, ENOTFOUND, EAI_AGAIN, socket hang up, fetch failed, service unavailable, gateway timeout, overloaded, temporarily unavailable, please try again, retry after
- **Prompt rejection** (5 tests): prompt rejected, prompt blocked, content policy, content filter, safety filter
- **Invocation argument errors** (5 tests): invalid argument, invalid option, invalid parameter, missing required, argument error
- **Resource exhaustion** (5 tests): out of memory, OOM, memory limit, context window exceeded, token limit exceeded
- **detectLimitHit guard** (2 tests): status === undefined returns null, status === 1 still fires

Each test asserts `shouldPersistLaunchFailureBlock` returns `false` (non-blocking) for its respective error pattern, satisfying SC 1.

## Goal Check

| # | Criterion | Evidence |
|---|-----------|----------|
| 1 | Timeout patterns tested | `test/agents-limit-hit.test.js:706-717` — 4 tests for timeout/timed out/deadline exceeded/request timed out |
| 2 | Sandbox patterns tested | `test/agents-limit-hit.test.js:719-735` — 5 tests for sandbox violation/denied, tool call denied, action denied, approval denied |
| 3 | Connectivity patterns tested | `test/agents-limit-hit.test.js:737-780` — 13 tests for EPIPE, ETIMEDOUT, ENETUNREACH, ENOTFOUND, EAI_AGAIN, socket hang up, fetch failed, service unavailable, gateway timeout, overloaded, temporarily unavailable, please try again, retry after |
| 4 | Prompt rejection patterns tested | `test/agents-limit-hit.test.js:782-800` — 5 tests for prompt rejected/blocked, content policy/filter, safety filter |
| 5 | Argument error patterns tested | `test/agents-limit-hit.test.js:802-825` — 5 tests for invalid argument/option/parameter, missing required, argument error |
| 6 | Resource exhaustion patterns tested | `test/agents-limit-hit.test.js:827-847` — 5 tests for out of memory/OOM, memory limit, context window exceeded, token limit exceeded |
| 7 | detectLimitHit guard tested | `test/agents-limit-hit.test.js:850-870` — 2 tests verifying status===undefined returns null, status===1 still fires |

## Next action

CP-6: Run `./scripts/verify-local.sh all` — all tests must pass.
