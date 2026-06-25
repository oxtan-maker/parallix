# Mission: Preserve review-state round data when identities change on resume (task-1305)

## Goal
Fix the identity-mismatch branch in `startReviewLoop` (review-loop.js:597-599) so that resuming a mission with a persisted review-state file preserves the original round number, startedAt, phase, disposition, retry counts, and metadata — only updating `reviewer` and `implementer` through the explicit fallback path.

## Why Now
The autonomous review loop silently drops its own progress when a launcher falls back to a different agent family mid-flight. A mission at round 3 with a `fixing` phase and accumulated telemetry metadata resets to round 1, `reviewing`, null disposition, and zero retries. This causes wasted review cycles, lost telemetry, and broken session-restart semantics that the team has encountered in production worktrees.

## Refinement Signals
- Estimated agent % usage limit: 25-50%
- Confidence: High
- Selection note: activate as-is
- Main drivers: Silent data loss on resume, breaks session-restart semantics, wastes agent review cycles

## Scope
- `lib/review/review-loop.js` lines 597-599: the `startReviewLoop` identity-mismatch branch that constructs the `state` variable
- `lib/review/review-state.js` `ReviewState` class: ensure `constructor` and `from()` correctly merge persisted data with identity overrides
- `test/review-state.test.js` or `test/review-state-class.test.js`: add a regression test for persisted-state resume with differing identities
- Files outside `lib/review/` and `test/` are not touched

## Out of Scope
- Changes to `review-polling.js`, `review-artifacts.js`, `review-adapter.js`, or `review-prompts.js`
- Changes to agent launcher logic (`agents/agents.js`) or fallback selection (`selectAgent`)
- Changes to the `applyAgentFallback` function's identity-update semantics (already correct)
- Changes to graphify, handoff, rebase, or integration commands
- Changes to backlog/task management beyond the review-state file

## Success Criteria
> **Falsifiability rule (ADR 0039 Part 2):** Each criterion must be falsifiable.

1. After creating a persisted review-state with `round: 3, phase: 'fixing', disposition: 'REQUEST_CHANGES', startedAt: '2026-01-01T00:00:00.000Z', reviewer: 'codex', implementer: 'claude'`, invoking `startReviewLoop` with `reviewer: 'gemini', implementer: 'claude'` produces a `state` object where `state.round === 3`, `state.phase === 'fixing'`, `state.disposition === 'REQUEST_CHANGES'`, `state.startedAt === '2026-01-01T00:00:00.000Z'`, and `state.reviewer === 'gemini'`.
2. A regression test exists in `test/review-state*.test.js` that writes a persisted review-state file with round > 1 and differing reviewer identity, then asserts the resumed state preserves round, startedAt, phase, and disposition while updating the reviewer.
3. All existing tests in `test/review-state.test.js`, `test/review-state-class.test.js`, and `test/review.test.js` pass without modification.
4. `npm test` (the full test suite) passes with zero failures.
5. The `ReviewState.from()` method still returns the same instance when passed a `ReviewState` instance (no regression in existing identity).
6. The `ReviewState.constructor` still defaults `round` to 1 and `phase` to `'reviewing'` when called with no persisted data (fresh-start behavior preserved).

## Risks and Assumptions
- Risk: The `ReviewState.from()` method throws on slug mismatch. The fix must preserve this guard.
- Risk: `persisted.reviewer === reviewer && persisted.implementer === implementer` is a shallow equality check; adding new fields to persisted state won't affect it.
- Assumption: `applyAgentFallback` already correctly updates `state.reviewer`/`state.implementer` and calls `writeReviewState`; the fix must not duplicate that logic.
- Assumption: The persisted state file always contains valid JSON with `reviewer` and `implementer` keys (enforced by `readReviewState` returning null otherwise).
- Assumption: No other callers of `startReviewLoop` depend on the current identity-mismatch reset behavior.

## Checkpoints
- CP 1: Identify the exact code path and confirm the data-loss scenario by tracing `readReviewState` → `persisted` → state construction at review-loop.js:597-599
- CP 2: Draft the fix: always construct from `persisted` when available, then overwrite `reviewer`/`implementer` if they differ
- CP 3: Write the regression test covering persisted resume with differing reviewer identity
- CP 4: Run `npm test` to verify no regressions

## Gates
- [ ] ./scripts/verify-local.sh docs
- [ ] All 108+ tests in `test/*.test.js` pass via `npm test`
- [ ] Regression test added and passing

## Restricted Areas
- Do not modify `lib/commands/`, `lib/agents/`, `lib/core/`, `lib/tools/`, `prompts/`, `templates/`, `scripts/`, or `tools/`
- Do not modify `px.js`, `index.js`, or `package.json`
- Do not change the public API of `ReviewState`, `readReviewState`, `writeReviewState`, or `resetReviewState`
- Do not change the identity-fallback logic in `applyAgentFallback`

## Stop Rules
- Stop if the fix requires changing the `ReviewState` class constructor signature or adding new public methods
- Stop if any existing test in `test/review.test.js` or `test/review-state*.test.js` fails due to the change
- Stop if the fix would require changes to more than `review-loop.js`, `review-state.js`, and one test file
- Stop if the identity-mismatch branch is unreachable in the current code (unlikely but worth verifying)
