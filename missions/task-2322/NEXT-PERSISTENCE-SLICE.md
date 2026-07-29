# Next persistence slice — operator-local MissionStore

## Objective

Implement an SQLite `MissionStore` for the checked `Mission` aggregate in
`<PARALLIX_HOME>/parallix.db`, following ADR 0053. Do not introduce domain
entities through schema design.

## In scope

1. Extend the existing operator-local database with persistence for the current
   `Mission` fields: `id`, `repositoryId`, `title`, `labels`, `status`,
   `rawStatus`, `closedAt`, `assignee`, `checkpoints`, `review`, and
   `netEngineeringLines`.
2. Persist the checked nested domain types `CheckpointData` and `Review`
   without creating file-oriented domain wrappers.
3. Add optimistic concurrency metadata at the application repository boundary.
   It is persistence metadata, not a new `Mission` lifecycle field.
4. Keep `MissionStore` in the application layer and SQL in the SQLite adapter.
   Domain policy remains storage-agnostic and synchronous.
5. Define an explicit, one-way compatibility import from
   `materializeBacklogMission()`. Validate all records before the transaction,
   record an idempotency key, preserve newer canonical rows, and report
   ambiguity.
6. Record a `LaneTransitionEvent` in the same transaction as the Mission
   transition it describes.
7. Add migration, backup, restore, concurrency, checksum, import, and no-dual-
   write tests before cutover.
8. Characterize `px draft`, `px active`, `px review`, and `px integrate` before
   switching each command to the new adapter.

## Explicitly deferred

- `Attempt`, attempt-scoped usage, process records, and worktree entities. No
  checked domain type currently defines them.
- Changes to the checked shapes of `Mission`, `CheckpointData`, `Review`,
  `AgentRunMeasurement`, `MissionOutcome`, or `SessionMarker`.
- A task catalog, reverse Markdown synchronization, task-file repair, and
  bidirectional writes.
- Copying Git commits, branches, ancestry, worktree presence, configuration,
  secrets, logs, patches, or large artifacts into SQLite.
- TUI interaction changes, review-provider redesign, and unrelated command
  behavior changes.

## Required evidence

- Domain round-trip tests cover every current `Mission` field and nested
  `CheckpointData` and `Review` content.
- Version-conflict tests prove stale writes change nothing.
- Closure tests prove Git integration and worktree-removal prerequisites are
  observed before committing `closedAt`.
- Import tests prove atomicity, idempotency, ambiguity reporting, and no
  overwrite of newer Mission state.
- Transaction tests prove Mission state and `LaneTransitionEvent` commit or
  roll back together.
- `./scripts/verify-local.sh static-analysis` and
  `./scripts/verify-local.sh all` pass before cutover.

## Start condition

Begin only from ADR 0053 and the checked domain types it names. Stop if the
implementation requires inventing a domain entity, retaining a second Mission
writer, or treating a database record as proof of an external Git, filesystem,
OS, or provider fact.
