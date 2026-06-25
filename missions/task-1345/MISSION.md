# Mission: Diagnose and fix truncated `opencode export` output in `captureOpencodeExport` (task-1345)

## Goal
Identify why `captureOpencodeExport()` in `lib/agents/opencode-export.js` consistently returns ~145,753 bytes of a 153,453-byte session export (truncated mid-JSON), causing the telemetry parser to return null and stats to record all zeros for qwen tasks. Then fix the root cause so the workflow captures the full export document.

## Why Now
- Every qwen execute-phase run (e.g. task-1344) records zero input/output/cached/tool-call stats despite a real session with 522K input tokens and 26 tool calls existing.
- The bug is deterministic: `captureOpencodeExport` always truncates at exactly 145,753 bytes; manual `opencode export > file` always yields 153,453 bytes.
- The truncated JSON fails to parse → `extractOpencodeTelemetryFromExport` returns null → `telemetryToStatsFields` falls back to provider=qwen, model=qwen, all zeros.
- This corrupts the entire stats CSV for qwen tasks, making telemetry credibility impossible to audit.

## Refinement Signals
- Estimated agent % usage limit: 25-50%
- Confidence: High
- Selection note: activate as-is
- Main drivers: deterministic truncation reproduced by previous agent; export + parser both verified working in isolation; failure confirmed upstream in the capture path.

## Scope
- Investigate `lib/agents/opencode-export.js` `captureOpencodeExport()` as the sole capture point.
- Trace the full call path: `startOpencodeAgent` → `processResult` → `_captureExport` → `captureOpencodeExport`.
- Verify that `worktree` is propagated from `startOpencodeAgent` through `processResult` to `captureOpencodeExport` (currently `worktree` is NOT passed in `opencode.js:262`).
- Compare spawn configurations: `captureOpencodeExport` uses `stdio: ['ignore', 'pipe', 'ignore']` while shell redirect uses inherited stdio; test whether closing stdin or discarding stderr affects the `opencode export` binary's output volume.
- Test whether running `opencode export` from a different `cwd` than the task directory yields truncated output (session file resolution).
- Test whether adding `env.PWD` (set by `spawnAndTee` but NOT by `captureOpencodeExport`) changes behavior.
- If the root cause is identified, implement the minimal fix (e.g., pass `worktree` as `cwd`, adjust `stdio`, or set `PWD`).

## Out of Scope
- Modifying the telemetry parser (`lib/agents/opencode-telemetry.js`) — it works correctly when given full JSON.
- Modifying `spawnAndTee` (`lib/core/spawn-tee.js`) — it is not involved in export capture.
- Adding new dependencies.
- Changing behavior of other agent families (codex, claude, mistral).
- Rewriting the stats CSV pipeline — the fix is upstream at the capture point.

## Success Criteria
> **Falsifiability rule (ADR 0039 Part 2):** Each criterion must be falsifiable.

1. The root cause of the truncation is documented with specific evidence (byte counts, file paths, spawn configs, diffs between working and broken calls).
2. A minimal code fix is implemented in `lib/agents/opencode-export.js` and/or `lib/agents/opencode.js` that resolves the truncation.
3. After the fix, `captureOpencodeExport(sessionId)` returns ≥ 153,000 bytes for the task-1344 session (matching the manual export within 1%).
4. The returned JSON parses successfully through `JSON.parse` without errors.
5. `extractOpencodeTelemetryFromExport(capturedJson)` returns a non-null telemetry object with `inputTokens > 0`, `outputTokens > 0`, and `toolCalls > 0`.
6. All 1658 existing tests continue to pass (zero regressions).
7. A regression test is added to `test/opencode-export.test.js` that verifies `captureOpencodeExport` captures full output when the child produces ≥ 140 KB of data.

## Risks and Assumptions
- The `opencode` binary's behavior may differ depending on stdio configuration (closed stdin, discarded stderr) — this is the leading hypothesis.
- The `worktree` not being passed to `captureOpencodeExport` may cause the export to run from the wrong directory, affecting session file resolution.
- The `PWD` env var set by `spawnAndTee` but absent in `captureOpencodeExport` may affect how `opencode` resolves paths.
- Assumption: the manual `opencode export` command and the parser are correct (verified by previous agent — 153,453 bytes parse cleanly).
- Assumption: the truncation is not caused by an OS-level pipe buffer limit (145,753 bytes ≠ any standard buffer size like 4KB/64KB/128KB).

## Checkpoints
- CP 1: Confirm that `worktree` is missing from the `_captureExport` call in `opencode.js:262` and that `captureOpencodeExport` does not accept or use a `worktree`/`cwd` parameter.
- CP 2: Reproduce the truncation locally with a controlled test that feeds a known-large JSON payload through `captureOpencodeExport` with an injected spawn.
- CP 3: Isolate the variable: test `captureOpencodeExport` with `stdio: ['ignore', 'pipe', 'pipe']` (keep stderr) and with `cwd` set to the task directory.
- CP 4: Identify the single factor (or combination) that causes the full output to be captured vs. truncated.
- CP 5: Implement the fix and verify with existing tests + a new regression test.

## Gates
- [ ] ./scripts/verify-local.sh docs
- [ ] npm test (all 1658 tests pass, zero regressions)

## Restricted Areas
- Do not modify `lib/agents/opencode-telemetry.js` (parser is verified working).
- Do not modify `lib/core/spawn-tee.js` (not involved in export capture).
- Do not modify any test files except to add the new regression test in `test/opencode-export.test.js`.
- Do not change the `captureOpencodeExport` function's public API signature (keep injectable `spawn`, `timeoutMs`, `maxBytes`).

## Stop Rules
- Stop if the root cause cannot be isolated to a single reproducible factor within the code (do not speculate about opencode binary internals).
- Stop if a proposed fix changes more than 3 files or modifies the public API of `captureOpencodeExport`.
- Stop if the truncation cannot be reproduced with a controlled unit test (injectable spawn + known payload).
- Stop before proposing a fix if the evidence is inconsistent or contradictory.
