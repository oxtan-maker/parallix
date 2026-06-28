# CP-5: Run npm test to confirm no regressions

## Work Done

### Scope Splitting (Response to Review Finding 1)

The initial implementation diff contained ~40 files with changes far outside the mission scope (12 `lib/agents/` CJS→ESM renames, deleted task-1372 artifacts, deleted task-1384 backlog tasks, config file modifications, etc.). Per the reviewer's recommendation, the branch was reset to `main` and only the in-scope changes were re-applied:

- `prompts/portfolio.md:17` — replaced `Estimated agent % usage limit` with `Predicted NEL bucket`
- `prompts/draft.md:27` — added explicit NEL bucket instruction in Drafting requirements
- `backlog/tasks/task-1382` — marked AC and DOD complete
- `missions/task-1382/` — created MISSION.md, CP-1.md through CP-5.md, nel-record.json, review-state.json

All out-of-scope changes were reverted: task-1372 artifacts restored, task-1384 files restored, task-1366 status restored, lib/agents/ files restored to TypeScript, config files restored.

### Test Results

Ran `npm test` — all tests passed with zero failures.

Results:
- 1751 tests total
- 1729 passed
- 22 skipped
- 0 failed

Prompt-only changes have no behavioral impact on the test suite.

## Goal Check

| Criterion | Evidence | Test | Status |
|-----------|----------|------|--------|
| SC5: npm test passes with zero failures | `npm test` returned 1729 pass, 0 fail, 22 skipped | npm test | PASS |

## Goal Check

| Success Criterion | Evidence | Status |
|-------------------|----------|--------|
| SC1: portfolio.md:17 no longer contains "Estimated agent % usage limit" | `grep "Estimated agent % usage limit" prompts/portfolio.md` returns 0 matches | PASS |
| SC2: portfolio.md:17 references NEL bucket terminology | `prompts/portfolio.md:17` contains `- Predicted NEL bucket (`n/a` if not ready)` | PASS |
| SC3: draft.md has explicit NEL bucket instruction in Drafting requirements | `prompts/draft.md:27` contains NEL bucket format directive | PASS |
| SC4: grep -r "Estimated agent % usage limit" prompts/ returns 0 | `grep -r` exited code 1 (no matches) | PASS |
| SC5: npm test passes with zero failures | 1729 pass, 0 fail, 22 skipped | PASS |

## Gates

| Gate | Status |
|------|--------|
| `./scripts/verify-local.sh docs` | PASS |
| `npm test` | PASS (1729 pass, 0 fail) |

## Next action
Run `graphify update .` to keep the graph current, then commit changes and hand off to review.
