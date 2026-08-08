# Mission: Carry repository identity through lane events and board metrics (task-2347.01)

Reproduction-Test: test/task-2347-01-repository-identity-repro.test.ts

## Goal
Make repository identity survive the whole lane-event path — domain event, SQLite schema, port contract, both mapping directions, and the metrics read — so board statistics for one repository are computed only from that repository's rows.

Concretely: add a repository column plus repository-keyed indexes to `board_lane_events`, add `repositoryId` to `BoardLaneEventEntry`, delete the `repositoryId: '' as never` cast in `src/application/recording/board-event-recorder.ts:92`, record a repository id that is stable across mission worktrees instead of `repositoryId(rootDir)` (`src/adapters/backlog/backlog.ts:799`), scope `ConcreteMetricsReadAdapter.buildMetrics` to the repository the projection is for, and key usage outcomes by (repository, mission) the way `statsMissionKey` (`src/adapters/cli/commands/stats.ts:438`) already does. Pre-existing rows get an explicit legacy scope, never silent attribution to whoever is looking.

## Why Now
The database is one operator-global file (`src/adapters/sqlite/database-path-resolver.ts`), so every repository the operator has ever run writes into the same `board_lane_events` and `usage_statistics` tables. `ConcreteMetricsReadAdapter.buildMetrics` calls `laneEventRepo.findAll()` and `usageRepo.findAll()` with no predicate (`src/application/projections/metrics-read-adapter.ts:57-60`), so lane ages, dwell times, throughput, WIP series and the bottleneck sentence shown for repository A can be driven entirely by missions in repository B. Because `task-NNNN` slugs repeat across repositories, the usage keying by `record.mission` alone (`src/application/projections/metrics-read-adapter.ts:108`) collides outright and aggregates two different missions into one outcome.

Tasks 2347.03 / 2347.04 / 2347.06 change metric formulas on top of this data. Tuning formulas over cross-repository-contaminated input produces numbers that cannot be validated, so the identity carrier has to land first.

## Refinement Signals
- Predicted NEL bucket: Medium (81–235)
- Confidence: High
- Selection note: activate as-is
- Main drivers: one forward-only migration with a table rewrite and legacy backfill; one port field threaded through the SQLite repository, both recorder mappings and the metrics adapter; a stable-id derivation reusing existing `remote.origin.url` logic; four to six new tests including the cross-repository reproduction.

## Scope
- `src/adapters/sqlite/migrations/`: new forward-only migration adding `repository_id` to `board_lane_events`, replacing the idempotency UNIQUE index with one keyed by `(repository_id, idempotency_key)` and the mission lookup index with one keyed by `(repository_id, mission_id)`, and backfilling existing rows with an explicit legacy sentinel following the `'legacy-unscoped'` precedent in `src/adapters/sqlite/migrations/0005-repository-scoped-session-markers.sql`.
- `src/application/ports/operation-history.ts`: add `repositoryId` to `BoardLaneEventEntry` and a repository-scoped read method to `BoardLaneEventRepository`.
- `src/adapters/sqlite/board-lane-event-repository.ts`: write and read the new column, implement the repository-scoped read, keep idempotency behaviour (returns `false` on duplicate).
- `src/application/recording/board-event-recorder.ts`: carry `repositoryId` in `eventToEntry`, restore it in `entryToEvent`, delete the `'' as never` cast and the stale "not stored in lane_events" comment.
- Stable repository id at the transition call site (`src/adapters/backlog/backlog.ts:799`): derive from the repository rather than the worktree path, reusing the `remote.origin.url` → repo-name derivation already in `ConcreteGitReadAdapter.loadRepositoryId` (`src/adapters/backlog/concrete-git-read-adapter.ts:55-81`), with the git-common-dir toplevel basename as fallback when no remote exists.
- `src/application/projections/metrics-read-adapter.ts`: take a `repositoryId` in `ConcreteMetricsReadAdapterOptions`, read lane events scoped to it, filter usage records to it, and key `usageRecordsToOutcomes` by `(repo, mission)`.
- `src/composition/board-projection.ts:59`: pass the already-available `deps.repositoryId` into `ConcreteMetricsReadAdapter`.
- `src/adapters/sqlite/authority-map.ts`: update the `board_lane_events` entry if it enumerates columns or indexes.
- Tests under `test/`, including the reproduction test named above.
- Docs: update the persistence inventory entry for `board_lane_events` (`docs/adr/0053-persistence-inventory.md`) if it lists the table's columns or indexes.

