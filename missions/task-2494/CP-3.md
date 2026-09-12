# CP-3: ADR 0048 failure-classifier fix (TASK-2494)

## Summary
Patched the ADR 0048 classifier in `src/application/failure-classification.ts` so an agent-capacity diagnostic is not misclassified as infrastructure:
- Added an additive `AgentCapacity` failure class mapped to `DispatchAction.AutoRepair` in the dispatch table (the eight original classes and their mappings are unchanged).
- Added a narrowly-scoped rule checked before the `InfraBlocker` rule: matches agent-capacity markers (`usage limit`, `hit your ... limit`, `quota`, a `429` tied to rate/usage/quota, `resource_exhausted`/resource-exhausted) and never a generic `limit`, so it does not widen the `HumanOnly` catch-all onto legitimate Forgejo/token/network failures.
- Fixed a JSDoc-closing-brace regression introduced while annotating the `GitBlockerReason` type.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC3 usage-block diagnostic is non-InfraBlocker / non-HumanOnly | `test/task-2494-repro.test.ts`, `"TASK-2494 repro: usage-block diagnostic classifies as a non-InfraBlocker, non-HumanOnly class"` | PASS |
| SC3 hasExplicitHumanOnlyDiagnostic returns false for usage block | `test/task-2494-repro.test.ts` assertion on `hasExplicitHumanOnlyDiagnostic` | PASS |
| Classifier does not widen HumanOnly catch-all | `test/task-2494-repro.test.ts`, `"TASK-2494 repro: classifier must not widen the HumanOnly catch-all to generic limit / infra markers"` (infra still `InfraBlocker`/`HumanOnly`) | PASS |
| SC5 ESLint + tsc --checkJs clean | `./scripts/verify-local.sh static-analysis` (all 4 stages PASS) | PASS |

## Next action
CP-4: run the verification gate, capture proof, and produce the Goal Check table.
