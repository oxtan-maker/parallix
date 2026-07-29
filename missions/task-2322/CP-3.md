# CP-3 — reconciled accepted architecture

CP-3 reconciles the architecture documents without changing production
persistence behavior. ADR 0044 now distinguishes the future repository-local
MissionStore from the existing operator-local SQLite database. ADR 0052 is
formally superseded for mission authority, while its draft-intake observations
remain historical evidence. ADR 0051, the ADR index, and the domain note now
use the same boundary. `Attempt` is explicitly deferred.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC1 — code-grounded authority inventory | `missions/task-2322/CP-1.md`; `src/application/mission-authority.ts:16-36` | COMPLETE |
| SC2 — accepted ADRs agree on database scope and mission authority | ADR 0044, `docs/adr/0044-workflow-distribution-model.md:116-146`; ADR 0051, `docs/adr/0051-ui-neutral-application-boundary.md:38-50`; ADR 0052, `docs/adr/0052-task-catalog-authority-and-board-authorship.md:31-48` | COMPLETE |
| SC3 — explicit ADR 0052 decision is in edited ADR files | `docs/adr/0052-task-catalog-authority-and-board-authorship.md:1-5`; `docs/adr/0044-workflow-distribution-model.md:178-181` | COMPLETE — superseded for mission authority. |
| SC4 — domain note aligns aggregate, compatibility, future authority, closure, review, and sessions | `src/domain/README.md:12-20`; `src/domain/README.md:106-131`; `src/domain/README.md:168-178`; `src/domain/README.md:262-269` | COMPLETE |
| SC5 — next persistence-slice recommendation states MissionStore and Attempt scope | `docs/adr/0044-workflow-distribution-model.md:118-137`; `src/application/domain-ports.ts:9-13` | COMPLETE — repository-local MissionStore; Attempt deferred. |
| SC6 — automated/type-level proof anchors current authority | `test/domain-authority.test.ts`; "authority is exhaustive over mission fields and covers the legacy path inventory" | COMPLETE |
| SC7 — no premature production persistence authority | `git diff --check`; `./scripts/verify-local.sh docs`; `src/adapters/sqlite/database-path-resolver.ts:5-16` | COMPLETE — documentation-only change preserves existing adapter behavior. |

Next action: define the CP-4 follow-up plan for a repository-local MissionStore
adapter, including its location resolver, schema, import boundary, compatibility
cutover, recovery, and tests; keep `Attempt` out of that slice unless a separate
domain decision establishes its identity and invariants.
