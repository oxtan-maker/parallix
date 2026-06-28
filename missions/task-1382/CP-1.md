# CP-1: Audit prompts/ for stale references

## Work Done

Audited all 7 files under `prompts/`:
- `prompts/act-on-review-verbose.md`
- `prompts/act-on-review.md`
- `prompts/review-verbose.md`
- `prompts/review.md`
- `prompts/portfolio.md`
- `prompts/execute.md`
- `prompts/draft.md`

Ran `grep -r "Estimated agent % usage limit" prompts/` — found exactly 1 match at `prompts/portfolio.md:17`.

`prompts/draft.md` has no explicit NEL bucket instruction in its "Drafting requirements" section (line 20-27).

## Conclusion

Only two files need changes:
1. `prompts/portfolio.md:17` — replace stale string with NEL bucket terminology
2. `prompts/draft.md` — add explicit NEL bucket instruction to Drafting requirements

No other prompt files under `prompts/` contain stale references. Scope is within the 2-file limit; no escalation needed.

## Goal Check

| Criterion | Evidence | Status |
|-----------|----------|--------|
| No other prompt files need updating | `grep -r "Estimated agent % usage limit" prompts/` returned 1 match only at `prompts/portfolio.md:17` | PASS |
| draft.md lacks NEL bucket instruction | `prompts/draft.md` lines 20-27 (Drafting requirements) contain no NEL bucket mention | PASS |

## Next action
Proceed to CP-2: Update `prompts/portfolio.md` line 17 to use NEL bucket terminology.
