# CP-2 — Restore the Backlog title on persisted board cards

## Work done

Repaired `src/composition/board-projection.ts` so the operator-local SQLite
aggregate can no longer overwrite the Backlog-owned mission title.

Added one shared helper, `withRepositoryTitle(stored, markdown)`, and routed
both mission read paths through it:

- `loadBoardMissions()` — the board catalog. Previously
  `return stored ? [stored] : ...` replaced the whole Markdown mission with the
  persisted aggregate, publishing the aggregate's placeholder title to every
  lane that had been through `px draft` intake. It now returns
  `withRepositoryTitle(stored, mission)`, keeping SQLite's lifecycle state and
  the Backlog title.
- `loadMission(id)` — the mission detail read. It returned the stored aggregate
  verbatim; it now overlays the Markdown title through the same helper.

Only `title` is overlaid. Status, `rawStatus`, assignee, labels, checkpoints,
review, NEL and `closedAt` still come from whichever source already owned them,
so lane placement, ordering and metrics are untouched. This matches
`MISSION_FIELD_AUTHORITY.title` (`target-repository`) in
`src/application/mission-authority.ts`.

No change was needed in `src/interfaces/tui/mission-card.tsx`: it already
renders `card.title` and only substitutes `unavailable` for the empty/`>-`
placeholders that `isPlaceholderTitle` recognises. `src/interfaces/tui/flow-panel.tsx`
was not modified — it renders the FLOW metrics panel and holds no card title path.

The upstream write that records `<Title> (slug)` into SQLite at draft intake
(`src/adapters/cli/commands/draft-stats.ts`, `intake` step, reads MISSION.md's
first line while it is still `templates/mission-scaffold.md`) is deliberately
left alone: it is mission metadata loading, which the mission's Stop Rules put
behind explicit scope confirmation. The read-side authority fix also repairs the
rows already written that way, so no data migration is required.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Reproduction passes after the repair | `npx tsx --test test/task-2441-mission-title-repro.test.ts` → `pass 1 / fail 0`, `"board cards render the backlog title, not the mission scaffold placeholder, on every lane"` | PASS |
| Active, review, integration and done cards use the shared repaired title path | `withRepositoryTitle` in `src/composition/board-projection.ts` is the single overlay used by `loadBoardMissions` and `loadMission`; all four `LANES` entries assert in `test/task-2441-mission-title-repro.test.ts` | PASS |
| Slug, labels, status and lane content still render | `test/task-2441-mission-title-repro.test.ts` asserts `card.lane` per lane and `output.includes(lane.id)`; only `title` is overlaid in `withRepositoryTitle` | PASS |
| Lane selection, ordering and metrics unchanged | `npx tsx --test test/task-2440-repro.test.ts test/task-2438-worktree-board-repro.test.ts test/adapters/board-projection-builder-cp3.test.ts` → `pass 9 / fail 0`, incl. `"external lifecycle update moves only its persisted board card"` and `"composeBoardProjection wires all eight adapters into BoardProjectionBuilder"` | PASS |
| Title authority honoured rather than re-specified | `MISSION_FIELD_AUTHORITY.title` = `target-repository` in `src/application/mission-authority.ts` | PASS |
| Types and lint clean on changed files | `npm run typecheck` (clean); `npx eslint src/composition/board-projection.ts test/task-2441-mission-title-repro.test.ts` (no output) | PASS |
| `./scripts/verify-local.sh all` | deferred to CP-3 | PENDING |

Next action: run the mission's declared gate `./scripts/verify-local.sh all` on
this tree and record the result plus the final Goal Check in CP-3.md.
