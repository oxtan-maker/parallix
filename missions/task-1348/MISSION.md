# Mission: Block agents on non-limit failures so review fallback to implementer works (task-1348)

## Goal

Make `startAgent` in `lib/agents/agents.js` block agents in the local blocklist (`agents.local.json`) when they fail with non-limit errors (API key errors, model not found), not just rate-limit hits. Exclude `qwen` (opencode/local AI) from this logic — opencode exit 1 is a temporary local error, not a persistent issue that warrants blocking. This ensures that when all reviewer agents fail with persistent errors, the review loop's fallback path to the implementer model is reachable instead of throwing "All eligible agents exhausted" from `selectAgent`.

## Why Now

During task-1347's review loop (focus: all, entrypoint: `$review all`), both eligible reviewers failed immediately:
- `codex`: exit 1 (OpenAI Codex v0.142.2)
- `mistral`: exit 1 (API error: Invalid API key)

The error output was:
```
[WARN] Agent mistral failed to complete (exit 1 (Error: API error from mistral...)); retrying with next eligible agent.
[FAIL] Could not launch reviewer agent (codex): All eligible agents exhausted for step "review". Tried: codex, mistral.
```

Root cause: `startAgent` only calls `updateAgentBlock` when `detectLimitHit` returns truthy (agents.js:762). `detectLimitHit` only returns truthy for rate-limit patterns in output or signal kills (limit-hit.js:219). API key errors and model-not-found errors produce exit 1 with no matching limit pattern, so `detectLimitHit` returns `null`. The `launchFailed` handler (agents.js:803-825) retries with the next agent but does NOT block the failed one.

Because neither codex nor mistral was blocked, `selectAgent('review', ...)` throws "All eligible agents exhausted" (agents.js:401) before the review loop's fallback path (review-loop.js:460-492) can evaluate the implementer-as-reviewer fallback. The fallback at review-loop.js:562-567 is never reached because the exception bubbles up from `selectAgent` before the code gets there.

This means any mission where all reviewers fail with non-limit API errors will hit `[FAIL] Could not launch reviewer agent` instead of falling back to the implementer model, even when the implementer is capable.

## Refinement Signals

- Estimated agent % usage limit: 25-50%
- Confidence: High
- Selection note: defect is a clear logic gap — the blocklist update path is gated behind limit-hit detection only, but the retry loop needs blocks for all persistent failures
- Main drivers: review-loop reliability, agent fault tolerance

## Scope

- Modify `startAgent` in `lib/agents/agents.js` to call `updateAgentBlockFn` for non-limit launch failures, not just limit-hit detections
- Exclude `qwen` from this blocking logic — opencode is the local AI and exit 1 is a temporary error, not a persistent issue warranting a 1-hour block
- The block should use a reasonable default duration (e.g., 1 hour, matching the `DEFAULT_FALLBACK_HOURS` in `limit-hit.js:116`) for non-limit failures — these are persistent issues (bad API key, missing binary) that won't self-resolve within a mission
- Place the block logic in the `launchFailed` branch (agents.js:806-824) alongside the existing retry logic, before `chosen = null; continue;`
- Ensure the block is written to the same `agents.local.json` path as limit-hit blocks (already handled by `updateAgentBlockFn`)
- Verify that the review loop's fallback path (review-loop.js:460-492, 560-584) becomes reachable when all reviewers are blocked by non-limit failures
- Update or add tests to cover: agent with non-limit failure gets blocked, retry selects next agent, implementer fallback activates when all reviewers are blocked

## Out of Scope

- Changes to `detectLimitHit` in `lib/agents/limit-hit.js` (the function correctly detects only rate-limit patterns)
- Changes to `updateAgentBlock` in `lib/agents/agents.js` (it already handles creating the file when missing)
- Changes to the review prompt templates or milestone management
- Changes to the blocklist read path (`isAgentBlocked`, `readAgentConfig`)
- Changes to telemetry/stats recording
- Adding new dependencies

## Success Criteria

> **Falsifiability rule (ADR 0039 Part 2):** Each criterion must be falsifiable.

