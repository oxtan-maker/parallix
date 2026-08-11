# CP-1: Failing Regression Test

## Summary

Authored `test/task-2358-multi-round-repro.test.ts` with 3 tests:

1. **`multi-round fixture does not collapse to 1 round`** — Seeds mock `MissionStore` with 3 distinct rounds (different reviewer/implementer/disposition per round), findings, resolutions, and review events. Asserts `loadReview()` returns all 3 rounds with correct fields. **FAILS on parent commit** (1 round returned instead of 3).
2. **`zero-round mission falls back to flat ReviewState`** — Verifies SC7 fallback path when store has no review.
3. **`null missionStore falls back to flat ReviewState`** — Verifies SC7 fallback when store is absent.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Regression test file exists | `test/task-2358-multi-round-repro.test.ts` | PASS |
| Test fails on parent commit (red) | `"multi-round fixture does not collapse to 1 round"` — `1 !== 3` AssertionError | PASS |
| 3-round fixture with distinct values | `test/task-2358-multi-round-repro.test.ts:70-95` (rounds 1-3 with codex/claude/gemini reviewers) | PASS |
| Fallback test for zero-round mission | `"zero-round mission falls back to flat ReviewState"` | PASS |
| Fallback test for null store | `"null missionStore falls back to flat ReviewState"` | PASS |

Next action: CP-2 — Rewrite `ConcreteReviewReadAdapter.loadReview()` to read from `missionStore.load()` directly and verify regression test turns green.
