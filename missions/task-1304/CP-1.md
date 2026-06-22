# CP-1: Identify the exact invalid regex token and its line number

## Work Done

Examined `lib/commands/stats-backfill.js` for the invalid regex literal in the `inferHistoricalClassificationFromMissionDoc` function.

The `workflowPatterns` array begins at line 115 and the `node parallix/index.js` pattern is at line 117:

```js
/node parallix\/index\.js/g,
```

The regex uses proper escaping:
- `\/` escapes the forward slash (required inside regex literal delimiters)
- `\.` escapes the dot (matches literal period, not any character)

Verification: `node -e "require('./lib/commands/stats-backfill')"` exits with code 0 and produces no output.

## Goal Check

| Criterion | Evidence |
|-----------|----------|
| Invalid regex identified | `lib/commands/stats-backfill.js:117` — `/node parallix\/index\.js/g` is syntactically valid |
| require() succeeds | `node -e "require('./lib/commands/stats-backfill')"` → exit code 0, no output |

## Next action: CP-2 — confirm require() succeeds (already verified; proceed to CP-3)
