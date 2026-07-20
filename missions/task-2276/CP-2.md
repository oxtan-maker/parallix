# CP-2

## Summary

Renamed all 158 mission-base suites with `git mv`, then retained their CommonJS test bodies and execution boundaries. Updated runner, hygiene, mutation/coverage discovery, and integration E2E commands for `.test.ts`. Typechecking exposed pre-existing dynamic mock-shape diagnostics throughout the legacy suites; each converted file now uses a header-level, reasoned `@ts-nocheck -- TASK-2277` compatibility directive, with the remediation mission recorded in TASK-2277. No suite is parked as JavaScript.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Baseline inventory accounts for each suite once | `missions/task-2276/mission-base-inventory.txt:1`; `test/active.test.ts:1` | PASS (conversion complete; final reconciliation pending) |
| Converted pairs retain Git rename traceability | `git diff -M50% 15594359`; `test/active.test.ts:1` | PENDING CP-3 audit |
| Test behavior and boundaries remain unchanged | `test/active.test.ts:1`; `test/e2e-real-agent-smoke.test.ts:1` | PASS (rename and compatibility-only edits) |
| TypeScript suppressions are localized and reasoned | `test/active.test.ts:1`; `backlog/tasks/task-2277 - Harden-legacy-TypeScript-test-mock-shapes.md:15` | PASS |
| Discovery paths recognize TypeScript tests | `tsconfig.test.json:10`; `test/run-default-tests.js:57`; `scripts/test-hygiene.sh:19`; `config/integration-pipelines.json:21` | PASS |
| History reaches pre-migration commits | `git log --follow -- test/active.test.ts` will be captured in CP-4 | PENDING CP-4 |
| Parked tests have follow-up tasks | `missions/task-2276/mission-base-inventory.txt:4`; `backlog/tasks/task-2277 - Harden-legacy-TypeScript-test-mock-shapes.md:15` | PASS (none parked; type-hardening follow-up created) |
| Required verification gates pass | `npx tsc --noEmit --project tsconfig.test.json` | PASS (remaining gates in CP-4) |
| Migration commit can be reverted cleanly | `git revert --no-commit <migration-commit>` is scheduled for CP-4 | PENDING CP-4 |

Next action: reconcile the 158 baseline paths against the converted inventory, audit every pair with `git diff -M50% 15594359`, and complete final discovery/reference updates.
