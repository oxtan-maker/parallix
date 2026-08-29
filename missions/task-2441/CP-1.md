# CP-1 — Red reproduction for the missing mission title

## Work done

Wrote `test/task-2441-mission-title-repro.test.ts`, a deterministic reproduction
that seeds a temporary repository plus an isolated SQLite operator database and
drives the production board composition (`composeBoardProjection`) end-to-end
into the Ink `MissionCard` renderer.

The fixture models the reported situation exactly:

- Four Backlog task files, one per reported lane (`active`, `review`,
  `approved` → integration, `done` in the completed store), each with the
  frontmatter title `Restore title visibility`.
- Four persisted mission aggregates in SQLite carrying the mission-scaffold
  placeholder title `<Title> (task-44NN)` — the value `px draft` intake records,
  because `templates/mission-scaffold.md` line 1 is
  `# Mission: <Title> ({{slug}})` and intake reads that heading before the agent
  fills it in (`src/adapters/cli/commands/draft-stats.ts`, `intake` step).

Each lane asserts the projected `card.title`, that the rendered Ink output
contains `Restore title visibility`, that it does not contain `<Title>`, and
that the card still renders its slug.

### Traced defect (recorded now, repaired in CP-2)

`composeBoardProjection` in `src/composition/board-projection.ts`
(`loadBoardMissions`) substitutes the **whole** stored aggregate for the
Markdown mission whenever a persisted aggregate exists, so the operator-local
cache's placeholder title overwrites the Backlog title. `title` is declared
`target-repository` authority in `MISSION_FIELD_AUTHORITY`
(`src/application/mission-authority.ts`), so the substitution violates the
project's own authority map. Missions with no persisted aggregate keep the
Markdown title, which is why only some lanes looked broken on the real board.

### Scope note

The mission doc predicted the repair in `src/interfaces/tui/flow-panel.tsx`.
That file renders the FLOW metrics panel and contains no card title path;
`MissionCard` already renders `card.title` faithfully. The title is lost
earlier, inside the board projection composition, which the mission's
Restricted Areas allow ("without evidence that the title is lost earlier in the
data flow" — that evidence is the red assertion below). CP-2 stays inside the
board projection and does not touch backlog parsing or mission schemas.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Reproduction renders a mission whose source title is `Restore title visibility` and asserts that exact title in the Ink output | `test/task-2441-mission-title-repro.test.ts`, `"board cards render the backlog title, not the mission scaffold placeholder, on every lane"` | PASS |
| Reproduction is red before the repair because the output carries `<Title>` | `npx tsx --test test/task-2441-mission-title-repro.test.ts` → `AssertionError: task-4401 card title comes from the Backlog task` / actual `'<Title> (task-4401)'` | PASS |
| Reproduction covers active, review, integration and done cards | `test/task-2441-mission-title-repro.test.ts` `LANES` fixture (`active`, `review`, `approved`→integration, `done`) | PASS |
| Slug/lane metadata preserved by the assertions | `test/task-2441-mission-title-repro.test.ts` asserts `card.lane` and `output.includes(lane.id)` per lane | PASS |
| Reproduction is deterministic under `test/` with mocked board data | temp repo + temp `PARALLIX_HOME` SQLite database created and removed inside the test; no network, no shared state | PASS |
| Repair itself | deferred to CP-2 | PENDING |
| `./scripts/verify-local.sh all` | deferred to CP-3 | PENDING |

Next action: in CP-2, keep `target-repository` authority for `title` when
`loadBoardMissions` and `loadMission` in `src/composition/board-projection.ts`
merge the persisted lifecycle aggregate, then re-run
`npx tsx --test test/task-2441-mission-title-repro.test.ts` for green.
