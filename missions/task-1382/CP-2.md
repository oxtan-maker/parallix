# CP-2: Update prompts/portfolio.md line 17 to NEL bucket terminology

## Work Done

Updated `prompts/portfolio.md:17`:

**Before:**
```
- Estimated agent % usage limit (`n/a` if not ready)
```

**After:**
```
- Predicted NEL bucket (`n/a` if not ready)
```

The NEL bucket format matches the canonical format from ADR 0047 and task-1379.

## Goal Check

| Criterion | Evidence | Test | Status |
|-----------|----------|------|--------|
| SC1: No "Estimated agent % usage limit" in portfolio.md | `grep "Estimated agent % usage limit" prompts/portfolio.md` returns 0 | grep | PASS |
| SC2: portfolio.md:17 references NEL bucket | `prompts/portfolio.md:17` contains `- Predicted NEL bucket (`n/a` if not ready)` | manual | PASS |

## Next action
Proceed to CP-3: Update `prompts/draft.md` Drafting requirements with explicit NEL bucket instruction.
