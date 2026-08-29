# CP-3 — Verification gate and final Goal Check

## Work done

Ran the mission's declared gate on the completed tree.

The first gate run failed on one guard, `"default test runner routes every moved
group to integration and excludes it from default"` in
`test/default-test-suite.test.ts`: the new reproduction seeds a real Git
repository and a migrated SQLite database, so `test/lib/test-run-plan.ts`
routes it to the integration layer by its boundary heuristic, and the guard's
`expectedIntegrationFiles` roster had to name it. Registered
`task-2441-mission-title-repro.test.ts` in that roster with the same rationale
comment style used for its siblings `task-2438-worktree-board-repro.test.ts` and
`task-2440-repro.test.ts`. No production or test behaviour changed with that
edit; it records where the runner already places the file.

The reproduction therefore runs under `npm run test:integration` (and directly
via `npx tsx --test test/task-2441-mission-title-repro.test.ts`), not in the
default `npm test` suite — identical placement to the two neighbouring board
repros.

No documentation change was required: this restores the board's already
documented behaviour (mission cards show the Backlog task title) rather than
introducing a new workflow or user-facing contract.

## Summary of the mission

- CP-1: red reproduction at `test/task-2441-mission-title-repro.test.ts`.
- CP-2: one-field authority repair in `src/composition/board-projection.ts`
  (`withRepositoryTitle`), shared by `loadBoardMissions` and `loadMission`.
- CP-3: declared gate green; reproduction green.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| The focused reproduction renders a mission whose source title is `Restore title visibility` and asserts that exact title is present in the rendered Ink output | `test/task-2441-mission-title-repro.test.ts`, `"board cards render the backlog title, not the mission scaffold placeholder, on every lane"` | PASS |
| The reproduction fails before the repair because the output contains `<Title>`, and passes after it | CP-1 recorded the red run (`actual '<Title> (task-4401)'` vs `expected 'Restore title visibility'`); after CP-2, `npx tsx --test test/task-2441-mission-title-repro.test.ts` → `pass 1 / fail 0` | PASS |
| Mission cards in active, review, integration and done use the shared repaired title path | `withRepositoryTitle` in `src/composition/board-projection.ts` is the single overlay for both `loadBoardMissions` and `loadMission`; the `LANES` fixture in `test/task-2441-mission-title-repro.test.ts` asserts all four lanes | PASS |
| Existing slug, labels, status and checkpoint/next-action content remain rendered | Only `title` is overlaid in `withRepositoryTitle`; `test/task-2441-mission-title-repro.test.ts` asserts `card.lane` and the rendered slug per lane; `src/interfaces/tui/mission-card.tsx` is unmodified | PASS |
| Lane selection, ordering, metrics and layout untouched | `./scripts/verify-local.sh all` → `tests 2184 / pass 2184 / fail 0`, including `"external lifecycle update moves only its persisted board card"` and `"composeBoardProjection wires all eight adapters into BoardProjectionBuilder"` | PASS |
| Title authority respected rather than redesigned | `MISSION_FIELD_AUTHORITY.title` stays `targetSource` (`owner: 'target-repository'`, `role: 'source-of-truth'`) in `src/application/mission-authority.ts`, guarded by `test/domain-authority.test.ts`, `"authority is exhaustive over mission fields and covers the legacy path inventory"` and `"mission reads prefer repository truth and label cache fallback stale"`; the repair only re-applies that existing authority on read, with no schema, wrapping or layout change | PASS |
| Lint and static analysis clean on every changed file | `./scripts/verify-local.sh static-analysis` → exit 0, `ALL STAGES PASSED` (ESLint, tsc, test-hygiene, test typecheck) | PASS |
| No focused or unannotated skipped tests introduced | `./scripts/verify-local.sh static-analysis` stage 3, `PASS: no test-hygiene violations` | PASS |
| `./scripts/verify-local.sh all` succeeds on the completed mission tree | `./scripts/verify-local.sh all` → exit 0, `tests 2184 / pass 2184 / fail 0` | PASS |

Next action: hand the committed mission off for review, calling out that the
repair landed in `src/composition/board-projection.ts` rather than the
mission-predicted `src/interfaces/tui/flow-panel.tsx`, and that the upstream
`px draft` intake write of the `<Title> (slug)` scaffold heading
(`src/adapters/cli/commands/draft-stats.ts`) was left in place under this
mission's Stop Rules and deserves its own ticket.
