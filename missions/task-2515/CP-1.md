# CP 1 — Trace the mission-read → board-projection authority boundary; premise re-checked against the real store

## Work done

Traced the full authority boundary the mission names, end to end, against the real
composition (`composeBoardProjection` + `BoardProjectionBuilder.build`).

Path traced:
- `src/composition/board-projection.ts::loadBoardMissions` — loads Markdown missions,
  loads `MissionStore.loadByRepository(repositoryId)`, builds `byId`, and for each
  Markdown mission returns `withRepositoryTitle(stored, mission)` when a persisted
  aggregate exists, drops a Markdown-only `done`, else keeps the Markdown mission. A
  second loop re-adds every non-`done`, non-archived persisted mission.
- `withRepositoryTitle` — `{ ...stored, title: markdown?.title ?? stored.id }`: the
  persisted aggregate's `status` is what survives, so `lane = mission.status` is the
  persisted lifecycle.
- `src/adapters/backlog/concrete-mission-read-adapter.ts` / `mission-materialization.ts`
  — a completed `done` task with a retained worktree and no `closedAt`
  materialises to `closure-time-missing` (unavailable); a closed one materialises to
  `done`. Either way the persisted loop / `withRepositoryTitle` supplies the persisted
  lifecycle.
- `src/application/projections/board.ts::attentionReason` / `attentionAction` — a card
  in lane `integration` yields `{ kind: 'integrate-lane' }` →
  `{ kind: 'integrate:merge', display: 'px integrate <id>' }`, and `availableBoardCommands`
  enables `integrate` exactly when `mission.status === 'integration'`.

## Premise re-check against the real operator store (Stop Rule)

The mission's premise is that the SQLite `Mission` aggregate for TASK-2508 is stuck in
`integration`. The Stop Rule mandates re-checking this against the real aggregate before
either scoping a fix or closing. The operator database resolves to
`<PARALLIX_HOME>/parallix.db` (`src/adapters/sqlite/database-path-resolver.ts`), i.e.
`~/.local/state/parallix/parallix.db` (`src/adapters/storage/storage.ts::resolveParallixHome`).
Read through the project's own `node:sqlite` `DatabaseSync` path (readOnly):

```
missions row: id='task-2508', repository_id='parallix',
              status='active', raw_status='backlog',
              assignee='codex', closed_at=NULL, version=33
```

The persisted lifecycle for TASK-2508 is **`active`** (non-terminal), not `integration`.
The premise as written is false. This is exactly the condition the Stop Rule names.

## Investigation conclusion

The defect as described does **not** reproduce. The `loadBoardMissions` merge has
preferred the persisted aggregate whenever a `loadByRepository` match exists since
task-2438/2441 (verified via `git show 9e8d656b9:src/composition/board-projection.ts`
and an empty `git diff 9e8d656b9 -- src/composition/board-projection.ts`). A
completed-Markdown `done` can only win where `loadByRepository` returns **no** row for
the id — the "row absent" branch the mission's own Risks/Stop Rules flag — which is a
store-data condition, not a projection reconstruction. There is no queue-only
`rawStatus`/task-file lane derivation: the board and the attention queue both read
`mission.status` from the single shared projection (`board-readers.ts::build` →
`loadAllMissions`).

The regression test `test/task-2515-integration-lifecycle-not-masked.test.ts` is a valid
ADR 0053 rule 4 invariant guard, not a bug reproduction: it is **green on the parent
commit `9e8d656b9`** because the boundary is already correct. It fails only if the
persisted-preference in `loadBoardMissions` is ever removed. It does not satisfy SC5's
red-on-parent clause.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC1 integration mission projects despite completed Markdown | Premise false: real store holds `task-2508` `status='active'`, not `integration`; `test/task-2515-integration-lifecycle-not-masked.test.ts` | NOT REPRODUCIBLE — premise false |
| SC2 attention queue exposes integrate-lane / integrate:merge | `test/task-2515-integration-lifecycle-not-masked.test.ts`; `src/application/projections/board.ts` `attentionReason`/`attentionAction` | Holds in hermetic invariant test |
| SC3 single DB-backed projection, no backlog reconstruction | `src/composition/board-projection.ts::loadBoardMissions`; `ADR 0053` rule 4 | PASS (verified) |
| SC5 regression test red-on-parent | `test/task-2515-integration-lifecycle-not-masked.test.ts` green on `9e8d656b9` | FALSIFIED (green on parent) |
| SC6 verify gate | `./scripts/verify-local.sh all` | PASS |

Next action: CP-2 — confirm the DB-backed lifecycle wins for every non-terminal state
and that no projection repair is required; the correct action is to confirm the single
shared projection rather than add a second lane-derivation path.