## Out of Scope
- Changing any metric formula in `src/application/projections/metrics.ts` (owned by task-2347.03, task-2347.04, task-2347.06).
- Splitting `parallix.db` into per-repository database files.
- Altering the `usage_statistics` schema — this mission only filters and keys its rows, it does not migrate that table.
- Backfilling real repository identity into legacy rows from external sources; legacy rows get the sentinel and are excluded, not reconstructed.
- Changing `statsMissionKey` or any `px stats` CLI output.
- TUI layout or rendering changes.

## Success Criteria
> **Falsifiability rule (ADR 0039 Part 2):** Each criterion must be falsifiable. Forbidden: subjective adjectives ("easy, fast, simple, intuitive, user-friendly, responsive, quick, efficient" without an attached metric) and vague quantifiers ("multiple, several, some, many, few, various"). For refactor / condense / migration missions, the criterion must enumerate the specific elements (rules, files, behaviours) that must survive — generic phrases like "preserve critical content" are not sufficient.

1. `test/task-2347-01-repository-identity-repro.test.ts` exists, fails at the mission parent commit `ed52d6abf`, and passes on the final tree. Its first case appends lane events for repository `alpha` and repository `beta` into one repository instance, builds metrics for `alpha`, and asserts no transition originating from `beta` appears in the resulting `BoardMetrics`.
2. `BoardLaneEventEntry` in `src/application/ports/operation-history.ts` declares a required `repositoryId` field, and `BoardLaneEventRepository` declares a repository-scoped read method that `SqliteBoardLaneEventRepository` implements.
3. The `board_lane_events` table has a `NOT NULL` `repository_id` column with a non-empty CHECK constraint; its idempotency UNIQUE index covers `(repository_id, idempotency_key)` and its mission lookup index covers `(repository_id, mission_id)`. Two rows with the same `idempotency_key` under different `repository_id` values both persist, asserted by a test.
4. `grep -n "as never" src/application/recording/board-event-recorder.ts` returns no match, and a round-trip test asserts `entryToEvent(eventToEntry(event))` deep-equals the original `LaneTransitionEvent` including `repositoryId`, for a fixture with `from` non-null and a second fixture with `from === null`.
5. `ConcreteMetricsReadAdapter` requires a `repositoryId` option; `buildMetrics` no longer calls `laneEventRepo.findAll()` unscoped, and usage outcomes are keyed by repository plus mission. A test seeds `usage_statistics`-shaped records with identical `mission` under `repo: 'alpha'` and `repo: 'beta'` and asserts metrics for `alpha` report exactly one outcome carrying `alpha`'s `duration_minutes`, not the sum of both.
6. A test asserts the repository id recorded for a transition executed from a mission worktree path (for example `/home/magnus/code/parallix-task-2347.01`) equals the id recorded from the primary checkout path for the same repository — the worktree directory basename does not leak into the stored value.
7. Rows written before the migration carry the explicit legacy sentinel, and a test asserts metrics built for a named repository exclude sentinel-scoped rows rather than counting them.
8. `src/composition/board-projection.ts` passes `deps.repositoryId` to `ConcreteMetricsReadAdapter`, so the production board path is scoped without a caller opt-in.
9. `./scripts/verify-local.sh all` exits 0 on the final tree, with no new `.only` and no bare `.skip` introduced in `test/`.

