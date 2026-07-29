# CP-2 — target architecture decision

CP-2 selects a split persistence boundary that follows the checked-in authority
model rather than forcing all durable facts into the existing operator-local
database.

## Decision

1. `Mission` remains the primary aggregate for the next persistence slice. Its
   current fields and state machine already own lifecycle, closure, review,
   checkpoints, assignment, and NEL. A future `MissionStore` therefore belongs
   to the target repository and must preserve the `MissionStore` application
   port boundary.
2. Mission SQLite, when implemented in a follow-up, is **repository-local**:
   one database for the selected target repository, outside mission worktrees.
   This follows target-repository mutation authority and permits a shared
   checkout-independent canonical lifecycle record.
3. The existing `<PARALLIX_HOME>/parallix.db` remains **operator-local**. It
   owns agent blocks, usage/telemetry, UI preferences, known-repository cache,
   migration metadata, and board-event telemetry. It is not a mission store.
4. `Attempt` is **deferred**. Existing `AgentRunMeasurement` provides usage
   projection data, while current sessions are resumability markers. Neither
   has the durable identity, transition rules, or cross-command ownership
   needed to introduce a first-class Attempt entity safely.
5. ADR 0052 is **superseded for mission authority**. It may remain historical
   context for plural draft intake and task-material import, but its canonical
   task/mission-record and one-repository-database claims are replaced by the
   explicit MissionStore/operator-state split.

## Rejected alternatives

| Alternative | Rejection basis |
|---|---|
| Keep all future state in `<PARALLIX_HOME>/parallix.db` | It conflicts with `MISSION_FIELD_AUTHORITY` assigning every Mission field to the target repository and would let per-operator state diverge across checkouts. `src/application/mission-authority.ts:16-27`; `src/adapters/sqlite/database-path-resolver.ts:5-16` |
| Make the existing task record the primary aggregate | The production domain already owns mission rules and a store port; a task catalog would retain the original aggregate conflation. `src/domain/mission.ts:34-65`; `src/application/domain-ports.ts:9-13` |
| Add a first-class `Attempt` now | Current code supplies usage measurements and session markers but no Attempt identity, invariant, or persistence port. `src/domain/usage.ts:81-111`; `src/domain/session.ts:1-27` |
| Preserve ADR 0052 unchanged | Its one-database-per-repository requirement conflicts with ADR 0044's operator-local database placement, while its task/mission record conflicts with the Mission aggregate. ADR 0044, `docs/adr/0044-workflow-distribution-model.md:185-192`; ADR 0052, `docs/adr/0052-task-catalog-authority-and-board-authorship.md:264-270`, `:314-318` |

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC1 — code-grounded authority inventory | `missions/task-2322/CP-1.md`; `src/application/mission-authority.ts:16-36` | COMPLETE |
| SC2 — accepted ADR consistency | ADR 0044, `docs/adr/0044-workflow-distribution-model.md:118-125`; ADR 0052, `docs/adr/0052-task-catalog-authority-and-board-authorship.md:264-270` | IN PROGRESS — CP-3 applies this decision to the accepted ADR text. |
| SC3 — explicit ADR 0052 decision | ADR 0052, `docs/adr/0052-task-catalog-authority-and-board-authorship.md:262-279`; `missions/task-2322/CP-2.md` | COMPLETE — supersede its mission-authority direction while retaining historical intake context. |
| SC4 — design notes align | `src/domain/README.md:103-171`; `src/domain/session.ts:1-27` | IN PROGRESS — CP-3 aligns ADR and domain documentation. |
| SC5 — next implementation-slice recommendation | `src/application/domain-ports.ts:9-13`; `src/domain/usage.ts:81-111` | COMPLETE — repository-local MissionStore; no Attempt entity. |
| SC6 — automated/type-level authority proof | `test/domain-authority.test.ts`; "authority is exhaustive over mission fields and covers the legacy path inventory" | COMPLETE |
| SC7 — no premature production persistence authority | `src/adapters/sqlite/adapter-factory.ts:43-76`; `./scripts/verify-local.sh docs` | COMPLETE — this checkpoint is decision documentation only. |

Next action: consult `docs/doc-standards.md`, then update ADR 0044, ADR 0052,
and `src/domain/README.md` to encode the repository-local MissionStore versus
operator-local SQLite split and the deferred Attempt decision.
