# CP 3 — Enforced mechanism design

Narrowed `adapterPackageDependencies` to host mechanisms only. Workflow
behaviour is declared separately against its application-owned port boundary,
preserving the existing composed implementations while keeping behaviour out
of the mechanism table.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Every remaining table entry is a host mechanism | `src/adapters/architecture/boundary-guards.ts`, inline mechanism comments on `adapterPackageDependencies` | PASS |
| No adapter names more than seven sibling mechanisms | `src/adapters/architecture/boundary-guards.ts`; `cli` is 5, `rebase` is 5, `review` is 6, and `agents` is 7 | PASS |
| Behaviour routes use application-port declarations | `src/application/ports/cli-workflows.ts`, `src/application/ports/execute-mission.ts`, `src/application/ports/handoff-workflow.ts`, `src/application/ports/rebase-workflow.ts`, and `src/application/ports/review-workflow.ts` | PASS |
| Production tree has no dependency violation | `npm test -- test/dependency-graph.test.ts`, `"dependency graph production scan has no violation outside the owned allowlist"` | PASS |

Next action: update the adapter architecture documentation to describe the narrowed table as enforced design and remove the retired ratchet wording.
