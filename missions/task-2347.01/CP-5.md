## CP-5 — Final gate and docs

`docs/adr/0053-persistence-inventory.md` does not enumerate `board_lane_events`
columns or indexes (mentions only `lane-event-recorder` conceptually), so no
update required per the conditional scope.

Final gate: `./scripts/verify-local.sh all` exits 0, 1812 pass, 0 fail.
`./scripts/verify-local.sh static-analysis` exits 0 (ESLint, tsc --checkJs,
test-hygiene, test typecheck all clean).

### Red-to-green evidence

Reproduction test `test/task-2347-01-repository-identity-repro.test.ts`:
- At parent commit `ed52d6abf`: 0 pass, 5 fail (cross-repo WIP 2!==1,
  round-trip ''!=='alpha' x2, idempotency 0!==1)
- Final tree: 6 pass, 0 fail (all criteria green)

### Historical id behaviour change

`repositoryId(rootDir)` at the transition call site used the worktree path
(e.g. `/home/magnus/code/parallix-task-2347.01`) as the stored repository id.
Now `resolveStableRepositoryId(rootDir)` derives from `remote.origin.url`
(e.g. `parallix-task-2347.01`) with toplevel basename fallback. Rows written
by earlier builds under a worktree-path id will not match the new id and will
behave like foreign rows — this is preferable to silent misattribution.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC1: Repro test exists, fails at `ed52d6abf`, passes on final tree | `test/task-2347-01-repository-identity-repro.test.ts`, `"metrics built for alpha exclude lane events recorded for beta"` | PASS |
| SC2: `BoardLaneEventEntry` has `repositoryId`, repo has scoped read | `src/application/ports/operation-history.ts:17` (`repositoryId`), `src/application/ports/operation-history.ts:31` (`findByRepositoryId`) | PASS |
| SC3: `board_lane_events` has `NOT NULL` `repository_id` with CHECK, composite indexes, same key across repos test | `src/adapters/sqlite/migrations/0011-board-lane-events-repository-id.sql:31` (CHECK), `:72` (UNIQUE), `:76` (mission index), `test/task-2347-01-repository-identity-repro.test.ts:237` | PASS |
| SC4: `grep -n "as never" board-event-recorder.ts` no match, round-trip tests | `src/application/recording/board-event-recorder.ts` (no match), `test/task-2347-01-repository-identity-repro.test.ts:202,220` | PASS |
| SC5: `ConcreteMetricsReadAdapter` requires `repositoryId`, scoped reads, (repo,mission) key | `src/application/projections/metrics-read-adapter.ts:36` (option), `:63` (scoped read), `:115` ((repo,mission) key) | PASS |
| SC6: Stable id across worktrees test | `test/task-2347-01-repository-identity-repro.test.ts:302` — `"repository id from mission worktree path equals id from primary checkout"` | PASS |
| SC7: Legacy sentinel exclusion test | `test/task-2347-01-repository-identity-repro.test.ts:263` — `"metrics for named repository exclude legacy-unscoped rows"` | PASS |
| SC8: `board-projection.ts` passes `deps.repositoryId` | `src/composition/board-projection.ts:59` | PASS |
| SC9: `./scripts/verify-local.sh all` exits 0, no `.only`, no bare `.skip` | `./scripts/verify-local.sh all` — 1812 pass, 0 fail | PASS |
| Static analysis gate | `./scripts/verify-local.sh static-analysis` — ESLint, tsc, test-hygiene, test typecheck all PASS | PASS |

Next action: Mission complete. All checkpoints passed, all gates green. Ready for Parallix lifecycle transition.
