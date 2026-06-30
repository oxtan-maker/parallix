# Mission: deterministic launch failures should not blocklist agent families (task-1392)

## Goal

Stop `startAgent()` in `lib/agents/agents.ts` from writing persistent blocklist entries for deterministic (hard) launch failures such as invalid model identifiers, auth failures, and unsupported CLI flags. Genuine usage-limit hits must still persist a timed block and reroute. Transient failures (network errors) should continue to block for fallback.

## Why Now

This regression was introduced in commit `7725a79a1201df8d268871605419154fe813fd1e` (task-1290) on 2026-06-26 and preserved through the TypeScript migration (`354999ba3a6dd8dafaf5cec2583adb06bdb23edb` on 2026-06-28). Users with misconfigured agent settings (wrong model name, expired API key, read-only home directory) see their agent families written to `agents.local.json` and excluded from future selection for one hour, causing confusing silent failures during task execution. The `isHardOpencodeFailure` classifier already exists in `lib/agents/opencode.ts` and is exported but never consumed by `agents.ts` — wiring it in is a small, low-risk fix.

## Refinement Signals

- Predicted NEL bucket: Small (0–80)
- Confidence: High
- Selection note: activate as-is
- Main drivers: regression from task-1290, existing unused classifier in opencode.ts, observed user confusion from stale blocklist entries

## Scope

- Modify `lib/agents/agents.ts` to import `isHardOpencodeFailure` from `./opencode` and skip blocklist writes for hard/deterministic launch failures
- The hard-failure exclusion applies only to the non-limit blocklist path (lines 851–886); usage-limit blocklist path (lines 807–827) is untouched
- Add a regression test in `test/agents.test.js` that verifies a hard failure (e.g. "model not found" stderr) does NOT trigger `updateAgentBlockFn`
- Preserve existing behavior: usage-limit hits still block, transient failures still block, custom agent still excluded from non-limit block

## Out of Scope

- Changing blocklist duration or format (still 1 hour for transient hits)
- Modifying `lib/agents/opencode.ts` (the classifier functions already exist and are tested)
- Adding new CLI flags or configuration options
- Modifying `agents.local.json` schema or migration logic
- Touching `test/agents-limit-hit.test.js` or `test/opencode-retry.test.js` (their tests must continue to pass)

## Success Criteria

> **Falsifiability rule (ADR 0039 Part 2):** Each criterion must be falsifiable.

1. `lib/agents/agents.ts` imports `isHardOpencodeFailure` from `./opencode` (line ~8) and calls it inside the `launchFailed` branch (lines 851–886) before `updateAgentBlockFn`
2. A launch failure whose stderr matches a hard pattern (e.g. "model not found", "invalid api key", "authentication failed", "no such model") does NOT produce a call to `updateAgentBlockFn` — verified by a test that stubs `updateAgentBlockFn` and asserts zero block calls after a hard failure
3. A launch failure whose stderr matches a transient pattern (e.g. "ECONNRESET", "fetch failed") DOES produce a call to `updateAgentBlockFn` — verified by the existing test at `test/agents.test.js:1816` continuing to pass
4. A genuine usage-limit hit (detected by `detectLimitHitFn`) still produces a blocklist entry — verified by the existing tests in `test/agents-limit-hit.test.js` continuing to pass
5. All existing tests in `test/agents.test.js`, `test/agents-limit-hit.test.js`, and `test/opencode-retry.test.js` pass without modification
6. `npm test` (full suite) passes with no regressions
7. `./scripts/verify-local.sh static-analysis` reports clean on `lib/agents/agents.ts`

## Risks and Assumptions

- Risk: The `isHardOpencodeFailure` classifier may not cover all deterministic failure modes that agents.ts encounters (e.g. ENOENT/EACCES spawn errors are covered, but edge cases like malformed config files may not be). Mitigation: the classifier is conservative — it only matches known hard patterns; anything not matched falls through to the existing transient-block behavior, which is safe (over-blocking is worse than under-blocking).
- Assumption: `isHardOpencodeFailure` correctly classifies failures for all launcher types (codex, claude, mistral, opencode). The function inspects stderr/stdout text patterns, which is launcher-agnostic.
- Assumption: Existing tests in `test/agents.test.js` that assert blocklist writes for non-limit failures use transient-style failures (generic exit 1 with no specific stderr). If a test uses a hard-pattern stderr, it would need updating — the reproduction test will reveal this.
- Assumption: The `startAgent` retry loop continues to iterate to the next agent after a hard failure (it should, since we only skip the blocklist write, not the `tried.add`/`continue` flow).

## Checkpoints

- CP 1 (Red): Author a failing reproduction test in `test/agents.test.js` that launches an agent with a hard-error stderr (e.g. "model not found"), stubs `updateAgentBlockFn`, and asserts that `blockCalls.length === 0`. This test fails (red) at the mission's parent commit because the current code always blocks non-custom agents on any non-limit failure.
- CP 2 (Green): Wire `isHardOpencodeFailure` from `./opencode` into the launch-failure blocklist path in `lib/agents/agents.ts`. Guard the `updateAgentBlockFn` call with `if (chosen !== 'custom' && !isHardOpencodeFailure(result))`. Run the reproduction test — it should now pass (green).
- CP 3 (Clean): Run the full test suite (`npm test`) and static analysis (`./scripts/verify-local.sh static-analysis`). Confirm no regressions in `test/agents.test.js`, `test/agents-limit-hit.test.js`, or `test/opencode-retry.test.js`.

## Gates

- [ ] ./scripts/verify-local.sh static-analysis
- [ ] ./scripts/verify-local.sh docs
- [ ] npm test (full suite, all green)

## Restricted Areas

- `lib/opencode/` — do not modify; the classifier functions are already correct
- `test/opencode-retry.test.js` — do not modify; tests the in-family retry classifier independently
- `test/agents-limit-hit.test.js` — do not modify; tests must continue to pass as-is
- `lib/core/persistent-data-migration.ts` — do not modify; blocklist migration is unaffected
- `lib/tools/` — out of scope

## Stop Rules

- Stop immediately if `npm test` reveals regressions in tests outside the files directly touched by this mission (e.g. `test/agents-limit-hit.test.js` or `test/opencode-retry.test.js`) — investigate root cause before proceeding
- Stop if the static-analysis gate (`./scripts/verify-local.sh static-analysis`) fails and cannot be resolved by adjusting only `lib/agents/agents.ts`
- Stop if `isHardOpencodeFailure` proves insufficiently broad — if more than 2 distinct deterministic failure patterns are observed that it does not match, escalate for scope review rather than patching ad-hoc

Reproduction-Test: test/agents.test.js (new test appended after line 1877: "hard launch failure does not blocklist agent family")
