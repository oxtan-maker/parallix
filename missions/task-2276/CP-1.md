+# CP-1

## Summary

Captured the mission-base inventory at commit `15594359`: 158 `test/**/*.test.js` suites and one existing TypeScript suite. Audited filename-sensitive runner, configuration, hygiene, integration-gate, and test reference locations before conversion. No tests are parked at this checkpoint.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Baseline inventory accounts for each suite once | `missions/task-2276/mission-base-inventory.txt:1` | PASS |
| Converted pairs retain Git rename traceability | `git diff -M50% 15594359` will be run against the captured baseline | PENDING CP-3 |
| Test behavior and boundaries remain unchanged | `missions/task-2276/mission-base-inventory.txt:1` establishes the conversion-only scope | PENDING CP-2 |
| TypeScript suppressions are localized and reasoned | `missions/task-2276/CP-2.md` will record any suppression locations | PENDING CP-2 |
| Discovery paths recognize TypeScript tests | `missions/task-2276/discovery-audit.txt:1`; `tsconfig.test.json:13`; `test/run-default-tests.js:57`; `scripts/test-hygiene.sh:19` | PASS (audit complete) |
| History reaches pre-migration commits | `git log --follow -- <converted-path>.test.ts` is scheduled for CP-4 | PENDING CP-4 |
| Parked tests have follow-up tasks | `missions/task-2276/mission-base-inventory.txt:161` records no parked tests at baseline | PASS |
| Required verification gates pass | `npx tsc --noEmit --project tsconfig.test.json`; `./scripts/verify-local.sh static-analysis`; `./scripts/verify-local.sh all` are scheduled for CP-4 | PENDING CP-4 |
| Migration commit can be reverted cleanly | `git revert --no-commit <migration-commit>` is scheduled for CP-4 | PENDING CP-4 |

Next action: rename the 158 captured suites with `git mv` in reviewable batches, preserving contents before any compatibility edits.

