# Mission: Certify ADR 0053 cutover and eliminate stray legacy persistence (task-2322.12)

## Goal

Close the ADR 0053 migration wave by certifying that `<PARALLIX_HOME>/parallix.db` is the sole write authority for every `database-owned-domain-state` concept, with no remaining file-backed fallback paths. Remove all compatibility entries tagged `TASK-2322.12` from the executable inventory (`ADR0053_PERSISTENCE_INVENTORY`), delete the expired review-file-persistence modules, tighten the inventory to its final allowlist, and prove end-to-end recovery and presentation behavior without any file fallback.

## Why Now

ADR 0053 has been accepted and the SQLite cutover for `Mission`, `AgentRunMeasurement`, `SessionMarker`, and `AgentBlock` is complete (TASK-2322.07 through TASK-2322.09). The remaining compatibility paths — `review-state.ts`, `review-artifacts.ts`, `review-events.ts`, `review-commands.ts`, and the `stats.ts` review-state reader — are stray legacy persistence that still write/read mission-local JSON and Markdown files for review round tracking, event storage, and implementer inference. These file-backed paths compete with the SQLite `Review` aggregate and violate the ADR 0053 rule that the operator database is the sole live authority after cutover. This task is the readiness gate for further UI work; deferring it would leave dual-authority ambiguity in the review loop and the statistics projection.

## Refinement Signals
- Predicted NEL bucket: Medium (81–235)
- Confidence: High
- Selection note: activate as-is
- Main drivers: Delete 6 inventory compatibility entries, remove review-state/review-artifacts/review-events/review-commands file-persistence code, update stats.ts to read Review from SQLite, add architecture test enforcing no stray file persistence, end-to-end recovery suite, and documentation updates.

## Scope

- Remove the 6 `TASK-2322.12` compatibility entries from `ADR0053_PERSISTENCE_INVENTORY` in `src/platform/runtime/lib/core/durable-state-inventory.ts`:
  - `review-read-review-state`, `review-write-review-state` (review-state.ts)
  - `review-read-review-artifacts` (review-artifacts.ts)
  - `review-write-review-events` (review-events.ts)
  - `review-read-stats` (commands/stats.ts)
  - `review-read-review-commands` (review-commands.ts)
- Delete expired compatibility code paths: file-backed `review-state.json` persistence in `review-state.ts`, `/tmp` legacy artifact fallback branches in `review-artifacts.ts`, legacy `/tmp` import functions in `review-events.ts`, and review-state-dependent implementer inference in `review-commands.ts`.
- Update `stats.ts` to read review data from SQLite `Review` rows (via `SqliteMissionStore`) instead of `readReviewState` and `readAllEvents`.
- Verify `interfaces/cli/` and `interfaces/tui/` have no direct imports of `sqlite`, `database-adapter`, `adapter-factory`, or raw SQL.
- Verify persistence adapters under `src/adapters/sqlite/` do not import the production composition root.
- Confirm no production path defaults to `stats.csv`, `agents.local.json` block state, `.workflow/sessions`, `review-state.json`, NEL JSON, checkpoint structured files, or task lifecycle fields as a fallback.
- Add architecture test (under `test/`) that fails if any new `database-owned-domain-state` file read or write enters production without an inventory entry.
- End-to-end recovery testing: cold install, upgrade from supported prior schema, full legacy import, restart, concurrent stale mutation, interrupted migration, backup/restore, corrupt database, and unavailable database.
- Update ADR 0053 and domain documentation to name the operator database authority and remaining external boundaries.
- Confirm no deferred migration TODO, undeclared domain record, shadow write, bidirectional synchronization, or UI-only persistence remains.

## Out of Scope

- Introducing new domain entities (e.g., `Attempt`, `RepositoryAlias`) — those require a checked-domain decision per ADR 0053.
- Modifying the SQLite schema or migration order (schema changes belong to their own tasks).
- Modifying the composition root structure or port interfaces.
- Adding multi-user or remote coordination support.
- Modifying `MACHINE_WRITTEN_PATH_INVENTORY` (TASK-2222 migration plan) beyond cross-referencing.
- Adding new UI components or features; this task only verifies UI consistency.

## Success Criteria

