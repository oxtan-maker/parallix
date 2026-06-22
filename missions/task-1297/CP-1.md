# CP-1: Reproduce the False Positive

## Work Done

Confirmed the false positive described in the mission: the regex in `lib/core/mission-utils.js:539` matches `server` from prose text `"We should run ./scripts/deploy.sh server before merging"` instead of falling through to the `'docs'` default.

### Evidence

```
$ node -e "
  const content = 'We should run ./scripts/deploy.sh server before merging';
  const regex = /(?:^|\s)\.{1,2}\/[\w./-]+\s+([a-zA-Z0-9_-]+)/m;
  const match = content.match(regex);
  console.log('Matched area:', match ? match[1] : 'none');
"
Matched area: server
Expected: docs (fallback)
False positive: true
```

The old regex `/(?:^|\s)\.{1,2}\/[\w./-]+\s+([a-zA-Z0-9_-]+)/m` matches any `./` or `../`-prefixed path followed by a word, regardless of whether the area argument appears at the end of a line or mid-sentence in prose.

## Goal Check

| Criterion | Status | Evidence |
|-----------|--------|----------|
| False positive reproduced | PASS | `./scripts/deploy.sh server before merging` yields `'server'` instead of `'docs'` — lib/core/mission-utils.js:539 |

## Next action
Design and implement the tightened regex (CP-2). The new pattern must require the area argument to be at end-of-line and restrict paths to verified script extensions (.sh/.bash/.py/.rb) or bare executables without dots.
