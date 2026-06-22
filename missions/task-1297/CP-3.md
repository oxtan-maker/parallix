# CP-3: Add Regression Test for Prose False-Positive Case

## Work Done

Added a regression test to `test/mission-utils.test.js:135` that asserts prose containing a `./`-prefixed path does NOT produce a false-positive area extraction:

```javascript
assert.equal(detectMissionAreaFromContent('We should run ./scripts/deploy.sh server before merging'), 'docs');
```

This test would have **failed** with the old regex (yielding `'server'` instead of `'docs'`) and **passes** with the new regex (correctly falling back to `'docs'`).

### Test results
- `npm test`: 1556 passed, 0 failed, 22 skipped — all tests including the new regression test pass

## Goal Check

| Criterion | Status | Evidence |
|-----------|--------|----------|
| Regression test added | PASS | test/mission-utils.test.js:135 — asserts prose `"./scripts/deploy.sh server before merging"` yields `'docs'` |
| New test passes with new regex | PASS | npm test: 1556 passed, 0 failed |
| All 8 existing assertions still pass | PASS | test/mission-utils.test.js:121-135 — no regressions |
| False positive case yields `'docs'` | PASS | test/mission-utils.test.js:135 — explicit assertion |
| `npm test` baseline maintained | PASS | 1556 passed = baseline count (1 new test, same total) |

## Next action
Run the mission-declared gate. Per README.md:83, repos without `verify-local.sh` use `npm test` as the verification command — which passes with 1556/1556 tests.