- **SC1:** `ADR0053_PERSISTENCE_INVENTORY` contains zero entries with `cutoverTask: 'TASK-2322.12'`; all 6 compatibility entries are removed and the 6 corresponding file-persistence code paths are deleted.
- **SC2:** No production path under `src/platform/runtime/lib/review/review-state.ts`, `review-artifacts.ts`, `review-events.ts`, or `review-commands.ts` performs durable file reads or writes for review round state, event storage, or implementer inference; these responsibilities are served by `SqliteMissionStore` (Review aggregate) and/or the `Review` domain model.
- **SC3:** `stats.ts` reads review data (implementer, pr-fix-rounds, review state) from SQLite via `SqliteMissionStore` or the measurement store port; it does not import `readReviewState` or `readAllEvents` from the legacy review modules for default-path reads.
- **SC4:** No file under `interfaces/cli/` or `interfaces/tui/` imports `sqlite`, `database-adapter`, `adapter-factory`, `initOperatorState`, or raw SQL strings.
- **SC5:** No file under `src/adapters/sqlite/` imports the production composition root (`createProductionApplicationServices` or its equivalent).
- **SC6:** An architecture test under `test/` (e.g., `task-2322.12-stray-persistence.test.ts`) fails if any new `database-owned-domain-state` file read or write appears in production code without a matching `ADR0053_PERSISTENCE_INVENTORY` entry.
- **SC7:** The end-to-end recovery suite passes for all 9 scenarios: cold install, upgrade from supported prior schema, full legacy import, restart, concurrent stale mutation, interrupted migration, backup/restore, corrupt database, and unavailable database — none exercise a file fallback.
- **SC8:** CLI, TUI, and shared web-board projections produce consistent current state, history, statistics, sessions, blocks, repository metadata, and preferences using the same application contracts (application ports, not direct SQL).
- **SC9:** `docs/adr/0053-operational-persistence-and-authority-boundaries.md` and `src/domain/README.md` name the operator database authority and remaining external boundaries without restating or competing with ADR decisions.
- **SC10:** No deferred migration TODO, undeclared domain record, shadow write, bidirectional synchronization, or UI-only persistence exists in the tree when the task is completed (verified by `g -rn "TODO.*migration\|TODO.*cutover\|FIXME.*persistence\|shadow.*write\|bidirectional.*sync\|UI.*persistence"` across `src/`).

## Risks and Assumptions

- **Risk:** The review loop (`review-loop.ts`, `review-commands.ts`) has deep coupling to `review-state.ts` and `review-artifacts.ts`; removing the file-backed paths may require refactoring the review loop to use `SqliteMissionStore` for round/disposition tracking. Mitigation: verify the SQLite `Review` aggregate already models `ReviewRound`, findings, resolutions, and dispositions per ADR 0053.
- **Risk:** `stats.ts` is 2200+ lines with `@ts-nocheck`; the review-state reader removal may surface implicit-any errors. Mitigation: scope the change to the review-state import and its callers; do not remove `@ts-nocheck` in this task.
- **Risk:** The end-to-end recovery suite (9 scenarios) may require fixture infrastructure that is not yet fully automated. Mitigation: use existing test fixtures (e.g., `test/task-2322.11-operator-state.test.ts`) as the base and add the missing scenarios.
- **Assumption:** TASK-2322.02, TASK-2322.03, TASK-2322.07, TASK-2322.08, and TASK-2322.09 cutovers are already complete, so their `cutoverTask` entries in the inventory are already resolved or removed.
- **Assumption:** The SQLite `Review` aggregate (via `SqliteMissionStore`) already supports the review round/disposition/event data currently stored in file-backed `review-state.json` and `review-events/*.md`.
- **Assumption:** The composition root (`createProductionApplicationServices`) already wires `SqliteMissionStore` as the sole production authority for Mission/Review/CheckpointData.

## Checkpoints

- CP 1: Inventory audit and compatibility entry removal. Scan `ADR0053_PERSISTENCE_INVENTORY` for all `cutoverTask: 'TASK-2322.12'` entries, verify their code paths, and remove the 6 entries. Confirm no other `TASK-2322.*` cutover tasks remain unresolved.
- CP 2: Delete expired compatibility code paths. Remove file-backed persistence from `review-state.ts` (`writeReviewState`, `readReviewState`, `reviewStateFile`, `persistReviewStateOrThrow`), legacy artifact fallback from `review-artifacts.ts` (`resolveArtifactRead` /tmp fallback, `legacyArtifactPath`), legacy import from `review-events.ts` (`importLegacyArtifact`, `importAllLegacyArtifacts`), and review-state-dependent implementer inference from `review-commands.ts`. Update all callers.
- CP 3: Update `stats.ts` review data path. Replace `readReviewState` and `readAllEvents` imports with SQLite-backed reads via `SqliteMissionStore`. Verify `stats.ts` default path no longer reads `review-state.json` or `review-events/*.md`.
- CP 4: Boundary enforcement tests. Add `test/task-2322.12-stray-persistence.test.ts` with: (a) no `interfaces/` file imports SQLite or SQL, (b) no `src/adapters/sqlite/` file imports the composition root, (c) no new `database-owned-domain-state` file access without inventory entry, (d) no stray TODO migration markers in `src/`.
- CP 5: End-to-end recovery suite. Add or update tests for all 9 recovery scenarios (cold install, upgrade, legacy import, restart, concurrent mutation, interrupted migration, backup/restore, corrupt database, unavailable database). Confirm none exercise file fallback.
- CP 6: Documentation and final certification. Update ADR 0053 cutover section and domain README. Verify SC1–SC10 with captured evidence. Run `./scripts/verify-local.sh all`.

