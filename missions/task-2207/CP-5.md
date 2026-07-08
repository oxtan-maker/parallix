# CP-5: Match runtime messaging to the clarified contract

## Summary

Kept the runtime Goal Check validator behavior intact and instead corrected the runtime-facing messages around it. Handoff and static review still accept the same evidence forms as before, including recognized repo commands/paths, but the failure text now says that explicitly so the repair loop is no longer teaching a narrower contract than the code actually enforces.

Focused coverage still locks the important boundary. Handoff has an explicit red test for shell-only `stat` output and a green test for file:line evidence plus supporting shell context in the same cell. Static review has a matching rejection test for shell-only evidence.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Handoff failure text now names the accepted evidence categories that already exist in code | `lib/commands/handoff.ts:315` | PASS |
| Static review failure text now names the accepted evidence categories that already exist in code | `lib/review/review-commands.ts:407` | PASS |
| Rejection coverage proves shell-only evidence is still invalid | `test/handoff.test.js:634`, `test/review-commands.test.js:229`, `node --test test/handoff.test.js test/review-commands.test.js test/repair-handoff.test.js` | PASS |
| Acceptance coverage proves file:line evidence remains valid even with supporting shell context | `test/handoff.test.js:699`, `node --test test/handoff.test.js test/review-commands.test.js test/repair-handoff.test.js` | PASS |
| No unrelated mission history was rewritten as part of this alignment step | `missions/task-1398/CP-4.md:55` | PASS |

Next action: Run the mission-declared gates plus the most relevant workflow regression coverage, then update the backlog task and final checkpoint with exact verification evidence for handoff.
