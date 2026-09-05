# CP-2: Context-resolution repair (green)

## Summary

Two smallest-possible repairs, one per defect traced in CP-1.

**1. Pre-draft cards are draftable (`src/application/controller/board-controller.ts`).**
The board projects its BACKLOG lane from the task files; the SQLite Mission
aggregate for a card is created by draft's own intake step. Both guards on the
`draft:create` path treated that expected absence as an error:

- `checkStaleCommand` now returns `null` for `draft:create` on a missing
  aggregate (there is no status precondition to resolve when nothing has been
  materialized). Every other command still fails with
  `mission authority could not find the mission`.
- `dispatchDraft` now rejects only a mission that exists in a non-`backlog`
  state; a missing aggregate is the ordinary pre-draft case and proceeds.

The dispatch backstop is unchanged in strength: a card whose aggregate has
already advanced past `backlog` is still rejected before the workflow port is
reached, so projection drift cannot project a successful move.

**2. Board drafting anchors to the primary checkout
(`src/adapters/cli/commands/draft-stats.ts`, `src/composition/production-capabilities.ts`).**
Draft's preflight derived the launch base branch and — for a detected feature
branch — the backlog task lookup root from `process.cwd()`. A board backend
started inside a mission worktree therefore resolved a different repository
context than the main checkout every later step (`resolveMainRepo()`,
`ensureMissionBranch`, `ensureWorktree`, `bootstrapBacklogTask`) already used.

Preflight now resolves a single `launchDir`, and the board composition sets
`anchorLaunchDirToMainRepo: true` so the server's own directory carries no
mission intent. The CLI default is untouched: with no anchor, `launchDir` is
still the caller's working directory, so feature-branch missions drafted with
`px draft` behave exactly as before. Every step past preflight already took an
explicit directory argument, so no other subcommand boundary needed changing.

Docs: `docs/authority-reference.md` gained the two durable rules this changes —
drafting materializes the mission (no pre-existing mission required), and a
board backend anchors drafting to the primary checkout regardless of where it
was launched.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Reproduction fails at the mission parent commit | `git worktree add --detach <tmp> $(git merge-base main HEAD)` + `npx tsx --test test/task-2454-web-board-draft-repro.test.ts` reports `fail 5` at `902562eb4` | PASS |
| Reproduction passes after the repair | `npx tsx --test test/task-2454-web-board-draft-repro.test.ts` reports `pass 5, fail 0` | PASS |
| Draft resolves repository context rather than the server's current directory | test `"board Draft anchors the draft launch directory to the main checkout when the backend runs in a mission worktree"` in `test/task-2454-web-board-draft-repro.test.ts` | PASS |
| Both launch locations covered | tests `"...when the backend runs in a mission worktree"` and `"...when the backend runs in the main checkout"` in `test/task-2454-web-board-draft-repro.test.ts` | PASS |
| Board reports a successful Draft result, no missing-mission failure | test `"board Draft on a pre-draft backlog card completes and runs the whole draft sequence once"` and `"board Draft on a pre-draft backlog card reaches the draft workflow instead of reporting a missing mission"` in `test/task-2454-web-board-draft-repro.test.ts` | PASS |
| Direct CLI drafting behaviour preserved | test `"px draft keeps the caller working directory as its launch context when the board anchor is absent"`, plus `test/draft-command.test.ts`, `test/draft.test.ts`, `test/draft_preflight_modern.test.ts` green | PASS |
| Existing draft/board guards still hold | `test/board-controller.test.ts`, `test/task-2427-board-draft.test.ts`, `test/task-2426-repro.test.ts` — 124 tests pass via `npx tsx test/run-default-tests.ts <files>` | PASS |
| Docs reflect the behaviour change | `docs/authority-reference.md` "Workflow model"; `./scripts/verify-local.sh docs` | PASS |
| Full verification gate | `./scripts/verify-local.sh all` — CP-3 | PENDING |

Next action: run `./scripts/verify-local.sh all` on the final tree for CP-3 and record the gate result with the full-suite totals.
