# CP-1: Reproduction test locked (red)

## Summary

Traced the reported board failure to its source and locked it with a failing
regression test before touching production code.

Root cause (two independent defects on the same Draft path):

1. **Pre-draft cards have no Mission aggregate.** The board's BACKLOG lane is
   projected from Backlog.md task files, while `BoardCommandController` guards
   every command by loading the mission from the SQLite authority. A backlog
   card that has never been drafted has no row there — `px draft` step 4
   (intake) is what materializes it. Both the stale-command guard and the
   draft dispatch backstop mapped that expected absence to
   `mission authority could not find the mission`, which is the exact string
   the user saw. Verified against the operator database: `task-2451` is
   `status: backlog` on the board and has no `missions` row, so its Draft
   button can never succeed.
2. **Launch-directory leakage.** The draft workflow's preflight derives the
   base branch from `process.cwd()` and, for a detected feature branch, looks
   the backlog task up under `process.cwd()` too. A backend started inside a
   mission worktree therefore drafts against that worktree's branch instead of
   the primary checkout, while `resolveMainRepo()` (already worktree-aware)
   points every later step at the main repository — an inconsistent context.

The reproduction test drives the real production composition
(`composeProductionCapabilities`) with mocked draft-adapter boundaries: no git,
no Forgejo, no agent launch, no network.

Mission-document correction: the mission declared
`Reproduction-Test: test/task-2454-web-board-draft-repro.test.js`, but this
repository has no `.js` tests (435 `*.test.ts`, zero `*.test.js`; `npm test`
runs `tsx test/run-default-tests.ts`). The declared path was corrected to
`.ts` so the red→green gate can actually execute the file. Nothing else in
MISSION.md changed.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Regression test exists and reproduces the board Draft failure from a mission worktree | `test/task-2454-web-board-draft-repro.test.ts`, test `"board Draft anchors the draft launch directory to the main checkout when the backend runs in a mission worktree"` | PASS |
| The reproduction fails at the mission parent commit with the reported error | `npx tsx --test test/task-2454-web-board-draft-repro.test.ts` reports 4 failing, and `"board Draft on a pre-draft backlog card reaches the draft workflow instead of reporting a missing mission"` fails on actual `mission authority could not find the mission` | PASS (red as required) |
| The same test will assert resolved repository context rather than the server cwd | `test/task-2454-web-board-draft-repro.test.ts` records `detectLaunchBaseBranchFn` / `resolveTaskFileFn` roots via the `draftAdapterDeps` helper | PASS |
| Coverage names both supported launch locations | tests `"...when the backend runs in a mission worktree"` and `"...when the backend runs in the main checkout"` in `test/task-2454-web-board-draft-repro.test.ts` | PASS |
| Direct CLI drafting behaviour is pinned before the change | test `"px draft keeps the caller working directory as its launch context when the board anchor is absent"` in `test/task-2454-web-board-draft-repro.test.ts` | PASS |
| External boundaries are mocked (no Forgejo, agent, or network) | `test/task-2454-web-board-draft-repro.test.ts` injects `draftAdapterDeps` through `composeProductionCapabilities(..., { draftAdapterDeps })`, same seam as `test/task-2426-repro.test.ts` | PASS |
| Verification gate | `./scripts/verify-local.sh all` — deferred to CP-3 per the mission checkpoint plan | PENDING |

Next action: implement CP-2 — let `draft:create` treat a missing Mission aggregate as the expected pre-draft state in `src/application/controller/board-controller.ts`, and add an explicit launch-directory anchor to the board's draft composition in `src/composition/production-capabilities.ts` plus `src/adapters/cli/commands/draft-stats.ts` preflight, then re-run the reproduction test to green.
