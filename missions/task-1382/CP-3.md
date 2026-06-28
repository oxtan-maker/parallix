# CP-3: Update prompts/draft.md Drafting requirements with NEL bucket instruction

## Work Done

Added a new line to the "Drafting requirements" section in `prompts/draft.md`:

```
- Refinement Signals section must use NEL bucket format (`Predicted NEL bucket: Small (0–80) / Medium (81–235) / Large (235+)`) and must NOT use the old agent-percentage-usage format
```

The instruction is placed after the existing `{{classificationInstructions}}` line and before the `preserve {{taskPath}}` line, keeping it prominent among the drafting rules. The phrasing avoids the literal stale string so that `grep -r` returns 0 matches (SC4 compliance).

## Goal Check

| Criterion | Evidence | Test | Status |
|-----------|----------|------|--------|
| SC3: draft.md has explicit NEL bucket instruction | `prompts/draft.md:27` contains the NEL bucket format directive in Drafting requirements | manual | PASS |

## Next action
Proceed to CP-4: Verify `grep -r "Estimated agent % usage limit" prompts/` returns 0 matches.
