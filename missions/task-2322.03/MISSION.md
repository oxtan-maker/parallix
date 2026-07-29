# Mission: Transactional SQLite persistence for the checked Mission aggregate (task-2322.03)

## Goal
Provide an SQLite-backed persistence adapter for the checked `Mission` aggregate that round-trips its checked state, enforces checked writes, and atomically records a Mission transition with its `LaneTransitionEvent`, while leaving all production command authority and legacy reads unchanged.

## Why Now
TASK-2322.02 established the checked aggregate and separated repository observation from Mission identity. The next safe step is to make that aggregate durable behind application ports, so a later one-step production cutover has a transactionally correct storage boundary instead of a schema-led parallel model.

## Refinement Signals
- Predicted NEL bucket: Large (235+)
- Confidence: High
- Selection note: activate as-is
- Main drivers: checked aggregate serialization and hydration; schema initialization and forward migrations; optimistic concurrency; atomic state/event transactions; isolated migration, backup, restore, and concurrent-access fixtures; import-boundary coverage.

## Scope
- Add SQLite schema, initialization, and forward-migration support for the checked `Mission` aggregate and its `LaneTransitionEvent` history.
- Implement a SQLite adapter behind existing application/domain repository ports, including aggregate hydration and persistence of `repositoryId`, `status`, `rawStatus`, `assignee`, `labels`, `closedAt`, `CheckpointData`, and `Review` values.
- Enforce optimistic concurrency, or an equivalent checked version contract, so a stale write fails without changing the stored aggregate or appending history.
- Make a Mission transition and its corresponding `LaneTransitionEvent` commit or roll back as one SQLite transaction.
- Persist `RepositoryId` as the stable Mission reference and store `KnownRepository` observation fields as replaceable path/display metadata rather than identity authority.
- Add isolated, fast tests for clean initialization, upgrade from the prior schema, migration checksum mismatch, interrupted migration recovery, backup, restore, concurrent access, round trips, stale writes, and atomic transition persistence.
- Add import-boundary tests or checks proving application and UI layers use ports rather than importing the SQLite adapter or issuing SQL.

## Out of Scope
- Switching any production command, projection, or UI workflow to SQLite persistence.
- Reading, repairing, migrating, or shadow-writing legacy mission/task sources.
- Persisting `Attempt`, task-catalog data, worktree data, process data, or any entity not checked in the current Mission aggregate.
- Creating schema-led domain entities or changing the production authority model.
- Changing repository identity semantics beyond the checked `RepositoryId`/`KnownRepository` boundary.

## Success Criteria
> **Falsifiability rule (ADR 0039 Part 2):** Each criterion must be falsifiable. Forbidden: subjective adjectives ("easy, fast, simple, intuitive, user-friendly, responsive, quick, efficient" without an attached metric) and vague quantifiers ("multiple, several, some, many, few, various"). For refactor / condense / migration missions, the criterion must enumerate the specific elements (rules, files, behaviours) that must survive — generic phrases like "preserve critical content" are not sufficient.

- SQLite round-trip tests prove that a checked Mission preserves `repositoryId`, `status`, `rawStatus`, `assignee`, `labels`, `closedAt`, every `CheckpointData` value, and every `Review` value required by current commands and projections.
- A stale Mission writer is rejected by a checked version/concurrency contract, and tests prove that rejection leaves both the stored current aggregate and its event history unchanged.
- Tests prove that a Mission transition and its `LaneTransitionEvent` are committed in one transaction; an injected persistence failure leaves neither the new Mission state nor a history-only event.
- Tests prove `RepositoryId` remains the stored Mission reference while `KnownRepository` path and display metadata can be replaced without becoming Mission identity.
- Isolated fixtures prove database initialization and forward migration for a clean install, an upgrade from the supported prior schema, checksum mismatch detection, interruption recovery, backup, restore, and concurrent access.
- Import-boundary coverage proves application and UI code access persistence through repository ports and do not import the SQLite adapter or issue SQL.
- No production command cutover, legacy read/repair, shadow write, or table for `Attempt`, task catalog, worktree, process, or another unchecked entity is introduced.

## Risks and Assumptions
- Risk: nested `CheckpointData` and `Review` fields may evolve independently of the storage mapping. Mitigation: derive serialization/hydration directly from the checked aggregate and enumerate fields in round-trip tests.
- Risk: a transaction helper can accidentally commit state and history on different connections. Mitigation: test injected failures and concurrent writers using isolated database fixtures.
- Risk: migration recovery and backup/restore behavior can vary with SQLite file handling. Assumption: the adapter can use repository-supported SQLite facilities and temporary filesystem fixtures without contacting Forgejo or external services.
- Risk: adapter imports can leak upward into application or UI code. Mitigation: add explicit import-boundary coverage around ports and SQLite adapter paths.
- Assumption: TASK-2322.02's checked aggregate, ports, and ADR 0051/0053 boundaries are the authoritative contract for this mission.

## Checkpoints
- CP 1: Map the checked aggregate and existing repository ports to an adapter-level persistence contract; record every field and nested value required for round-trip coverage, the version/concurrency contract, and the `RepositoryId` versus `KnownRepository` mapping.
- CP 2: Add schema initialization, version tracking, forward migrations, and isolated fixtures for clean install, prior-schema upgrade, checksum mismatch, interrupted migration, backup, restore, and concurrent access.
- CP 3: Implement SQLite aggregate reads/writes and transactional transition/event persistence; add red/green tests for complete round trips, stale writers, and injected transaction failures.
- CP 4: Add import-boundary coverage, verify that no production cutover or unchecked-entity schema was introduced, run the required gate, and document final Goal Check evidence.

### Checkpoint Documentation Requirements
Every checkpoint document (`CP-N.md`) MUST include a summary of work done and then use the exact heading `## Goal Check`. Under that heading, include the exact three-column pipe table header `| Criterion | Evidence | Status |` and at least one row for every Success Criterion.

Evidence must use forms Parallix already verifies today: existing file:line references, exact test names, ADR references, existing test file paths, or recognized repository commands/paths such as backticked `npm ...`, `node ...`, `git ...`, `px ...`, or `./...`. Cite the changed adapter/schema lines, named SQLite fixture tests, `ADR 0051` or `ADR 0053` where relevant, and the command that ran the gate. Raw `stat`/`ls` output or generic prose alone is not enough: it may be supplemental context only and must be paired with one of those accepted references. End each checkpoint document with a concrete `Next action:` line.

## Gates
- [ ] ./scripts/verify-local.sh all

## Restricted Areas
- Do not modify production command routing, production authority selection, or legacy-source read paths.
- Do not add persistence tables or mappings for `Attempt`, task catalog, worktree, process, or another unchecked entity.
- Do not import SQLite adapter modules or SQL APIs from application or UI layers; retain the repository-port boundary.
- Do not alter the checked domain aggregate's semantics merely to accommodate schema layout; document and resolve such a mismatch through the existing ADR boundary before proceeding.

## Stop Rules
- Stop and request direction if the checked aggregate or existing ports cannot represent a required persisted field without changing domain authority or public command behavior.
- Stop and request direction if a migration requires reading, repairing, or writing legacy production data, or if a production command must be switched to prove the adapter.
- Stop and request direction if SQLite transactional guarantees cannot cover the Mission state and `LaneTransitionEvent` on the same database transaction/connection.
- Stop and request direction if required recovery, checksum, backup/restore, or concurrency scenarios cannot be tested with isolated fast fixtures.
- Stop and request direction if satisfying import boundaries requires a cross-layer redesign beyond the existing port contract.
