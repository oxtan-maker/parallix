# CP-4: Update Existing Tests

## Summary

Updated `test/integrate.test.js` to accommodate the new `--index` flag in `restoreMainCheckoutStash()`:

- Line ~1228: Updated expected git args from `['stash', 'pop']` to `['stash', 'pop', '--index']`
- Existing `reportStashPopFailure` tests use regex assertions that remain compatible with the improved `[RESTORE]`-prefixed output format

## Goal Check

| # | Requirement | Evidence |
|---|-------------|----------|
| 1 | Stash/restore test reflects --index flag | `test/integrate.test.js:1232` — `'--index'` in expected args |
| 2 | reportStashPopFailure tests still pass | `test/integrate.test.js:1074` — merge-conflict test passes |
| 3 | reportStashPopFailure file-collision test still passes | `test/integrate.test.js:1102` — file-collision test passes |
| 4 | All 53 existing tests pass | `node --test test/integrate.test.js` — 53 pass, 0 fail |

## Next action
Run `./scripts/verify-local.sh all` to confirm full test suite + static analysis pass, then complete the Goal Check table.