### Checkpoint Documentation Requirements

Every checkpoint document (CP-N.md) MUST include:
- A summary of work done
- A `## Goal Check` section
- A 3-column pipe-delimited markdown table with columns: Criterion | Evidence | Status
- At least one evidence row per criterion using verifiable references. Parallix already accepts:
  1. **File:line references** — e.g., `lib/commands/handoff.ts:292` (must point to an existing file and line)
  2. **Test names** — e.g., `"real custom-agent launcher smoke: full lifecycle with hello-world task (SC3/SC4/SC5/SC6/SC7)"` (must match a test name in the repo)
  3. **Test file paths** — e.g., `test/e2e-real-agent-smoke.test.ts` (must be an existing test file)
  4. **ADR references** — e.g., `ADR 0053` (must correspond to an existing file under `docs/adr/`)
  5. **Recognized repo commands or paths** — e.g., `` `npm test -- test/repair-handoff.test.ts` ``, `` `px review <slug> --verify` ``, or `` `./scripts/verify-local.sh all` ``
- Raw `stat`/`ls` output or generic prose may appear as supplemental context, but pair them with one of the accepted references above
- A non-generic `Next action:` line at the bottom

Example Goal Check table:

| Criterion | Evidence | Status |
|---|---|---|
| Inventory has no TASK-2322.12 entries | `src/platform/runtime/lib/core/durable-state-inventory.ts:155`, `g -n "TASK-2322.12" durable-state-inventory.ts` returns 0 | PASS |
| review-state.ts file-persistence deleted | `test/task-2322.12-stray-persistence.test.ts`, `"SC2: review-state.ts has no file-backed writeReviewState"` | PASS |
| stats.ts reads Review from SQLite | `src/platform/runtime/lib/commands/stats.ts:84` (import removed), `test/task-2322.12-stray-persistence.test.ts` | PASS |

## Gates

- [x] `./scripts/verify-local.sh all`
- [x] `./scripts/verify-local.sh static-analysis`

## Restricted Areas

- `src/domain/` — the `Review` aggregate may be extended to model review-loop
  workflow state (phase, per-round retry counters, stage-launch de-duplication).
  This is an explicit scope widening: the task description requires that this
  mission is "not a place to defer missing domain models", and the earlier
  blanket restriction contradicted that. No other domain entity may be added or
  modified.
- `src/application/domain-ports.ts` — do not add new ports; use existing `MissionRepositoryPort` and `MeasurementStorePort`.
- `src/adapters/sqlite/migrations/` — one additive migration is permitted, and only
  to carry the `Review` workflow state above. No destructive change to an applied
  migration.
- `src/adapters/sqlite/adapter-factory.ts` — do not modify the composition root singleton or its initialization contract.
- `config/integration-pipelines.json` — do not modify gate configuration.
- `MACHINE_WRITTEN_PATH_INVENTORY` in `durable-state-inventory.ts` — do not modify the TASK-2222 migration plan entries.
- `test/domain-attempt-guard.test.ts` — do not modify the existing Attempt guard test.

## Stop Rules

- Stop if modelling review workflow state on the `Review` aggregate requires a
  second aggregate, a new port, or a destructive schema change. Extending `Review`
  and adding one additive migration is in scope (see Restricted Areas); anything
  beyond that is a separate task.
- Stop if the end-to-end recovery suite requires more than 2 new test fixtures beyond existing `test/task-2322.11-operator-state.test.ts` infrastructure.
- Stop if `stats.ts` changes surface more than 20 new type errors beyond the review-state import removal (indicates `@ts-nocheck` scope creep).
- Stop if any `interfaces/cli/` or `interfaces/tui/` file is found to import SQLite directly — this is a boundary violation that must be fixed in a separate task if the coupling is structural.
