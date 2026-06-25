# CP-1: Trace the data-loss scenario

## Summary

Confirmed the identity-mismatch branch in `startReviewLoop` that silently drops persisted round data.

Trace of the resume path:
1. `lib/review/review-loop.js:312` — `const persisted = readReviewStateFn(slug, worktree)` reads the persisted `ReviewState` (or a plain object in tests). `readReviewState` (`review-state.js:37-51`) returns `null` unless the file parses and has both `reviewer` and `implementer` keys.
2. `lib/review/review-loop.js:317` — persisted `implementer` is resumed. `lib/review/review-loop.js:445-447` — persisted `reviewer` is resumed with `reviewerSource='persisted'`.
3. Reviewer selection (lines 449-592) can override `reviewer` when the persisted reviewer's launcher is unsupported/blocked (single-family fallback at 566, auto-derived fallback at 588), so the selected `reviewer` can legitimately differ from `persisted.reviewer`.
4. **`lib/review/review-loop.js:597-599`** — the bug:
   ```js
   const state = persisted && persisted.reviewer === reviewer && persisted.implementer === implementer
     ? ReviewState.from(slug, persisted)
     : new ReviewState(slug, { reviewer, implementer });
   ```
   When `persisted` exists but either identity differs, the branch falls to `new ReviewState(slug, { reviewer, implementer })`. The `ReviewState` constructor (`review-state.js:143-156`) then defaults `round` to 1, `startedAt` to now, `phase` to `'reviewing'`, `disposition` to `null`, both retry counts to 0, and `metadata` to `{}` — discarding every persisted field except the identities.

Confirmed downstream impact: `lib/review/review-loop.js:619` reads `const initialRound = state.round` and `:621` loops `for (let attempt = initialRound; ...)`. A reset `state.round === 1` restarts the loop from round 1, re-running already-completed review cycles. The resume banner at `:602-604` (`state.round > 1`) is also suppressed.

`ReviewState.from` (`review-state.js:158-166`) returns the same instance for a `ReviewState` input (guarding slug mismatch) and constructs a fresh instance from a plain object — both forms appear in tests, so the fix must accept either.

## Goal Check

| Item | Evidence |
| --- | --- |
| Bug branch located | `lib/review/review-loop.js:597-599` — ternary falls to `new ReviewState(slug, { reviewer, implementer })` on identity mismatch |
| Persisted state source confirmed | `lib/review/review-loop.js:312`; `readReviewState` at `lib/review/review-state.js:37-51` |
| Data loss mechanism confirmed | `ReviewState` constructor defaults at `lib/review/review-state.js:148-154` (round→1, startedAt→now, phase→reviewing, disposition→null, retries→0, metadata→{}) |
| Downstream impact confirmed | `lib/review/review-loop.js:619-621` loop seeded by `state.round`; resume banner `:602-604` |
| Reachability confirmed (Stop Rule) | Reviewer can be reassigned via fallback at `lib/review/review-loop.js:566` and `:588`, so the mismatch branch is reachable |
| `ReviewState.from` accepts instance + plain object | `lib/review/review-state.js:158-166`; plain-object persisted used in `test/review.test.js:2078,2160` |

Next action: In CP-2, rewrite `review-loop.js:597-599` to always build `state` from `persisted` via `ReviewState.from` when present, then overwrite `state.reviewer`/`state.implementer` with the selected identities, falling back to a fresh `ReviewState` only when `persisted` is null.
