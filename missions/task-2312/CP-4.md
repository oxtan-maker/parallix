# CP-4: Final Verification

## Summary

Updated the reproduction test to verify the full sync behavior (green) and ran `./scripts/verify-local.sh all`.

### Changes

1. **Test file guards removed** (`test/task-2312-label-sync.test.ts`): Dropped `{ skip: !setTaskLabels }` and `{ skip: !syncTaskLabelsToBaseWorktree }` conditional guards. Exports are now imported unconditionally and verified at load time with `assert.ok(typeof ... === 'function')`, so the test file goes red the moment the sync path is removed.

2. **`draft.ts` uses `syncTaskLabelsToBaseWorktree`** (`src/platform/runtime/lib/commands/draft.ts:363`): Replaced the hand-copied sync block with a call to the shared `syncTaskLabelsToBaseWorktree` helper. This ensures one implementation is both shipped and tested.

3. **`setTaskLabels` return value checked** (`draft.ts:364-367`): The production path now checks the boolean return value and logs a WARN on failure instead of always logging PASS.

4. **`resolveBaseWorktree` exercised in test** (`test/task-2312-label-sync.test.ts:359`): Added a new test that calls `syncTaskLabelsToBaseWorktree(slug, missionWorktree)` without passing `baseRoot`, forcing `resolveBaseWorktree` to run.

5. **Out-of-scope changes removed**: `react-devtools-core` removed from `package.json`/`package-lock.json`, `tsconfig.tsbuildinfo` added to `.gitignore` and removed from the tree.

6. **Checkpoint line citations corrected**: CP-1 and CP-2 file:line references re-anchored to the final committed tree.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Reproduction test verifies sync behavior (green) | `test/task-2312-label-sync.test.ts:106`, `"CP-1 reproduction: labels diverge between mission and base worktree"` — step 7 asserts `syncTaskLabelsToBaseWorktree` succeeds | PASS |
| `setTaskLabels` writes inline format (SC1) | `src/platform/runtime/lib/tools/backlog.ts:914`, `test/task-2312-label-sync.test.ts:203` | PASS |
| `setTaskLabels` writes block format (SC2) | `src/platform/runtime/lib/tools/backlog.ts:925`, `test/task-2312-label-sync.test.ts:222` | PASS |
| `getTaskClassification` round-trip (SC3) | `src/platform/runtime/lib/tools/backlog.ts:914`, `test/task-2312-label-sync.test.ts:267` | PASS |
| Post-draft sync copies labels to base worktree (SC4) | `src/platform/runtime/lib/commands/draft.ts:355-370`, `src/platform/runtime/lib/tools/backlog.ts:960` | PASS |
| `resolveBaseWorktree` exercised in tests (SC4) | `test/task-2312-label-sync.test.ts:359`, `"syncTaskLabelsToBaseWorktree resolves base worktree via resolveBaseWorktree (SC4)"` | PASS |
| After sync, base worktree classification matches (SC5) | `test/task-2312-label-sync.test.ts:291`, `"syncTaskLabelsToBaseWorktree copies labels from mission to base worktree (SC4/SC5)"` | PASS |
| Regression test passes (SC6) | `test/task-2312-label-sync.test.ts` — 7 pass, 0 fail, 0 skipped | PASS |
| `./scripts/verify-local.sh all` passes (SC7) | `` `./scripts/verify-local.sh all` `` — 1290 pass, 0 fail | PASS |
| Test guards removed (unconditional imports) | `test/task-2312-label-sync.test.ts:8-14` | PASS |
| Single implementation used in production and tests | `draft.ts:363` calls `syncTaskLabelsToBaseWorktree` | PASS |
| Out-of-scope changes cleaned | `package.json` (no `react-devtools-core`), `.gitignore` (`tsconfig.tsbuildinfo`), `tsconfig.tsbuildinfo` removed | PASS |

## Next action

Submit for review — all success criteria met, verification gate passed, and review findings addressed.