## Risks and Assumptions
- **Table rewrite risk.** Adding a non-empty-CHECK `NOT NULL` column plus new indexes to `board_lane_events` likely needs the rename-copy-drop pattern of migration 0005 rather than a plain `ALTER TABLE`. Assumption: the TASK-2295 migration runner's pre-migration backup covers this forward-only migration, as stated in the header of `src/adapters/sqlite/migrations/0003-board-lane-events.sql`.
- **Migration number collision.** Two `0005-*` and two `0006-*` files already exist in `src/adapters/sqlite/migrations/`. Assumption: `loadDefaultMigrations()` tolerates duplicate numeric prefixes; verify by reading the loader before picking the new file's prefix, and pick the next free number after `0010`.
- **Stable id may differ from historical ids.** Switching from `repositoryId(rootDir)` to the remote-derived name changes the value written for the same repository going forward. Rows written by earlier builds under a worktree-path id will not match the new id and will behave like foreign rows. This is acceptable and preferable to silent misattribution, but call it out in the final checkpoint.
- **`repositoryId(rootDir)` also appears at `src/composition/production-capabilities.ts:46` and `src/composition/application-services.ts:179,309-310`.** These feed other consumers (mission rows, session markers). Changing them is not required by this mission; if the metrics scope id must agree with `deps.repositoryId`, prefer aligning the lane-event write to the existing `deps.repositoryId` derivation over rewriting the composition roots.
- **No repository remote in tests.** Test fixtures often run in bare temp directories with no `remote.origin.url`. The fallback path must be exercised deterministically; inject the git runner rather than shelling out to the real repository.
- **Cross-mission contention.** Sibling task-2347.0x missions may touch `src/application/projections/metrics-read-adapter.ts`. Assume conflicts on that file and keep the diff to the scoping concern.

## Checkpoints
- **CP 1 — Lock the bug (reproduction test first, no fix).** Author `test/task-2347-01-repository-identity-repro.test.ts`. Scenario: build an in-memory or temp-file `SqliteBoardLaneEventRepository` plus a usage repository stub; append lane transitions for mission `task-9001` under repository `alpha` and unrelated transitions for missions under repository `beta`; append usage records with the same `mission` value under `repo: 'alpha'` and `repo: 'beta'`; construct `ConcreteMetricsReadAdapter` for `alpha` and call `buildMetrics`. Assertions that must be **red at parent commit `ed52d6abf`**: (a) the returned metrics contain no transition sourced from a `beta` lane event; (b) the `alpha` outcome's cycle time equals `alpha`'s `duration_minutes` alone, not the sum across repositories; (c) `entryToEvent(eventToEntry(event)).repositoryId === event.repositoryId`. Capture the red output. Write no production fix in this checkpoint.
- **CP 2 — Storage contract.** Add the migration (new `repository_id` column with non-empty CHECK, `(repository_id, idempotency_key)` UNIQUE index, `(repository_id, mission_id)` lookup index, legacy sentinel backfill following `src/adapters/sqlite/migrations/0005-repository-scoped-session-markers.sql`). Add `repositoryId` to `BoardLaneEventEntry` and the scoped read method to `BoardLaneEventRepository`; implement both in `src/adapters/sqlite/board-lane-event-repository.ts`. Update `src/adapters/sqlite/authority-map.ts` if it enumerates the table's columns or indexes. Add the same-idempotency-key-across-two-repositories test.
- **CP 3 — Lossless mapping and stable id.** Carry `repositoryId` through `eventToEntry`, restore it in `entryToEvent`, remove the `'' as never` cast and its stale comment. Add the two round-trip tests (non-null `from`, null `from`). Replace `repositoryId(rootDir)` at `src/adapters/backlog/backlog.ts:799` with the stable derivation and add the worktree-versus-primary-checkout equality test.
- **CP 4 — Scoped metrics read and composition.** Add `repositoryId` to `ConcreteMetricsReadAdapterOptions`; scope the lane-event read, filter usage records, and key `usageRecordsToOutcomes` by `(repo, mission)`. Wire `deps.repositoryId` at `src/composition/board-projection.ts:59`. Add the legacy-sentinel exclusion test. Confirm `test/task-2343-board-projection-repro.test.ts` still passes after the constructor signature change.
- **CP 5 — Final gate and docs.** Update `docs/adr/0053-persistence-inventory.md` if it lists `board_lane_events` columns or indexes. Run the gate, record the red→green evidence for the reproduction test, and note the historical-id behaviour change from the Risks section.