1. `startAgent` calls `updateAgentBlockFn` in the `launchFailed` branch (agents.js:806+) for agents that exit with non-zero status and no limit-hit detection, excluding `qwen` — verifiable by code inspection of the `launchFailed` handler
2. An agent that fails with a simulated non-limit error (e.g., `status: 1`, `stderr: "API error: Invalid API key"`) is written to `agents.local.json` with a block entry — verifiable by unit test that inspects the blocklist file after `startAgent` returns
3. The block duration for non-limit failures defaults to 1 hour (`DEFAULT_FALLBACK_HOURS` from limit-hit.js) — verifiable by checking the `until` timestamp written to the blocklist entry
4. `qwen` (opencode) is excluded from the non-limit block logic — opencode exit 1 does NOT trigger `updateAgentBlockFn` — verifiable by code inspection and unit test
5. When all reviewer agents are blocked by non-limit failures, the review loop's fallback path (review-loop.js:460-492) evaluates `anyDifferentFamilyRunnable` and `implementerRunnable` and selects the implementer as reviewer instead of throwing "All eligible agents exhausted" — verifiable by integration test with mocked agents
6. All 1640+ existing tests continue to pass with zero regressions (verified by `npm test`)
7. A regression test is added to `test/agents.test.js` or `test/agents-limit-hit.test.js` that verifies non-limit failures trigger `updateAgentBlockFn` with a default 1-hour block

## Risks and Assumptions

- Risk: Blocking agents on transient failures (e.g., temporary network blip) could reduce retry effectiveness. Mitigation: the 1-hour block is the same as rate-limit fallback; transient issues are uncommon in the agent execution context (agents run in controlled worktrees with stable API connections). If needed, the block duration can be made configurable.
- Risk: Incorrectly blocking `qwen` (opencode) on temporary local errors. Mitigation: explicit exclusion of `qwen` from the non-limit block logic in the `launchFailed` branch.
- Risk: The `updateAgentBlockFn` call could fail (e.g., file permission issues). Mitigation: wrap in try/catch with a WARN log, matching the existing pattern at agents.js:764-769.
- Assumption: Non-limit failures (API key errors, model not found, binary not found) are persistent within a mission window and should be treated similarly to rate limits.
- Assumption: The `DEFAULT_FALLBACK_HOURS` constant in `limit-hit.js` is appropriate for non-limit blocks. Verify the value and use it directly rather than hardcoding.
- Assumption: The existing `launchFailed` detection logic (agents.js:803-805) correctly identifies non-limit failures without false positives.

## Checkpoints

- CP 1: Confirm root cause — `startAgent` at agents.js:762 only blocks on `detectLimitHit` truthy; `launchFailed` at agents.js:806 retries without blocking; `selectAgent` throws when all agents are unblocked but failed, preventing review-loop.js fallback path from executing
- CP 2: Add `updateAgentBlockFn` call in the `launchFailed` branch (agents.js:806+) with a default 1-hour block using `DEFAULT_FALLBACK_HOURS` from `limit-hit.js`, excluding `qwen`, wrapped in try/catch
- CP 3: Verify — run `npm test` and confirm all tests pass with zero regressions; add regression test for non-limit block behavior
- CP 4: Verify review fallback — confirm that when all reviewers are blocked by non-limit failures, the review loop reaches the implementer-as-reviewer fallback path instead of throwing

## Gates

- [ ] ./scripts/verify-local.sh docs
- [ ] npm test (all tests pass, zero regressions)

## Restricted Areas

- Do not modify `lib/agents/limit-hit.js` (the `detectLimitHit` function is correct)
- Do not modify `lib/agents/agents.js` outside the `startAgent` function and the `launchFailed` branch
- Do not add `qwen` to the non-limit block logic — opencode exit 1 is temporary, not persistent
- Do not modify any prompt templates, milestone files, or backlog infrastructure
- Do not change the `updateAgentBlock` function signature or behavior
- Do not modify `lib/review/review-loop.js` — the fix is in `startAgent`, the review loop's fallback path is already correct

## Stop Rules

- Stop after the block logic is added in `startAgent`'s `launchFailed` branch and all tests pass
- Stop if any test regression appears (indicates unexpected dependency on the current behavior)
- Do not expand scope to investigate historical stats gaps, telemetry issues, or other agent lifecycle problems
