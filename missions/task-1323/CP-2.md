# CP-2: Rebase Call Implementation in performHandoff

## Implementation Summary

Added `rebaseBeforeReviewRound` import and call to `performHandoff` in `lib/commands/handoff.js`.

### Changes Made

1. **Import added** at `handoff.js:13`:
   ```js
   const { rebaseBeforeReviewRound } = require('../review/review-loop');
   ```

2. **Step 1.5 inserted** at `handoff.js:201-219` between Step 1 (verification gate) and Step 2 (Forgejo PR):
   - Calls `rebaseBeforeReviewRound(slug, { worktree, log, error, isForgejoReviewEnabledFn })`
   - Handles `{ ok: false, sharedFileConflicts: true }` → error with conflict resolution guidance
   - Handles `{ ok: false, sharedFileConflicts: false }` → error with rebase failure message
   - `{ ok: true }` → proceeds normally to Step 2

### Design Decisions
- Uses `isForgejoReviewEnabledFn` (already resolved in performHandoff at line 169) to avoid importing product-config twice
- Passes `log` and `error` from `performHandoff` options to maintain consistent logging
- Rebase runs in both Forgejo-enabled and disabled modes per mission scope requirement
- No PR is created/updated when rebase fails (early return before Step 2)

## Goal Check

| Criterion | Evidence | Status |
|-----------|----------|--------|
| Import of rebaseBeforeReviewRound | handoff.js:13 `require('../review/review-loop')` | PASS |
| Rebase call inserted at Step 1.5 | handoff.js:203-208 `await rebaseBeforeReviewRound(slug, {...})` | PASS |
| Shared-file conflict handling | handoff.js:210-213 returns error, no PR created | PASS |
| Rebase failure handling | handoff.js:214-218 returns error, no PR created | PASS |
| Success path continues to Step 2 | handoff.js:221 `// Step 2: Forgejo PR` follows rebase block | PASS |
| Uses existing forgejoEnabledFn | handoff.js:207 passes `isForgejoReviewEnabledFn` (set at line 169) | PASS |

Next action: CP-3 - Write tests for rebase integration in handoff.
