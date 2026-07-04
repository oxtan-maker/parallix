# CP-3: Harden restoreMainCheckoutStash() and Improve reportStashPopFailure()

## Summary

Two changes in `lib/commands/integrate.ts`:

1. **`restoreMainCheckoutStash()` (line ~1389)** — Changed from plain `git stash pop` to `git stash pop --index`. The `--index` flag tells git to attempt reapplying the index changes from the stash alongside the working-tree changes. Collisions are left as merge conflicts rather than silently overwriting files. Added `[RESTORE]` prefix to the log message.

2. **`reportStashPopFailure()` (line ~163)** — Added `[RESTORE]` prefix, improved diagnostic formatting with consistent indentation, labeled collision files explicitly ("Collision file:" instead of bare dashes), and improved raw output formatting.

## Goal Check

| # | Requirement | Evidence |
|---|-------------|----------|
| 1 | Safe restore semantics | `lib/commands/integrate.ts:1395` — `stash pop --index` |
| 2 | [RESTORE] prefix on restore | `lib/commands/integrate.ts:1390` — `[RESTORE] Restoring temporarily stashed...` |
| 3 | Improved collision diagnostics | `lib/commands/integrate.ts:181-182` — labeled "Collision file:" entries |
| 4 | Clear recovery commands | `lib/commands/integrate.ts:183-189` — numbered recovery steps with rootDir |
| 5 | Stash pop failure type labeling | `lib/commands/integrate.ts:180` — "merge-conflict" vs "file-collision" |

## Next action
Update existing stash/restore tests in `test/integrate.test.js` to accommodate the new `--index` flag and [RESTORE]/[STASH] prefixes.
