# CP-4: Verification gate, static analysis, docs, Goal Check (TASK-2494)

## Summary
Ran the mission gate and static-analysis gate, updated docs, and produced this Goal Check table.

Changes:
- `src/application/rebase-workflow.ts`: rebase-handoff usage-block fallback (substitute eligible family, else reset-time diagnostic).
- `src/application/failure-classification.ts`: additive `AgentCapacity` class + usage-block classifier rule checked before `InfraBlocker`.
- `test/task-2494-repro.test.ts`: four hermetic in-memory-fake repro tests.
- `test/default-test-suite.test.ts`: classify the repro as a hermetic unit test (removed the stale `.integration.test.ts` registration).
- `docs/adr/0048-...md`: documented the agent-capacity classifier refinement and rebase-handoff behavior.
- `missions/task-2494/MISSION.md`: corrected the Reproduction-Test line to the unit test.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC1 substitution when policy permits | `test/task-2494-repro.test.ts`, `"TASK-2494 repro: usage-blocked pinned implementer substitutes an eligible replacement family when policy permits"` (asserts `conflict-resolution` launched as `mistral`, unpinned, rebase exits 0) | PASS |
| SC2 reset-time diagnostic, no `forgejo`/`infrastructure`/`credential`/`does not substitute` | `test/task-2494-repro.test.ts`, `"TASK-2494 repro: usage-blocked pinned implementer during rebase conflict names the usage block and reset time, never infra/Forgejo"` | PASS |
| SC3 non-`InfraBlocker` / non-`HumanOnly` + `hasExplicitHumanOnlyDiagnostic` false | `test/task-2494-repro.test.ts`, `"TASK-2494 repro: usage-block diagnostic classifies as a non-InfraBlocker, non-HumanOnly class"` | PASS |
| SC4 `./scripts/verify-local.sh all` passes | `missions/task-2494/proof/verify-all.log` — `tests 2520 / pass 2520 / fail 0`; gate exit 0 | PASS |
| SC5 ESLint + `tsc --checkJs` clean, no `.only`/`.skip` | `./scripts/verify-local.sh static-analysis` (ESLint clean, tsc typecheck clean, test-hygiene clean, test typecheck clean) | PASS |
| SC6 behavior change documented | `docs/adr/0048-fail-closed-harness-defense-against-agent-hallucinations.md` "Agent-capacity diagnostics are not infrastructure blockers (task-2494)" | PASS |
| Bug repro is red at parent, green after fix | `test/task-2494-repro.test.ts` — 3 assertions failed on parent `fbff97f97~1`, all 4 green post-fix | PASS |
| Restricted areas untouched | git diff touches only `rebase-workflow.ts`, `failure-classification.ts`, `test/task-2494-repro.test.ts`, `test/default-test-suite.test.ts`, `docs/adr/0048-...md`, `MISSION.md`; `src/adapters/agents/agents.ts`, `config/agents.json`, Forgejo code unchanged | PASS |

## Next action
All checkpoints committed and the gate passes; mission complete. No further action.
