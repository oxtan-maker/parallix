# CP-2: Checked Mission use cases, port, and isolated SQLite proof

## Summary

Defined the application boundary the covered operations will use, and proved it
twice: against fake ports (fast, hermetic) and against real SQLite rows in
per-test temporary databases.

**Domain additions.** `intakeMission()` materializes a new `Mission` with its
`RepositoryId`, rejecting an empty title and refusing to invent checkpoint,
review, or change-size facts (`src/domain/mission.ts:109`). `ExternalTaskRef` is
a value object for intake traceability that rejects embedded task content, so an
external catalog cannot become an aggregate (`src/domain/external-task.ts`).
`src/domain/net-engineering-lines.ts` moves the ADR 0047 bucket policy into the
domain (`src/platform/runtime/lib/core/nels.ts` now re-exports it rather than
keeping a second copy) and adds `ArtifactReference`, whose factory rejects
multi-line or oversized values — the checked form of "reference, not blob".

**Port additions** (`src/application/domain-ports.ts`): `MissionTransitionStore`
extends `MissionStore` with `saveWithTransition`, so a lifecycle change and its
`LaneTransitionEvent` commit together; `MissionNelRecorder` records the derived
NEL report and returns a locator receipt; `MissionStaleVersion` plus
`isStaleWrite()` give every adapter one stale-write vocabulary.

**Use cases.** Four services share one guard sequence — capability check, read
through the port, domain decision, write with the exact expected revision
(`src/application/mission-command-support.ts:35`):

- `MissionIntakeService` inserts with `expectedVersion: null` and reports a
  conflict when the identity already exists.
- `MissionLifecycleService` applies `decideMission` and emits a lane event only
  for a transition the state machine owns whose recorded lane actually moves.
- `MissionCheckpointService` records and reads `CheckpointData` with no path or
  schema input.
- `MissionHandoffService` writes `Mission.netEngineeringLines` through the port,
  then derives the structured report and hands it to the recorder; a failed
  report reports the durable evidence that exists instead of claiming a rollback.

**SQLite adapter.** Migration `0005-mission-external-task-ref` adds an
aggregate-owned `mission_external_task_refs` table (at most one row per mission,
no status/assignee/lifecycle column), wired through `mission-serialization.ts`
and `mission-store.ts` and registered in `SQLITE_ENTITY_AUTHORITY`.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC1 — intake creates a checked Mission with its RepositoryId and supplied trace | `src/domain/mission.ts:109`, `"SC1: intake materializes a Mission with its RepositoryId and external trace, writing one aggregate"` | PASS |
| SC1 — no task-catalog aggregate is written by the intake flow | `"SC1/SC6: intake writes one Mission aggregate and its external trace, and no task catalog"`, `src/adapters/sqlite/migrations/0005-mission-external-task-ref.sql:10` | PASS |
| SC1 — an external reference cannot carry task content | `src/domain/external-task.ts:39`, `"SC1: an external task reference rejects embedded task content"` | PASS |
| SC2 — transitions invoke the Mission repository port and reject invalid decisions | `src/application/mission-lifecycle-service.ts:87`, `"SC2: an invalid domain transition is refused and nothing is written"` | PASS |
| SC2 — stale expected versions are rejected (fake port and real rows) | `"SC2: a stale expected version is refused before the domain decides"`, `"SC2: a second writer holding the old revision is refused and changes nothing"` | PASS |
| SC2 — a lifecycle change and its lane event commit together | `src/adapters/sqlite/mission-store.ts:146`, `"SC2: activation commits the lifecycle change and its lane event in one transaction"` | PASS |
| SC3 — CheckpointData round-trips including GoalCheckRow semantics | `"SC3: checkpoint data round-trips through the boundary with GoalCheckRow semantics"`, `"SC3: checkpoint data and Goal Check rows round-trip through real rows"` | PASS |
| SC3 — the checkpoint use case takes no file path or SQL schema input | `src/application/mission-checkpoint-service.ts:32`, `"SC3: the checkpoint request carries no persistence path or SQL input"` | PASS |
| SC4 — NEL is recorded through the checked boundary and the report is derived | `src/application/mission-handoff-service.ts:67`, `"SC4: handoff records NEL through the boundary and reports the derived record"` | PASS |
| SC4 — large artifacts stay references, never SQLite blob payloads | `src/domain/net-engineering-lines.ts:60`, `"SC4: a large generated artifact is carried as a locator, never as content"`, `"SC4: handoff stores the NEL number and keeps large artifacts as references, not blobs"` | PASS |
| SC6 — SQLite coverage uses isolated fixtures (one temp database per test) | `test/task-2322-05-mission-sqlite-fixture.test.ts:44` | PASS |
| SC7 — the use cases reach persistence only through ports | `"SC7: the Mission use cases reach persistence only through the application ports"` | PASS |
| Bucket policy has one owner | `src/domain/net-engineering-lines.ts:36`, `src/platform/runtime/lib/core/nels.ts:45`, ADR 0047 | PASS |
| Full gate green with the new coverage | `` `./scripts/verify-local.sh all` `` — 1549 tests, 0 fail, exit 0 | PASS |

Next action: Reroute the handoff NEL capture, the activation adapter, and the shared UI command controller onto these use cases behind the single compatibility authority.
