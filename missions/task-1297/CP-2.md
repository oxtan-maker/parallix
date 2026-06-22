# CP-2: Design and Implement the Tightened Regex

## Work Done

Replaced the regex in `lib/core/mission-utils.js:538` with a tightened pattern that:
1. Requires scripts to have recognized extensions (`.sh`, `.bash`, `.py`, `.rb`) or be bare executables (no dots, starting with lowercase letter)
2. Requires the area argument to be at end-of-line (followed by `$` or `\n`), preventing mid-sentence prose matches
3. Updated the inline comment to accurately describe the new matching criteria

### Old regex
```
/(?:^|\s)\.{1,2}\/[\w./-]+\s+([a-zA-Z0-9_-]+)/m
```

### New regex
```
/(?:^|\s)(?:\.{1,2}\/[\w.\/-]+\.(?:sh|bash|py|rb)|\.{1,2}\/[a-z][\w-]*)\s+([a-zA-Z0-9_-]+)\s*(?:$|\n)/m
```

### Key changes
- Path matching narrowed to scripts with `.sh`/`.bash`/`.py`/`.rb` extensions OR bare executables (`./gate` style, no dots)
- Area capture requires end-of-line anchoring (`\s*(?:$|\n)`) to reject mid-sentence matches
- Inline comment updated to reflect the new constraints

### Test results
- `npm test`: 1556 passed, 0 failed, 22 skipped — zero regressions

## Goal Check

| Criterion | Status | Evidence |
|-----------|--------|----------|
| All 8 existing assertions pass | PASS | test/mission-utils.test.js:121-135 — `detectMissionAreaFromContent uses repo gates deterministically` |
| npm test zero regressions | PASS | `npm test` output: 1556 passed, 0 failed |
| Comment accurately describes matching | PASS | lib/core/mission-utils.js:532-536 — updated to mention extension/bare-executable restriction and end-of-line requirement |
| False positive eliminated | PASS | `./scripts/deploy.sh server before merging` now yields `'docs'` (fallback) |

## Next action
Add a regression test for the prose false-positive case ("We should run ./scripts/deploy.sh server before merging" must yield `'docs'`) and confirm it fails with the old regex but passes with the new one.
