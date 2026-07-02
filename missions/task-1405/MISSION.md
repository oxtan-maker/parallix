# Mission: fix blocklist poisoning on deterministic launch failures (task-1405)

## Goal

Prevent `startAgent()` from writing timed blocklist entries into `agents.local.json` for deterministic configuration and setup failures (invalid model identifiers, auth failures, unsupported CLI flags, home/bootstrap failures) while preserving the existing behavior for genuine usage-limit hits and transient runtime crashes.

## Why Now

This regression was introduced in commit 7725a79a (mission/task-1290) on 2026-06-26 when the non-limit launch-failure retry path was extended to persist a one-hour block for all non-custom agents. The TypeScript migration (commit 354999ba) preserved the behavior. Codex agents get written into `<PARALLIX_HOME>/agents.local.json` and then stay excluded from future selection even though the real problem was not a quota event — a misconfigured model ID or expired API key permanently blocks the agent family for an hour, wasting retries and delaying mission progress.

## Refinement Signals

- Predicted NEL bucket: Small (0–80)
- Confidence: High
- Selection note: activate as-is
- Main drivers: single-function fix in lib/agents/agents.ts, one new test in test/agents-limit-hit.test.js, no API surface changes

## Scope

- Add missing non-blocking error patterns to `NON_BLOCKING_LAUNCH_ERROR_PATTERNS` in `lib/agents/agents.ts` (lines 113–123):
  - Unsupported CLI flags: `/\bunsupported\s+(flag|option)\b/i`
  - Home / bootstrap failures: `/\b(home|bootstrap)\s+(error|failed|cannot|denied|not\s+found)\b/i`
  - Permission denied on home dirs: `/\bpermission\s+denied\b/i`
- Add a comment on `shouldPersistLaunchFailureBlock` (line 171) explaining the rationale: deterministic config/setup errors must not poison the persistent blocklist; only transient failures (runtime crashes, network errors) deserve a block.
- Enhance the block-persistence log message at line 913 to include the reason why the block was added (e.g. "transient crash" vs "usage-limit hit"), using a short label derived from the failure classification.
- Author a failing reproduction test in `test/agents-limit-hit.test.js` that asserts `shouldPersistLaunchFailureBlock` returns `false` for unsupported-flag and home-bootstrap failure outputs, and `true` for genuine transient crashes.

## Out of Scope

- Changes to `limit-hit.ts` / `detectLimitHit` — usage-limit detection is correct as-is.
- Changes to `updateAgentBlock`, `isAgentBlocked`, or `readAgentConfig` — blocklist persistence mechanics are unaffected.
- Changes to agent launcher implementations (`codex.ts`, `claude.ts`, `mistral.ts`, `opencode.ts`) — only the blocking decision in `agents.ts` is touched.
- Migration of existing poisoned blocklist entries — out of scope for this mission.

## Success Criteria

> **Falsifiability rule (ADR 0039 Part 2):** Each criterion must be falsifiable.

1. `shouldPersistLaunchFailureBlock('codex', { status: 1, stderr: 'unsupported flag: --foobar' })` returns `false` (SC-1: file `lib/agents/agents.ts:171`, test in `test/agents-limit-hit.test.js`).
2. `shouldPersistLaunchFailureBlock('codex', { status: 1, stderr: 'home bootstrap error: cannot create /tmp/test-home' })` returns `false` (SC-2: same file and test).
3. `shouldPersistLaunchFailureBlock('codex', { status: 1, stderr: 'ECONNRESET: connection reset' })` returns `true` — transient crashes still block (SC-3: same file and test).
4. `shouldPersistLaunchFailureBlock('custom', { status: 1, stderr: 'anything' })` returns `false` — custom agents never block (SC-4: pre-existing behavior preserved, verified by existing test at `test/agents-limit-hit.test.js:116`).
5. `shouldPersistLaunchFailureBlock('codex', { status: null, signal: 'SIGKILL' })` returns `true` — signal kills still block (SC-5: same file and test).
6. All existing tests in `test/agents-limit-hit.test.js` pass without modification (SC-6: regression safety).
7. `./scripts/verify-local.sh static-analysis` reports clean ESLint, tsc typecheck, and test-hygiene (SC-7: `scripts/verify-local.sh static-analysis`).

## Risks and Assumptions

- **Risk:** Pattern additions could be too broad and mask real transient failures. Mitigation: patterns are narrowly scoped to specific keyword combinations; existing tests verify transient crashes still block.
- **Assumption:** The `NON_BLOCKING_LAUNCH_ERROR_PATTERNS` list is the sole decision point for `shouldPersistLaunchFailureBlock`. No other code path bypasses this function for launch-failure blocking.
- **Assumption:** Existing test `test/agents-limit-hit.test.js` exercises the `shouldPersistLaunchFailureBlock` decision path sufficiently to catch regressions.
- **Risk:** Adding patterns may match unexpected error substrings. Mitigation: patterns use `\b` word boundaries and combine multiple keywords to reduce false negatives.

## Checkpoints

- CP 1: Author a failing reproduction test in `test/agents-limit-hit.test.js` that calls `shouldPersistLaunchFailureBlock` with unsupported-flag and home-bootstrap failure payloads and asserts `false`. The test must fail (return `true`) against the parent commit and pass (return `false`) after the fix.
- CP 2: Add the three missing non-blocking patterns to `NON_BLOCKING_LAUNCH_ERROR_PATTERNS` in `lib/agents/agents.ts` and verify the reproduction test turns green.
- CP 3: Add a rationale comment to `shouldPersistLaunchFailureBlock` and enhance the block-persistence log message with a reason label.
- CP 4: Run `./scripts/verify-local.sh all` and confirm clean.

Reproduction-Test: test/agents-limit-hit.test.js

## Gates

- [ ] ./scripts/verify-local.sh all

## Restricted Areas

- Do not modify `lib/agents/limit-hit.ts` — usage-limit detection is correct.
- Do not modify `lib/agents/codex.ts`, `lib/agents/claude.ts`, `lib/agents/mistral.ts`, or `lib/agents/opencode.ts` — launcher implementations are out of scope.
- Do not modify `lib/core/storage.ts`, `lib/core/persistent-data-migration.ts`, or `lib/tools/sessions.js` — blocklist storage mechanics are unaffected.
- Do not migrate or purge existing entries in `agents.local.json` — that is a separate operational concern.

## Stop Rules

- Stop if the reproduction test cannot be authored against the parent commit (the `shouldPersistLaunchFailureBlock` function is not importable or the test harness does not support the required stubbing). Escalate with findings.
- Stop if adding the new patterns causes any existing test in `test/agents-limit-hit.test.js` to fail — this indicates a regression in the blocking logic that requires investigation.
- Stop if `./scripts/verify-local.sh static-analysis` reports errors on the final tree — do not proceed to merge.
