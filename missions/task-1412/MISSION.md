# Mission: Fix mistral and codex getting blocked all the time (task-1412)

## Goal

Expand the `NON_BLOCKING_LAUNCH_ERROR_PATTERNS` constant in `lib/agents/agents.ts` to cover the common failure modes that cause mistral and codex agents to exit with non-zero status, so that unrecognized failures no longer poison the persistent blocklist with 1-hour "transient crash" blocks. Additionally, improve the blocklist reason field to carry enough diagnostic detail that operators can distinguish genuine transient crashes from deterministic setup/config errors.

## Why Now

Mistral and codex are repeatedly "getting blocked all the time" with `exit 1` — the harness reports `"reason": "exit 1"` for both families across multiple workflow runs. The root cause is that `shouldPersistLaunchFailureBlock()` defaults to `true` (blocking) for any failure whose stdout/stderr does not match one of the existing `NON_BLOCKING_LAUNCH_ERROR_PATTERNS`. When an agent crashes with an unrecognized error (timeout, sandbox violation, tool-call denial, etc.), the fallback block kicks in, the agent is persisted to `agents.local.json` for one hour, and every subsequent workflow step that tries that agent immediately hits the blocklist. This creates a cascading failure where multiple agents get blocked in sequence, starving the workflow of available families.

## Refinement Signals

- Predicted NEL bucket: Medium (81–235)
- Confidence: High
- Selection note: activate as-is
- Main drivers: recurring agent blocking degrading workflow throughput; deterministic config/setup errors incorrectly classified as transient crashes; blocklist reason field lacks diagnostic detail

## Scope

- **In scope:**
  1. Add new patterns to `NON_BLOCKING_LAUNCH_ERROR_PATTERNS` in `lib/agents/agents.ts` for common non-quota failure modes:
     - Timeout errors (`timeout`, `timed out`, `deadline exceeded`, `request timed out`)
     - Sandbox / permission-denial errors that are not auth-related (`sandbox violation`, `sandbox denied`, `tool call denied`, `action denied`, `approval denied`)
     - Provider reachability / connectivity errors not already covered (`EPIPE`, `ETIMEDOUT`, `ENETUNREACH`, `ENOTFOUND`, `EAI_AGAIN`, `socket hang up`, `fetch failed`, `service unavailable`, `gateway timeout`, `overloaded`, `temporarily unavailable`, `please try again`, `retry after`)
     - Prompt rejection errors (`prompt rejected`, `prompt blocked`, `content policy`, `content filter`, `safety filter`)
     - Invocation argument errors (`invalid argument`, `invalid option`, `invalid parameter`, `missing required`, `argument error`)
     - Resource exhaustion not rate-limit related (`out of memory`, `OOM`, `memory limit`, `context window exceeded`, `token limit exceeded`)
  2. Improve the fallback block reason in `agents.js` `startAgent`'s launch-failure path (around line 931) to include a stderr snippet (first line) so the blocklist reason is actionable: `exit 1: <first-line-of-stderr>` instead of just `exit 1`.
  3. Add a `detectLimitHit` guard so that when `status === undefined` (legacy caller path), the detector returns `null` instead of treating it as a failure — this prevents false-positive limit-hit blocks from callers that don't pass exit metadata.
  4. Add regression tests in `test/agents-limit-hit.test.js` for each new non-blocking pattern category.
  5. Update the existing `shouldPersistLaunchFailureBlock` tests to cover the new patterns.

- **Out of scope:**
  - Changing the agent invocation flags for mistral (`--yolo`) or codex (`--sandbox`) — those are already correct
  - Modifying `detectLimitHit` pattern sets (`PATTERN_SETS`) in `lib/agents/limit-hit.ts` — the limit-hit detection is working as designed (only the `status === undefined` guard change is in scope)
  - Changing the blocklist expiration logic or `DEFAULT_FALLBACK_HOURS`
  - Modifying agent launcher implementations (codex.ts, mistral.ts, claude.ts, opencode.ts)
  - Changing the agent selection algorithm or retry loop structure

## Success Criteria

> **Falsifiability rule (ADR 0039 Part 2):** Each criterion must be falsifiable.

