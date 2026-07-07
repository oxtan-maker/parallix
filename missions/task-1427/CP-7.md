# CP-7: Separator-Only Goal Check Rows Rejected

## Summary

This checkpoint closes the reviewed C7 regression. The Goal Check validator now rejects separator-only rows in both the handoff path and the mirrored pre-review static-review path, so a table like `|---|---|---|` no longer counts as evidence.

The mission-specific direct tests are green:

- `node --test test/handoff.test.js --test-name-pattern "separator-only goal-check table|header-only goal-check table|placeholder prose only|auto-remediates missing checkpoints"` → `69 pass, 0 fail`
- `node --test test/review-commands.test.js --test-name-pattern "separator-only Goal Check tables|placeholder-only Goal Check evidence rows|accepts Goal Check evidence that cites a real test name"` → `20 pass, 0 fail`
- `./scripts/verify-local.sh static-analysis` → PASS

The mission-declared `./scripts/verify-local.sh all` gate still fails, but the remaining failure is outside this mission's scope: `not ok 1157 - px runtime smoke test verifies node px.ts executes without module resolution errors`.

## Goal Check

| Goal Check | Evidence | Status |
|---|---|---|
| Separator-only rows no longer count as Goal Check evidence during handoff. | `lib/commands/handoff.ts:51-71` updates `separatorPattern` to match full separator rows; `node --test test/handoff.test.js --test-name-pattern "separator-only goal-check table"` now passes | PASS |
| Pre-review static review mirrors the same separator-row rejection. | `lib/review/review-commands.ts:98-118` uses the same full-row separator pattern; `node --test test/review-commands.test.js --test-name-pattern "separator-only Goal Check tables"` now passes | PASS |
| Placeholder-only evidence still fails while real evidence still passes. | `node --test test/handoff.test.js --test-name-pattern "placeholder prose only|auto-remediates missing checkpoints"` and `node --test test/review-commands.test.js --test-name-pattern "placeholder-only Goal Check evidence rows|accepts Goal Check evidence that cites a real test name"` | PASS |
| The required `lib/` integration gate passes after the C7 follow-up. | `./scripts/verify-local.sh static-analysis` → `PASS: ESLint clean`, `PASS: tsc typecheck clean`, `PASS: no test-hygiene violations` | PASS |
| The repo-wide `all` gate still has one unrelated failing test, so the mission cannot claim a fully green bundle. | `./scripts/verify-local.sh all` → `not ok 1157 - px runtime smoke test verifies node px.ts executes without module resolution errors`; summary `2026 pass, 1 fail, 22 skipped` | BLOCKED |

## Next Step

This mission is ready for re-review with the C7 regression fixed. The remaining `all` gate failure should be treated as a separate baseline issue unless the reviewer expects this mission to absorb it.
