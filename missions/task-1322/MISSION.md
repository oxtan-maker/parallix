# Mission: prevent-backlog-task-id-recycling-collision (task-1322)

## Goal
Fix the "Session not found" crash that occurs when parallix launches a resume-capable agent (qwen/opencode, claude, or codex) with a stale session ID from `.workflow/sessions/<slug>-<role>.json`. When the underlying agent CLI rejects the session ID, parallix must detect the failure, clear the stale session marker, and retry the launch fresh (without `-s`/`--resume`) instead of failing or cycling agents through the same broken session.

## Why Now
During review of mission/task-1273, the autonomous review loop crashed on attempt 2 when the qwen (opencode) agent was launched with a stale session ID (`ses_...`). The error propagated as `Error: Session not found` with exit code 1, causing the agent selection loop to fall through to mistral. This blocks the happy path for any mission that enters the review loop after a prior session has been orphaned, expired, or otherwise invalidated. Without a fix, every subsequent agent in the RESUME_CAPABLE set (qwen, claude, codex) will retry with the same stale session ID and fail identically.

## Refinement Signals
- Estimated agent % usage limit: 25-50%
- Confidence: High
- Selection note: activate as-is
- Main drivers: blocked autonomous review loop on task-1273; all resume-capable agents share the same stale-session vulnerability

## Scope
- **Root cause analysis**: Trace the full path from session marker creation (`sessions.writeSession` in `lib/agents/agents.js:828`) through session ID retrieval (`sessions.getSessionId` in `lib/tools/sessions.js:53`) to launcher invocation (`buildOpencodeInvocation` in `lib/agents/opencode.js:30`, `buildClaudeInvocation` in `lib/agents/claude.js:45`, `buildCodexDraftInvocation` in `lib/agents/codex.js:29`).
- **Opencode launcher fix** (`lib/agents/opencode.js`): Detect "Session not found" in the spawn result (stderr or stdout), clear the stale session marker via `sessions.clearSession(worktree, slug, role)`, and retry the launch without the `-s <sessionId>` flag.
- **Claude launcher fix** (`lib/agents/claude.js`): Same pattern — detect stale session in `buildClaudeInvocation`/`startClaudeAgent`, clear marker, retry without `--resume <sessionId>`.
- **Codex launcher fix** (`lib/agents/codex.js`): Same pattern — detect stale session in `buildCodexDraftInvocation`/`startCodexDraftAgent`, clear marker, retry without `exec resume <sessionId>`.
- **Test coverage**: Add tests for stale-session detection and fallback in each affected launcher file.

## Out of Scope
- Changes to the session marker schema or file format (`.workflow/sessions/<slug>-<role>.json`).
- Changes to how session IDs are generated or validated by the underlying agent CLIs (opencode, claude, codex).
- Fixes for non-resume-capable agents (mistral) — they do not pass `-s`/`--resume` and are not affected.
- Changes to the `startAgent` retry loop in `lib/agents/agents.js` beyond what is needed to support per-launcher stale-session fallback.
- Task ID recycling prevention — the backlog task title references this conceptually but the actual bug is the session-not-found crash.

## Success Criteria
> **Falsifiability rule (ADR 0039 Part 2):** Each criterion must be falsifiable.

1. **Opencode stale-session detection**: When `startOpencodeAgent` receives a spawn result with "Session not found" in stderr or stdout, it clears the stale session marker via `sessions.clearSession(worktree, slug, role)` and retries the launch with `resume=false`. Verified by unit test in `test/opencode.test.js` that mocks `spawnAndTee` to return `{ status: 1, stderr: "Session not found" }` and asserts the launcher retries without `-s`.

2. **Claude stale-session detection**: Same behavior for `startClaudeAgent` — detects "Session not found" in the spawn result, clears the marker, retries without `--resume`. Verified by unit test in `test/claude.test.js`.

3. **Codex stale-session detection**: Same behavior for `startCodexDraftAgent` — detects "Session not found", clears the marker, retries without `exec resume`. Verified by unit test in `test/codex.test.js`.

4. **No regression on healthy resumes**: When a valid session ID is present and the agent CLI accepts it, the launcher still uses the `-s`/`--resume` flag and does not clear the marker. Verified by existing tests in the respective launcher test files passing unchanged.

5. **All existing tests pass**: `npm test` completes with 0 failures after the changes.

## Risks and Assumptions
- **Assumption**: All three resume-capable agents (opencode, claude, codex) use the same error string "Session not found" when rejecting an invalid session ID. If any agent uses a different message, the detection regex/string must be adjusted per-launcher.
- **Risk**: Clearing the session marker mid-retry means the next same-(slug, role) launch will always start fresh. This is the intended behavior but means any partial session state is lost. Acceptable because the session was already unusable.
- **Assumption**: The `sessions.clearSession` function is safe to call concurrently with `startAgent`'s retry loop. Since `clearSession` only does an `fs.unlinkSync`, this is safe.
- **Risk**: If the spawn-tee result does not capture stderr (due to `stdio: 'inherit'` in `buildOpencodeInvocation`), the error may not appear in `result.stderr`. The fix should check both `result.stderr` and `result.stdout` for the error string.

## Checkpoints
- CP 1: Root cause traced and documented. Session marker lifecycle mapped from creation (`agents.js:828`) through retrieval (`sessions.js:53`) to launcher invocation (`opencode.js:35`, `claude.js:50`, `codex.js:32`). Stale session identified as the root cause of the "Session not found" crash.
- CP 2: Opencode launcher fix implemented and tested. Stale session detected, marker cleared, retry without `-s`.
- CP 3: Claude and codex launcher fixes implemented and tested. Same pattern applied.
- CP 4: All existing tests still pass. No regressions in healthy resume flows.

## Gates
- [ ] ./scripts/verify-local.sh docs
- [ ] npm test passes with 0 failures

## Restricted Areas
- Do not modify `lib/tools/sessions.js` API contract (function signatures, return values). The existing functions (`readSession`, `writeSession`, `shouldResume`, `getSessionId`, `clearSession`) are already sufficient.
- Do not modify `lib/agents/agents.js` beyond what is strictly necessary to support the per-launcher fallback. The `startAgent` retry loop is working correctly for other failure modes.
- Do not modify the session marker JSON schema in `.workflow/sessions/`.
- Do not change the `RESUME_CAPABLE` set membership — the fix applies to all three members uniformly.

## Stop Rules
- Stop if the "Session not found" error string varies between agents and no consistent detection strategy works — in that case, document the per-agent error strings and stop after fixing opencode (the agent that triggered the original bug).
- Stop if fixing one launcher breaks another launcher's existing behavior (healthy resume). The healthy resume path must remain unchanged.
- Stop if the test suite cannot mock the spawn result to simulate a stale session — in that case, use integration-level testing with a mock agent CLI instead.
