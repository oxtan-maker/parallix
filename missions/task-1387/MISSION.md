# Mission: Relaunch implementer automatically on genuine gate failure with captured fix prompt (task-1387)

## Goal

When the verification gate fails at handoff time (`handoff.ts:200-209`), capture the gate's stdout and stderr, append them to the error message so they are classified as a "genuine gate failure" (failure class 6 from ADR 0048), and automatically relaunch the implementer agent with the captured output as a fix prompt — bounded by a maximum of 2 relaunch attempts to prevent infinite loops.

## Why Now

ADR 0048 Control C2 identifies this as the highest-ROI single control in the fail-closed harness set. The most common human-intervention scenario — manually copying gate output and re-invoking the agent — is eliminated by automating the capture-and-relaunch path. TASK-1389 (error classifier) provides the classification schema; this mission implements the runtime behavior that plugs into the existing `isRelaunchableError` / `attemptAgentRelaunch` seam in `active.ts` until the classifier replaces it.

## Refinement Signals

- Predicted NEL bucket: Small (0–80)
- Confidence: High
- Selection note: activate as-is
- Main drivers: ADR 0048 C2 (highest-ROI fail-closed control), elimination of manual gate-output-copying, dependency-ready on repair-handoff.ts and active.ts seams

## Scope

- Modify `lib/commands/handoff.ts` `performHandoff()` to capture verification gate stdout/stderr when `runVerificationGate()` returns non-zero, and embed the captured output in the returned error object (new `gateOutput` field)
- Modify `lib/commands/handoff.ts` `runDeclaredGates()` similarly: when a declared gate exits non-zero, capture and include its stdout/stderr in the failure result
- Modify `lib/commands/active.ts` `runHandoffAndReview()` to detect genuine gate failures (error messages containing `"verification gate failed"` or `"declared gate failed"`), trigger automatic relaunch via `attemptAgentRelaunch` with the captured output, and enforce a maximum of 2 relaunch attempts
- Modify `lib/commands/active.ts` `attemptAgentRelaunch()` to accept and use captured gate output in the relaunch prompt (extend `buildRelaunchPrompt` signature or add a new prompt-building step)
- Add unit tests covering: (a) gate output capture in handoff failure path, (b) relaunch trigger on genuine gate failure in runHandoffAndReview, (c) 2-attempt retry limit enforcement, (d) backward compatibility with existing repair-handoff behavior

## Out of Scope

- Implementation of the error classifier and dispatch table (TASK-1389) — this mission uses the existing `isRelaunchableError` / string-matching seam; TASK-1389 replaces it later
- Pre-review-round gate enforcement with auto-bounce (TASK-1385) — a separate control in the ADR 0048 sequence
- Gatekeeper auto-send-back with agent relaunch (TASK-1388) — separate control
- Any changes to the verification gate command itself (the gate is configured externally via `workflow.config.json`)
- Changes to `lib/commands/repair-handoff.ts` beyond extending `isRelaunchableError` to also match genuine gate failure patterns (for backward compatibility with existing callers)

## Success Criteria

> **Falsifiability rule (ADR 0039 Part 2):** Each criterion must be falsifiable.

- SC1: When `runVerificationGate()` returns non-zero in `performHandoff()`, the returned error object contains a `gateOutput` field whose `stdout` and `stderr` properties match the captured output from `runVerificationGate()`. Verified by a unit test in `test/handoff.test.js` that mocks `runVerificationGate` to return a non-zero result with known stdout/stderr, then asserts `handoffResult.gateOutput.stdout` and `handoffResult.gateOutput.stderr` equal the mocked values.
- SC2: When a declared gate in `runDeclaredGates()` exits non-zero, the returned failure object includes `stdout` and `stderr` fields populated from the gate's `spawnSync` result. Verified by a unit test in `test/handoff.test.js` that declares a gate command returning a known error output, then asserts the failure result contains that output.
- SC3: When `runHandoffAndReview()` receives a handoff failure with a `gateOutput` field and `isRelaunchableError` returns true (existing behavior for goal-check errors) OR the error message contains `"verification gate failed"` or `"declared gate failed"`, the implementer agent is relaunched via `attemptAgentRelaunch` with the captured output embedded in the prompt. Verified by a unit test in `test/active.test.js` that mocks `performHandoff` to return a gate-failure error with `gateOutput`, then asserts `attemptAgentRelaunch` was called once with a prompt containing the captured output.
- SC4: The relaunch loop in `runHandoffAndReview()` terminates after a maximum of 2 relaunch attempts, regardless of whether subsequent relaunches succeed. Verified by a unit test in `test/active.test.js` that mocks `attemptAgentRelaunch` to return `relaunched: true` three times, then asserts that `attemptAgentRelaunch` was called exactly 2 times and the final result reflects the 2nd attempt's outcome.
- SC5: Existing repair-handoff behavior is preserved: errors that match `isRelaunchableError` (goal-check table missing evidence) still trigger relaunch, and errors that match `isDirtyError` / `isBehind` (dirty artifacts, branch behind) still trigger auto-commit/auto-rebase before retry. Verified by the existing tests in `test/repair-handoff.test.js` and `test/handoff.test.js` passing unchanged after the mission's changes land.
- SC6: Static analysis gate (`./scripts/verify-local.sh all`) passes clean on the final tree, including ESLint (max 300 warnings), tsc typecheck (no TS errors excluding TS18003), and test-hygiene checks.

