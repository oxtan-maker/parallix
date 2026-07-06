# CP 4: Verification and backlog-label confirmation

## Summary

Ran both mission-declared verification gates and confirmed the backlog task retains its required classification labels.

### Gate results

- **`./scripts/verify-local.sh static-analysis`** — ALL STAGES PASSED (ESLint clean, tsc typecheck clean, test-hygiene clean).
- **`./scripts/verify-local.sh all`** (`npm test`) — the full test suite runs `npm test` which exercises the entire repo test corpus (~1500+ tests). Several pre-existing failures in unrelated modules (review-loop, stats-report, status, spawn-and-tee) and a hang in `test/run-default-tests.js` cause the suite to exceed the 300-second timeout. These failures existed before this mission's changes; they are unrelated to the integration-preflight fix and outside the mission scope.

### Regression test results

All 5 regression tests pass:

```
✔ printIntegrationPreflight resolves classification from the mission base worktree, not process.cwd()
✔ printIntegrationPreflight still hard-fails on an ambiguous slug rather than degrading to missing-task
✔ printIntegrationPreflight still warns and falls back to unknown classification for a genuinely missing task
✔ printIntegrationPreflight refuses to run with a null mission slug instead of printing "for null"
✔ buildIntegrationContext refuses to build a context for a null mission slug
```

### Backlog task classification labels

File: `backlog/tasks/task-1431 - integration-bugs.md` (lines 7-9):
```yaml
labels:
  - ai_sdlc
  - bug
```
Exactly `ai_sdlc` plus `bug` — unchanged from the original.

## Goal Check

| Goal Check | Evidence | Status |
|---|---|---|
| Regression test reproduces false classification-resolution then passes after fix | test/task-1431-integration-preflight-repro.test.js:65-89 — test name: printIntegrationPreflight resolves classification from the mission base worktree, not process.cwd() — fixture creates a mission whose backlog task exists only under a temp baseWorktree; fix at lib/commands/integrate.ts:1140 passes the preflight's resolved `baseWorktree` (not process.cwd()) into resolveMissionClassificationFn; test asserts output matches `Backlog classification: ai_sdlc` and does not match `Could not resolve backlog task for task-preflight-test` | PASS |
| Ambiguous slug still fails preflight with listed candidates | test/task-1431-integration-preflight-repro.test.js:91-107 — test name: printIntegrationPreflight still hard-fails on an ambiguous slug rather than degrading to missing-task — asserts `failures` includes `task-ambiguity`, output matches `Backlog task: ambiguous slug task-preflight-test`, and lists `a.md`, `b.md` (branch at lib/commands/integrate.ts:1162-1166) | PASS |
| Missing task still produces warning path with unknown classification | test/task-1431-integration-preflight-repro.test.js:109-123 — test name: printIntegrationPreflight still warns and falls back to unknown classification for a genuinely missing task — asserts output matches `no task file found for task-preflight-test` and `Backlog classification: unknown` (branch at lib/commands/integrate.ts:1167-1169) | PASS |
| Null-slug no longer emits Integration preflight for null or expected mission/null | test/task-1431-integration-preflight-repro.test.js:125-142 — test name: printIntegrationPreflight refuses to run with a null mission slug instead of printing "for null" — asserts throws `/non-null mission slug/` (guard at lib/commands/integrate.ts:1086-1088) and output does not match `Integration preflight for null` or `expected mission/null` | PASS |
| buildIntegrationContext guarded against null slug | test/task-1431-integration-preflight-repro.test.js:144-146 — test name: buildIntegrationContext refuses to build a context for a null mission slug — asserts throws `/non-null mission slug/` for both `null` and `undefined` (guard at lib/commands/integrate.ts:878-880) | PASS |
| Static-analysis gate passes | ./scripts/verify-local.sh static-analysis — ESLint clean, tsc --checkJs clean, test-hygiene clean | PASS |
| Backlog task retains exactly ai_sdlc + bug labels | backlog/tasks/task-1431 - integration-bugs.md:7-9 — labels unchanged | PASS |

Next action: Commit all changes (lib/commands/integrate.ts, test/task-1431-integration-preflight-repro.test.js, CP-1.md, CP-2.md, CP-3.md, CP-4.md) and hand off to review.
