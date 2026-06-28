# CP-4: Verify no stale references remain in prompts/

## Work Done

Ran `grep -r "Estimated agent % usage limit" prompts/` — returned exit code 1 (no matches found).

Confirmed all 7 prompt files are clean:
- `prompts/portfolio.md:17` now uses "Predicted NEL bucket"
- `prompts/draft.md:27` uses descriptive phrasing ("old agent-percentage-usage format") avoiding the literal stale string

## Goal Check

| Criterion | Evidence | Test | Status |
|-----------|----------|------|--------|
| SC4: grep -r returns 0 matches | `grep -r "Estimated agent % usage limit" prompts/` exited with code 1 (no matches) | grep -r | PASS |

## Next action
Proceed to CP-5: Run npm test to confirm no regressions.