- SC 1: Every pattern added to `NON_BLOCKING_LAUNCH_ERROR_PATTERNS` in `lib/agents/agents.ts` is tested by a corresponding `shouldPersistLaunchFailureBlock` assertion in `test/agents-limit-hit.test.js` that verifies it returns `false` (non-blocking).
- SC 2: After the fix, a simulated agent failure with stdout/stderr containing "timeout" or "timed out" produces `shouldPersistLaunchFailureBlock('codex', result) === false`.
- SC 3: After the fix, a simulated agent failure with stdout/stderr containing "sandbox violation" or "tool call denied" produces `shouldPersistLaunchFailureBlock('codex', result) === false`.
- SC 4: After the fix, a simulated agent failure with stdout/stderr containing "context window exceeded" or "token limit exceeded" produces `shouldPersistLaunchFailureBlock('mistral', result) === false`.
- SC 5: The blocklist reason field in `agents.js` launch-failure path (line ~931) includes the first line of stderr as a snippet when stderr is non-empty, producing a reason like `exit 1: sandbox violation` instead of bare `exit 1`.
- SC 6: All existing tests in `test/agents-limit-hit.test.js` continue to pass after the changes (no regressions in existing non-blocking/blocking behavior).
- SC 7: `./scripts/verify-local.sh all` passes with zero errors.

## Risks and Assumptions

- **Risk:** Adding too broad patterns could suppress legitimate transient crashes that should be blocked (e.g., blocking a network error that's actually a rate limit). Mitigation: all new patterns are tightly scoped to specific error phrases and verified by tests.
- **Risk:** The `detectLimitHit` `status === undefined` guard change could alter behavior for legacy callers that rely on the current detection. Mitigation: the guard returns `null` (no block) which is the safer default — a missing status means we lack confidence the launcher failed.
- **Assumption:** The `NON_BLOCKING_LAUNCH_ERROR_PATTERNS` check is the sole mechanism controlling whether `shouldPersistLaunchFailureBlock` returns false. Adding patterns directly maps to non-blocking behavior.
- **Assumption:** Existing tests in `test/agents-limit-hit.test.js` faithfully represent the production behavior of `shouldPersistLaunchFailureBlock`.

## Checkpoints

- CP 1: Audit all existing `NON_BLOCKING_LAUNCH_ERROR_PATTERNS` entries and identify gaps — list every error message that caused mistral or codex to get blocked in recent runs, and map each to a missing pattern. Document findings as inline comments adjacent to the pattern array in `agents.ts`.
- CP 2: Add new non-blocking patterns to `NON_BLOCKING_LAUNCH_ERROR_PATTERNS` covering timeout, sandbox/permission, provider connectivity, prompt rejection, invocation argument, and resource-exhaustion categories. Each new pattern must be accompanied by a test.
- CP 3: Improve the fallback block reason in `agents.js` launch-failure path to include stderr snippet.
- CP 4: Add `detectLimitHit` guard for `status === undefined` — return `null` instead of treating it as a failure.
- CP 5: Add regression tests in `test/agents-limit-hit.test.js` for all new non-blocking pattern categories.
- CP 6: Run `./scripts/verify-local.sh all` — all tests must pass.

## Gates

- [ ] ./scripts/verify-local.sh all

## Restricted Areas

- Do NOT modify `lib/agents/codex.ts`, `lib/agents/mistral.ts`, `lib/agents/claude.ts`, or `lib/agents/opencode.ts` — agent invocation logic is correct.
- Do NOT change `DEFAULT_FALLBACK_HOURS`, blocklist expiration, or the blocklist write format.
- Do NOT modify the agent selection algorithm, retry loop structure, or `selectAgent` logic.
- Do NOT modify the `TRANSIENT_OPENCODE_PATTERNS` or `HARD_OPENCODE_PATTERNS` in `opencode.ts`.

## Stop Rules

- Stop if the root cause is determined to be environmental (e.g., mistral/codex binaries not installed, wrong API keys, rate limits from the providers themselves) — this mission only addresses the client-side blocking logic.
- Stop if adding non-blocking patterns would suppress more than 3 existing test assertions (indicating the patterns are too broad).
- Stop if `./scripts/verify-local.sh all` fails with errors unrelated to the changes (pre-existing test failures block progression).
