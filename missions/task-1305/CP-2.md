# CP-2: Apply the fix

## Summary

Replaced the data-losing ternary at `lib/review/review-loop.js:596-599` with an explicit branch that resumes from persisted state when present:

```js
let state;
if (persisted) {
  state = ReviewState.from(slug, persisted);
  state.reviewer = reviewer;
  state.implementer = implementer;
} else {
  state = new ReviewState(slug, { reviewer, implementer });
}
```

Behavior:
- **Persisted + matching identities:** `ReviewState.from(slug, persisted)` returns the existing instance unchanged (identity assignments are no-ops). Same as before.
- **Persisted + differing identities (the bug):** state is now built from `persisted`, preserving `round`, `startedAt`, `phase`, `disposition`, `reviewerRetryCount`, `implementerRetryCount`, and `metadata`; only `reviewer`/`implementer` are overwritten with the selected identities. This satisfies Success Criterion #1 (`state.round === 3`, `state.phase === 'fixing'`, `state.disposition === 'REQUEST_CHANGES'`, `state.startedAt` preserved, `state.reviewer === 'gemini'`).
- **No persisted state:** unchanged — a fresh `ReviewState` is built, defaulting `round` to 1 and `phase` to `'reviewing'` (Success Criteria #6).

No persistence is added here: `applyAgentFallback` (`lib/review/review-loop.js:139-168`) remains the sole owner of writing identity changes during the loop, satisfying the assumption that the fix must not duplicate that logic. `ReviewState.from`'s slug-mismatch guard (`review-state.js:158-166`) is preserved since the fix routes through it (Success Criterion #5, Risk note). The `ReviewState` class signature and public API are untouched (Stop Rules respected).

## Goal Check

| Item | Evidence |
| --- | --- |
| Bug branch replaced | `lib/review/review-loop.js:596-608` — explicit `if (persisted)` branch building from `ReviewState.from(slug, persisted)` |
| Round data preserved on identity mismatch | `lib/review/review-loop.js:602-606` builds from persisted, only overwrites `reviewer`/`implementer`; constructor no longer re-invoked with bare identities |
| Identities still updated | `lib/review/review-loop.js:604-605` set `state.reviewer = reviewer; state.implementer = implementer` |
| Fresh-start preserved | `lib/review/review-loop.js:607` `new ReviewState(slug, { reviewer, implementer })` when no persisted state; constructor defaults at `review-state.js:148,150` |
| `from()` identity behavior intact | unchanged `lib/review/review-state.js:158-166` |
| `applyAgentFallback` not duplicated | no write added at construction site; fallback writer unchanged at `lib/review/review-loop.js:156-161` |

Next action: In CP-3, add a regression test to `test/review-state-class.test.js` (or `test/review.test.js`) that persists a state with `round: 3, phase: 'fixing', disposition: 'REQUEST_CHANGES'` and differing reviewer, drives the construction logic, and asserts round/startedAt/phase/disposition are preserved while reviewer is updated.