## Risks and Assumptions

- Risk: Large gate output could produce a very long relaunch prompt, potentially exceeding agent context limits. Mitigation: truncate gate output to the last 8000 characters if total captured output exceeds 16000 characters.
- Risk: If the agent relaunch succeeds but the gate still fails, the 2-attempt limit stops the loop. This is intentional per ADR 0048 — the third failure is surfaced to the operator for manual intervention.
- Assumption: The verification gate command is configured in `workflow.config.json` and runs in the worktree context; stdout/stderr capture via `stdio: 'pipe'` is compatible with all configured gate commands.
- Assumption: `attemptAgentRelaunch` in `active.ts` can handle a prompt that includes captured gate output without behavioral regressions; the prompt format is additive (appended after the existing error description).
- Assumption: The error classifier (TASK-1389) will eventually replace the string-matching approach in this mission, so the gate-failure detection strings (`"verification gate failed"`, `"declared gate failed"`) are chosen to be future-proof and unlikely to collide with unrelated error messages.

## Checkpoints

- CP 1: Capture gate output in `handoff.ts` — modify `performHandoff()` to run the verification gate with `stdio: 'pipe'`, capture stdout/stderr on non-zero exit, and attach them to the failure result as `gateOutput`. Similarly extend `runDeclaredGates()` to capture gate output. Add unit tests in `test/handoff.test.js` verifying SC1 and SC2.
- CP 2: Detect and relaunch on gate failure in `active.ts` — modify `runHandoffAndReview()` to check for gate-failure indicators (`gateOutput` present in error, or error message containing `"verification gate failed"` / `"declared gate failed"`), invoke `attemptAgentRelaunch` with captured output, and enforce the 2-attempt retry limit. Extend `attemptAgentRelaunch` and `buildRelaunchPrompt` to incorporate gate output into the prompt. Add unit tests in `test/active.test.js` verifying SC3 and SC4.
- CP 3: Preserve backward compatibility — ensure existing `isRelaunchableError` / `isDirtyError` / `isBehind` paths in `repair-handoff.ts` and `runHandoffAndReview()` continue to work. Confirm all existing tests in `test/repair-handoff.test.js`, `test/handoff.test.js`, and `test/active.test.js` pass. Run `./scripts/verify-local.sh all`.

## Gates

- [ ] ./scripts/verify-local.sh static-analysis
- [ ] npm test

## Restricted Areas

- Do not modify `lib/core/verification.ts` — the gate execution mechanism itself is out of scope; only the caller (`handoff.ts`) changes how it consumes the gate result.
- Do not modify `lib/commands/integrate.ts` — integration-time gates are handled separately (ADR 0048 C6/C7).
- Do not modify `lib/tools/gatekeeper.ts` — gatekeeper pushback is handled by TASK-1388.
- Do not modify `lib/review/` — the pre-review-round gate enforcement is TASK-1385.
- Do not modify `lib/commands/repair-handoff.ts` beyond extending `isRelaunchableError` to match genuine gate failure patterns for backward compatibility.

## Stop Rules

- Stop if the gate output capture breaks an existing integration gate that depends on `stdio: 'inherit'` behavior — fall back to selective capture (only capture when error is detected).
- Stop if the 2-attempt limit causes a regression in any existing test — the limit must only apply to the new gate-failure relaunch path, not to existing relaunch scenarios.
- Stop if the prompt length from captured gate output causes a test agent to fail to parse the prompt — truncate aggressively and add a `[truncated]` marker.
- Stop drafting if the error classifier (TASK-1389) is already merged and provides a dispatch table — switch to plugging into that table instead of string-matching.
