# CP-1: Handoff → Rebase Integration Analysis

## Analysis Summary

Identified the exact insertion point in `performHandoff` and parameter mapping:

### Insertion Location
- **File:** `lib/commands/handoff.js`
- **Between:** Step 1 (Final Gate Run, lines 184-199) and Step 2 (Forgejo PR, line 221)
- **New step label:** Step 1.5

### Parameter Mapping
| Parameter | Source | Value |
|-----------|--------|-------|
| `slug` | function argument | Mission slug string |
| `worktree` | `verification.rootDir` | Worktree directory path |
| `log` | `options.log` | `fmt.log.info` |
| `error` | `options.error` | `fmt.log.fail` |
| `isForgejoReviewEnabledFn` | `options.isForgejoReviewEnabledFn \|\| isForgejoReviewEnabled` | Provider detection function |

### Return Shape Handling
`rebaseBeforeReviewRound` returns `{ ok, sharedFileConflicts }`:
- `{ ok: true }` → continue to Step 2
- `{ ok: false, sharedFileConflicts: false }` → fail with clear error, no PR
- `{ ok: false, sharedFileConflicts: true }` → fail with conflict-resolution error, no PR

### Import Path
- `const { rebaseBeforeReviewRound } = require('../review/review-loop');`

### Contract Verification
- `rebaseBeforeReviewRound` signature requires no modification (task-1323 out-of-scope)
- Function auto-commits safe artifacts, handles Forgejo-disabled mode gracefully
- No shared-file conflict path modifies the Forgejo PR (safe)

## Goal Check

| Criterion | Evidence | Status |
|-----------|----------|--------|
| Insertion point identified | handoff.js:201 (Step 1.5 between Step 1 gate and Step 2 Forgejo PR) | PASS |
| Parameter mapping verified | rebaseBeforeReviewRound signature at review-loop.js:161-171 matches call arguments | PASS |
| Return shape coverage planned | Three branches: ok=true, ok=false/no-shared, ok=false/shared-conflicts | PASS |
| Import path confirmed | review-loop.js:1069 exports `rebaseBeforeReviewRound` | PASS |
| No signature modification needed | review-loop.js:161 signature unchanged by this mission | PASS |

Next action: CP-2 - Implement the rebase call with error handling in performHandoff.
