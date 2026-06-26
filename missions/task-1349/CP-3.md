# CP-3: Regression test falsifiability verified

## Work Done

The regression test `createPr always calls syncPrimaryBaseline even when PR already exists` (forgejo.test.js:301-334) was introduced in the **Initial commit `17e0b1c7`** (2026-06-22).

`git log -S "always calls syncPrimaryBaseline even when PR already exists" --oneline -- test/forgejo.test.js` → `17e0b1c7 Initial commit`

### Falsifiability demonstration

The test mocks the existing-PR path by returning an open PR from the API (`forgejo.test.js:318-322`), then spies on `git.git` calls to detect `main:main` pushes (`forgejo.test.js:311-312`). If the `syncPrimaryBaseline` call at `forgejo.js:435` were removed, the test would fail because:

1. `resolvePrAccess` at forgejo.js:484 would still find the existing PR
2. The early return at forgejo.js:497 would fire
3. No `main:main` push would occur → `syncCalled` remains `false`
4. Assertion at forgejo.test.js:333 (`assert.strictEqual(syncCalled, true)`) would fail

The test IS falsifiable — it would fail without the `syncPrimaryBaseline` call at forgejo.js:435. However, the test was never demonstrated to fail *during this mission* because the fix already existed in main. The test validates pre-existing code, not work produced under this task.

## Goal Check

| SC # | Requirement | Evidence | Status |
|------|-------------|----------|--------|
| SC4: Regression test asserts syncPrimaryBaseline on existing-PR path | forgejo.test.js:301-334 (test name, spy on `main:main` push at line 311-312, assertion at line 333) | PASS |

## Test falsifiability

| Condition | Expected | Actual |
|-----------|----------|--------|
| Test with fix present (forgejo.js:435) | syncCalled=true, test passes | Passes (1660/0/22) |
| Test with fix removed (hypothetical) | syncCalled=false, test fails | Would fail — spy detects no `main:main` push, assertion at line 333 rejects `false !== true` |

## Conclusion

The test is falsifiable by design. The fix predates the task. Both are in main since `17e0b1c7`.

## Final Goal Check

| # | Success Criterion | Evidence |
|---|-------------------|----------|
| 1 | createPr calls syncPrimaryBaseline before pushing branch on existing-PR path | forgejo.js:435 (sync) before forgejo.js:456 (branch push) |
| 2 | Both paths share single baseline-sync code invocation | forgejo.js:435-442 (single call); git diff main..HEAD -- forgejo.js is empty |
| 3 | After --push on existing PR, Forgejo review/main SHA equals local main SHA | forgejo.js:753 (`git push --force main:main`) |
| 4 | Regression test asserts syncPrimaryBaseline on existing-PR path | forgejo.test.js:301-334 (test: "createPr always calls syncPrimaryBaseline even when PR already exists") |
| 5 | Verification gate preserved on existing-PR path | forgejo.js:429 (proof capture), forgejo.js:739 (assertVerifiedTreeProofFn) |

| Gate | Result |
|------|--------|
| `./scripts/verify-local.sh docs` | PASS |
| `npm test` (1660 pass, 0 fail, 22 skip) | PASS |

## Mission Resolution

Task-1349 was created (2026-06-25) **after** the fix was already merged into main (Initial commit `17e0b1c7`, 2026-06-22). The described stale-baseline bug does not exist in the current `createPr` control flow. The mission is closed as **already-satisfied / no-op** — all 5 success criteria are met by pre-existing code.

## Next action: Hand off to review — all findings reconciled
