# CP 2 — No projection repair required; DB-backed lifecycle wins for every non-terminal state

## Work done

The mission's Scope asks to "repair the projection so the DB-backed `MissionStore`
lifecycle wins over stale Markdown for any non-terminal state, without dropping
missions that are genuinely `done` in both sources." The trace in CP-1 established that
this is already the case, and the premise re-check in CP-1 established that the real
store holds TASK-2508 as `active` (non-terminal), not `integration`.

Verified by the regression test `test/task-2515-integration-lifecycle-not-masked.test.ts`:
- `task-2515 every non-terminal persisted lifecycle wins over completed Markdown`
  persists each of `backlog`, `refined`, `active`, `review`, `integration` alongside a
  `backlog/completed/` `status: done` task and asserts the projected lane equals the
  persisted status. All pass — the `loadBoardMissions` markdown branch returns
  `withRepositoryTitle(stored, mission)` whenever a `loadByRepository` match exists, so
  the Markdown `done` can never win.
- The persisted re-add loop (`stored.status !== 'done' && !isArchivedMission`) keeps
  non-terminal persisted missions even when their Markdown record is unavailable
  (`closure-time-missing` for a retained worktree with no `closedAt`).
- Genuinely `done` in both sources: a persisted `done` mission with a matching Markdown
  record is projected via the same `withRepositoryTitle(stored, …)` branch, so it is
  not dropped.

No source file was changed: `src/composition/board-projection.ts`,
`src/adapters/backlog/mission-materialization.ts`,
`src/adapters/backlog/concrete-mission-read-adapter.ts`, and
`src/application/projections/board.ts` are untouched. Introducing a second
lane-derivation path here would violate ADR 0053 rule 4 and the mission's Stop Rule, so
the correct action was to confirm the single shared projection rather than add one.

## Scope restatement (Stop Rule)

The mission's premise (TASK-2508 stuck in `integration`) is false: the real operator
store holds it as `active`. Even so, the projection correctly prefers the persisted
lifecycle for every non-terminal state, so no repair is warranted. This is a legitimate
not-reproducible investigation outcome under the mission's own Stop Rule
("re-check the premise and restate the scope rather than guessing"), not a code fix.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC1 every non-terminal persisted lifecycle projects | `test/task-2515-integration-lifecycle-not-masked.test.ts`, `"task-2515 every non-terminal persisted lifecycle wins over completed Markdown"` (green on parent `9e8d656b9`) | Holds — invariant verified; bug not reproducible |
| SC2 integrate-lane / integrate:merge present for integration | `test/task-2515-integration-lifecycle-not-masked.test.ts`, `"task-2515 integration lifecycle not masked by completed backlog task"` | Holds in hermetic invariant test |
| SC3 single DB-backed projection, no parallel derivation | `src/composition/board-projection.ts::loadBoardMissions`; `ADR 0053` rule 4 | PASS (verified) |
| SC6 no focused/unannotated skipped tests | `./scripts/verify-local.sh all` (0 skipped) | PASS |

Next action: CP-3 — verify the attention queue and the human-only integration rule
together; correct SC4 to reflect the observation boundary honestly.
