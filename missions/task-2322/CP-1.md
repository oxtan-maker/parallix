# CP-1 — authority inventory and contradiction map

The previous implementation-first contract was stopped because ADR 0052's
task-record proposal conflicted with its assumed `Repository -> Mission ->
Attempt` aggregate. The rewritten mission turns that contradiction into the
work. This checkpoint establishes the checked-in baseline without introducing
new persistence authority or an `Attempt` aggregate.

## Current authority inventory

| Fact | Current authority and storage | Evidence |
|---|---|---|
| Mission lifecycle, identity, assignment, labels, closure, checkpoints, review, and NEL | Target repository; `MISSION_FIELD_AUTHORITY` exhaustively assigns every `Mission` field there. The live adapter materializes missions from Backlog Markdown and mission artifacts. | `src/application/mission-authority.ts:16-27`; `src/adapters/backlog/concrete-mission-read-adapter.ts:108-115` |
| Review conversation | Target-repository, Git-owned `review-state.json` artifact, materialized to `Review`; Forgejo is not an authority. | `src/application/mission-authority.ts:78-81`; `src/adapters/backlog/concrete-review-read-adapter.ts:50-77` |
| NEL | Target-repository Mission attribute; its measurement is computed from Git diff data during workflow handling. | `src/application/mission-authority.ts:16-27`; `src/platform/runtime/lib/core/nels.ts:180-188` |
| Resumable session metadata | Target-worktree, gitignored `.workflow/sessions`; it is neither committed Git state nor SQLite state. | `src/domain/session.ts:1-27`; `src/platform/runtime/lib/tools/sessions.ts:5-18` |
| Usage measurements | Operator-local `PARALLIX_HOME/stats.csv` compatibility source; the current SQLite port describes the same data as an asynchronous adapter concern. | `src/adapters/sqlite/ports.ts:73-112`; `src/platform/runtime/lib/commands/stats.ts:101-114` |
| Agent blocks | Operator-local `PARALLIX_HOME/agents.local.json` source, with SQLite permitted as a cache/adapter. | `src/adapters/sqlite/ports.ts:26-38`; `src/application/mission-authority.ts:30-36` |
| Known repositories and board projection | Operator-local cache, never mission mutation authority. | `src/application/mission-authority.ts:30-36`; `src/adapters/sqlite/migrations/0001-initial-schema.sql:55-70` |
| Board/event telemetry | Operator-local SQLite `board_lane_events`, best-effort and explicitly non-authoritative for lifecycle. | `src/adapters/sqlite/migrations/0003-board-lane-events.sql:6-8`; `src/application/recording/board-event-recorder.ts:18-55` |
| Tool configuration and lifecycle aliases | Tool-owned assets; repository workflow configuration remains a target-repository input. | `src/application/mission-authority.ts:30-36`; `src/application/mission-authority.ts:76-85` |

## Contradictions requiring CP-2 decisions

1. ADR 0044 says post-cutover SQLite is sole authority for mission, review,
   NEL, session, and operator concerns, and fixes its database at
   `<PARALLIX_HOME>/parallix.db` (`docs/adr/0044-workflow-distribution-model.md:118-125`,
   `:185-192`). The code currently confines that database to operator-state
   tables and path resolution (`src/adapters/sqlite/migrations/0001-initial-schema.sql:1-5`,
   `src/adapters/sqlite/database-path-resolver.ts:5-16`).
2. ADR 0052 selects a canonical SQLite "mission/task record" after intake
   (`docs/adr/0052-task-catalog-authority-and-board-authorship.md:264-270`) yet
   requires one database per repository (`:314-318`). This conflicts with ADR
   0044's explicit `PARALLIX_HOME` location and with the existing SQLite
   adapter factory (`src/adapters/sqlite/adapter-factory.ts:43-76`).
3. The checked-in domain makes `Mission` the aggregate and models agent work as
   `AgentRunMeasurement`, not as a first-class `Attempt`
   (`src/domain/mission.ts:34-65`; `src/domain/usage.ts:81-111`). No current
   port or adapter persists an Attempt aggregate.
4. Current compatibility authority is explicitly Backlog/Git rather than the
   SQLite database (`src/domain/README.md:103-129`), while ADR 0044 and ADR
   0052 each describe a different future SQLite cutover. CP-2 must choose one
   future scope before CP-3 edits the ADR set.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC1 — code-grounded authority inventory covers required facts | `src/application/mission-authority.ts:16-36`; `src/adapters/backlog/concrete-review-read-adapter.ts:50-77`; `src/adapters/sqlite/migrations/0003-board-lane-events.sql:6-27`; "authority is exhaustive over mission fields and covers the legacy path inventory" | COMPLETE |
| SC2 — accepted ADR text becomes internally consistent | ADR 0044, `docs/adr/0044-workflow-distribution-model.md:118-125`; ADR 0052, `docs/adr/0052-task-catalog-authority-and-board-authorship.md:264-270` | IN PROGRESS — contradiction identified for CP-2/CP-3. |
| SC3 — explicit decision about ADR 0052 | `docs/adr/0052-task-catalog-authority-and-board-authorship.md:262-279`; `missions/task-2322/MISSION.md:31-33` | PENDING — CP-2 will select narrow, supersede, or retire. |
| SC4 — repository design notes align | `src/domain/README.md:103-171`; `src/domain/session.ts:1-27` | IN PROGRESS — current model documented; future scope must be decided first. |
| SC5 — next persistence-slice recommendation | `src/application/domain-ports.ts:9-13`; `src/domain/usage.ts:81-111` | PENDING — CP-2 determines aggregate and SQLite scope. |
| SC6 — automated/type-level authority proof | `test/domain-authority.test.ts`; "authority is exhaustive over mission fields and covers the legacy path inventory" | COMPLETE |
| SC7 — no premature production persistence authority | `src/adapters/sqlite/database-path-resolver.ts:5-16`; `src/adapters/sqlite/migrations/0001-initial-schema.sql:1-5`; `./scripts/verify-local.sh docs` | COMPLETE — this checkpoint adds documentation only. |

Next action: compare the three viable future models in CP-2 — retain the
operator-local SQLite scope, introduce a repository-local MissionStore, or
retire/narrow ADR 0052 — and make one explicit, code-grounded decision about
the aggregate and `Attempt`.
