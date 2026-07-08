# CP-6: Verification and final status

## Summary

Completed the mission-scoped contract rewrite and runtime alignment for weak-agent Goal Check evidence. Drafted missions now carry explicit checkpoint instructions, execute and repair teach the same accepted evidence forms, and the runtime handoff/static-review messages now describe the same evidence categories that Parallix already verifies.

Mission verification is mixed. `./scripts/verify-local.sh static-analysis` passes. The focused regression coverage for handoff, static review, and repair-handoff passes. `./scripts/verify-local.sh all` still fails, but the remaining failure is no longer the original weak-agent `IncompleteEvidence` loop from the real-agent smoke path. The only remaining failing assertion is the separate runtime smoke test that expects `node px.ts --version` to run without `ERR_UNKNOWN_FILE_EXTENSION`, which is outside this mission's checkpoint-evidence scope.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Draft-time mission authoring now states the checkpoint documentation rules explicitly | `prompts/draft.md:28`, `templates/mission-scaffold.md:29` | PASS |
| Execute and repair now share one compatible evidence rule set aligned to runtime checks | `prompts/execute.md:17`, `lib/commands/repair-handoff.ts:246` | PASS |
| Autobounce repair guidance is now actionable for rejected shell-only rows | `test/repair-handoff.test.js:346`, `"buildRelaunchPrompt gives actionable replacement guidance for shell-only offending rows"` | PASS |
| Runtime handoff/static-review messaging now matches the accepted evidence categories in code | `lib/commands/handoff.ts:315`, `lib/review/review-commands.ts:407`, `test/handoff.test.js:634`, `test/handoff.test.js:699` | PASS |
| Focused regression coverage for the handoff/review/repair contract passes | `test/handoff.test.js:634`, `test/review-commands.test.js:229`, `test/repair-handoff.test.js:346`; supporting context: `node --test test/handoff.test.js test/review-commands.test.js test/repair-handoff.test.js` passed | PASS |
| Required `static-analysis` gate passes on the final tree | `lib/commands/handoff.ts:315`, `lib/review/review-commands.ts:407`; supporting context: `./scripts/verify-local.sh static-analysis` passed | PASS |
| Original weak-agent smoke symptom is reduced to a different blocker, not the prior `IncompleteEvidence` loop | `test/e2e-real-agent-smoke.test.js:605`, `test/px-runtime-smoke.test.js:8`; supporting context: `./scripts/verify-local.sh all` now fails only on `"px runtime smoke test verifies node px.ts executes without module resolution errors"` and does not surface the prior Goal Check evidence failure | PASS |
| Mission-declared `all` gate passes | `test/px-runtime-smoke.test.js:8`; supporting context: `./scripts/verify-local.sh all` fails with `TypeError [ERR_UNKNOWN_FILE_EXTENSION]: Unknown file extension ".ts" for /home/magnus/code/parallix-task-2207/px.ts` | FAIL |

Next action: Treat `test/px-runtime-smoke.test.js:8` as a separate runtime-smoke blocker; do not hand off this mission for review until that unrelated `./scripts/verify-local.sh all` failure is resolved or explicitly waived under the mission stop rule.
