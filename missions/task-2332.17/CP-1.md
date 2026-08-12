# CP 1 — Cross-adapter dependency audit

Audited every named package rule in `adapterPackageDependencies`. Each entry
now records whether its sibling imports provide a host mechanism or represent
behaviour that must be supplied through an application-owned port. The audit
identifies the behaviour edges for the next checkpoint without changing a
production dependency yet.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Every table entry is classified | `src/adapters/architecture/boundary-guards.ts`, inline mechanism/behaviour annotations on `adapterPackageDependencies` | PASS |
| Behaviour edges have a port migration target | `src/application/ports/cli-workflows.ts`, `src/application/ports/rebase-workflow.ts`, `src/application/ports/review-workflow.ts`, and `src/application/ports/handoff-workflow.ts` | PASS |
| Dependency baseline remains enforceable | `npm test -- test/dependency-graph.test.ts`, `"cross-adapter guard rejects a prohibited direct import between unnamed adapter packages"` | PENDING CP 2 import rewiring |

Next action: bind the audited CLI, rebase, review, mission, backlog, and SQLite behaviour edges to their existing application ports through `src/composition/`.
