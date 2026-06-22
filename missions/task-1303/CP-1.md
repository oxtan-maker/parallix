# CP-1: Inject `performHandoffFn` and implement the self-heal sequence

## Summary
Injected `performHandoffFn = performHandoff` into `startReviewLoop`'s destructured
options block so the self-heal is mockable, and replaced the post-implementation
hard-fail branch with the self-heal sequence (attempt handoff → re-check PR → recover or
fall back), gated to `!dryRun`. `performHandoff` was already imported at
`lib/review/review-loop.js:21`, so no import change was needed.

The self-heal sequence, on a post-implementation/ambiguous task with no open PR:
1. Logs INFO that no open PR exists and an automatic handoff is being attempted.
2. Calls `await performHandoffFn(slug, { forgejoUser: implementer, worktree })`.
3. On `gatekeeperPushedBack` → artifacts-missing error + `exit(1)` (CP-2 detail).
4. On `!handoff.ok` → fallback guidance + `exit(1)` (CP-2 detail).
5. On `handoff.ok` → re-calls `getPrStatusFn(branch, worktree)`; if a PR now exists and is
   open, sets `prNumber` and falls through into the normal loop; otherwise fallback +
   `exit(1)`.

The `active` implementation-phase soft-warning path (early `return`, no `exit`) is
untouched, and `performHandoffFn` is never reached for it because it returns first.

## Goal Check

| Mission item | Evidence | Status |
|---|---|---|
| Inject `performHandoffFn = performHandoff` (mockable default) | `lib/review/review-loop.js:327` | ✅ |
| `performHandoff` already imported (no import edit) | `lib/review/review-loop.js:21` | ✅ |
| Self-heal attempt with `{ forgejoUser: implementer, worktree }` | `lib/review/review-loop.js:574` | ✅ |
| Re-check PR after successful handoff; set `prNumber`, fall through | `lib/review/review-loop.js:591-600` | ✅ |
| Gated to `!dryRun` (self-heal inside `if (!dryRun && forgejoEnabled)`, dry-run short-circuits) | `lib/review/review-loop.js:519,566-571` | ✅ |
| `active` soft-warning path unchanged (early return, no exit) | `lib/review/review-loop.js:547-551` | ✅ |
| Module loads; full review suite green | `node --test test/review.test.js` → `pass 111 / fail 0` | ✅ |

## Next action
Write CP-2: document the corrected `--push` fallback message (with handoff reason) and the
`gatekeeperPushedBack` short-circuit already implemented at
`lib/review/review-loop.js:560-588`, then proceed to CP-3 test updates.
