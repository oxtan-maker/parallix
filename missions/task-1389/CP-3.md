# CP-3: Refactor repairHandoff() to use classifyError(), update isRelaunchableError, backward-compatibility tests

## Goal

Refactor `repairHandoff()` to use `classifyError()` internally for dirty/behind/relaunchable patterns while preserving existing auto-commit and auto-rebase behavior. Update `isRelaunchableError` to delegate to `classifyError`. Export `classifyError` and `getDispatchAction` as named exports. Add backward-compatibility tests verifying SC4. Run `./scripts/verify-local.sh all`.

## Work Done

1. Refactored `repairHandoff()` in `lib/commands/repair-handoff.js:265-280` to use `classifyError()` internally instead of separate `isDirtyError`/`isBehind` boolean checks
   - Replaced inline dirty/behind pattern checks with `classifyError(errorMsg)` call
   - Used `classification.failureClass === FailureClass.GitBlockers` to determine repairability
   - Kept `isBehind` check for rebase-specific logic (behind triggers rebase; dirty does not)
2. Updated `isRelaunchableError` in `lib/commands/repair-handoff.js:71-85` to delegate to `classifyError()`:
   - Returns true only for `IncompleteEvidence` and `GateFailure` (the only classes that were relaunchable under old logic)
3. Updated `lib/commands/repair-handoff.ts` with identical refactoring
4. Exported `classifyError` and `getDispatchAction` as named exports (already done in CP-1)
5. Added 14 backward-compatibility tests in `test/repair-handoff.test.js:492-586`
6. Static analysis gate passed: ESLint clean, tsc typecheck clean, test-hygiene clean

## Goal Check

| Goal Check | Evidence | Status |
|---|---|---|
| SC3: repairHandoff uses classifyError for dirty errors | `test/repair-handoff.test.js:565` `repairHandoff uses classifyError internally for dirty errors` — repaired:true | PASS |
| SC3: repairHandoff uses classifyError for behind errors | `test/repair-handoff.test.js:583` `repairHandoff uses classifyError internally for behind errors` — repaired:true, rebase called | PASS |
| SC3: repairHandoff returns false for non-GitBlocker errors | `test/repair-handoff.test.js:589` `repairHandoff returns false for non-GitBlocker errors` — repaired:false | PASS |
| SC4: isRelaunchableError backward compat (goal-check true) | `test/repair-handoff.test.js:500` — PASS | PASS |
| SC4: isRelaunchableError backward compat (null false) | `test/repair-handoff.test.js:506` — PASS | PASS |
| SC4: isRelaunchableError backward compat (undefined false) | `test/repair-handoff.test.js:511` — PASS | PASS |
| SC4: isRelaunchableError backward compat (empty false) | `test/repair-handoff.test.js:516` — PASS | PASS |
| SC4: isRelaunchableError backward compat (unknown false) | `test/repair-handoff.test.js:521` — PASS | PASS |
| SC4: isRelaunchableError backward compat (dirty false) | `test/repair-handoff.test.js:526` — PASS | PASS |
| SC4: isRelaunchableError backward compat (behind false) | `test/repair-handoff.test.js:531` — PASS | PASS |
| SC4: isRelaunchableError backward compat (verification-gate true) | `test/repair-handoff.test.js:536` — PASS | PASS |
| SC4: isRelaunchableError backward compat (declared-gate true) | `test/repair-handoff.test.js:541` — PASS | PASS |
| SC5: classifyError/getDispatchAction exported | `test/repair-handoff.test.js:380` — PASS | PASS |
| Gate: Static analysis passes | `./scripts/verify-local.sh static-analysis` — ESLint clean, tsc clean, test-hygiene clean | PASS |
| Gate: All 52 repair-handoff tests pass | `node --test test/repair-handoff.test.js` — 52 pass, 0 fail | PASS |

## Review Round 1: Findings Fixed

### Finding 1 (moderate) — `isBehind` still duplicated pattern matching
**Fixed:** Added `reason` field to `classifyError()` return value (`'dirty' | 'behind' | undefined`) distinguishing dirty-artifact from behind-branch GitBlockers. `repairHandoff()` now derives `isBehind` from `classification.reason === 'behind'` instead of duplicating the pattern-matching code.

**Evidence:**
- `lib/commands/repair-handoff.ts:51-61` — `classifyError()` returns `reason: 'dirty'` or `reason: 'behind'` for GitBlockers
- `lib/commands/repair-handoff.ts:253` — `isBehind` derived from `classification.reason === 'behind'`
- `test/repair-handoff.test.js:594` — `classifyError returns reason field for GitBlockers (dirty and behind)` — PASS
- `test/repair-handoff.test.js:600` — `repairHandoff derives isBehind from classifyError reason (dirty only, no rebase)` — PASS

### Finding 2 (informational) — Stale branch base
**Fixed:** Rebased `mission/task-1389` onto current `main`. The branch was originally rebased onto `origin/main` (which lagged local `main` by 70 commits), causing the diff against `main` to show unrelated noise. After rebasing onto local `main`, `git merge-base main HEAD` is `c484afa3` (current main tip), and `git diff main..HEAD` contains only mission-relevant files: `repair-handoff.{ts,js}`, `test/repair-handoff.test.js`, and mission artifacts (`missions/task-1389/*`).

## Final Gate Results

| Gate | Result |
|---|---|
| `./scripts/verify-local.sh static-analysis` | PASS — ESLint clean, tsc clean, test-hygiene clean |
| `npm test` | PASS — 1830 pass, 0 fail, 22 skipped |
| `node --test test/repair-handoff.test.js` | PASS — 54 pass, 0 fail |