### Checkpoint Documentation Requirements
Every checkpoint document (CP-N.md) MUST include:
- A summary of work done
- A `## Goal Check` section, using that exact heading
- A 3-column pipe-delimited markdown table with the exact columns: `| Criterion | Evidence | Status |`
- At least one evidence row per Success Criterion addressed in that checkpoint, using verifiable references. Parallix already accepts:
  1. **File:line references** — e.g. `src/application/recording/board-event-recorder.ts:92` (must point to an existing file and line on the final tree; re-check the line number after edits shift it)
  2. **Test names** — e.g. `"metrics built for alpha exclude lane events recorded for beta"` (must match a test name actually present in the repo)
  3. **Test file paths** — e.g. `test/task-2347-01-repository-identity-repro.test.ts` (must be an existing test file)
  4. **ADR references** — e.g. `ADR 0051`, `ADR 0053` (must correspond to an existing file under `docs/adr/`)
  5. **Recognized repo commands or paths** — e.g. `` `npm test -- test/task-2347-01-repository-identity-repro.test.ts` ``, `` `./scripts/verify-local.sh all` ``, `` `git show ed52d6abf` ``
- **Weak-agent failure mode, stated explicitly:** raw `stat` or `ls` output, a bare exit code, or generic prose such as "verified the schema is correct" is NOT sufficient evidence on its own. Every row must pair any shell output with at least one of the five accepted reference forms above. A row whose Evidence column contains only shell output or only prose fails the checkpoint.
- For CP 1, the red evidence row must cite the reproduction test path plus the failing test name and the parent commit `ed52d6abf`. For CP 5, the green evidence row must cite the same test path and name plus `` `./scripts/verify-local.sh all` ``.
- A non-generic `Next action:` line at the bottom naming the next concrete file or command, not "continue with the mission".

Example Goal Check table:

| Criterion | Evidence | Status |
|---|---|---|
| Repository id survives the recorder round-trip | `src/application/recording/board-event-recorder.ts:92`, `"entryToEvent restores repositoryId for a null-from transition"` | PASS |
| Cross-repository contamination is locked by a test | `test/task-2347-01-repository-identity-repro.test.ts` | PASS |
| Persistence authority documented | `ADR 0053` | PASS |
| Verification gate ran | `./scripts/verify-local.sh all` | PASS |

## Gates
- [x] `./scripts/verify-local.sh all`

## Restricted Areas
- `src/application/projections/metrics.ts` — formula logic belongs to task-2347.03, task-2347.04 and task-2347.06. Change it only if a type signature forces it, and say so in the checkpoint.
- `src/adapters/cli/commands/stats.ts` — `statsMissionKey` is the keying precedent to copy, not to edit.
- Existing migration files `0001`–`0010` under `src/adapters/sqlite/migrations/` — forward-only; add a new file, never edit an applied one.
- `src/adapters/sqlite/database-path-resolver.ts` — the single-database decision stands.
- The `usage_statistics` table schema.
- `backlog/tasks/` beyond this mission's own task file; `missions/` belonging to other slugs.

## Stop Rules
- Stop and report if the reproduction test passes at parent commit `ed52d6abf` — the bug as described is not reproduced and the scope needs re-derivation before any fix.
- Stop if `loadDefaultMigrations()` cannot tolerate the new migration's numeric prefix alongside the existing duplicate `0005`/`0006` prefixes; report the loader's ordering rule instead of renaming existing migrations.
- Stop if making `repository_id` `NOT NULL` requires dropping and recreating `board_lane_events` without the migration runner's pre-migration backup being in effect; report the gap rather than shipping an unbacked destructive migration.
- Stop if scoping the metrics read makes the production board show zero metrics for the current repository because every existing local row carries the legacy sentinel — report the observed row counts and the ids involved; do not widen the filter to include sentinel rows to make the board look populated.
- Stop if the fix requires changing a metric formula in `src/application/projections/metrics.ts` to keep tests green.
- Stop after three consecutive failed `./scripts/verify-local.sh all` runs with the same failure signature; report the shortest decisive failing line rather than continuing to patch.
