# CP-3: Verification gate and handoff

## Summary

Ran the mission-declared gate and the repository's static-analysis gate on the
final tree, and re-confirmed the red→green proof against the mission parent
commit.

- `./scripts/verify-local.sh all` — exit 0, `tests 2369 / pass 2369 / fail 0`.
  The reproduction file's tests appear in that run, so the suite did not
  silently drop them.
- `./scripts/verify-local.sh static-analysis` — all four stages pass (ESLint,
  `tsc` typecheck, test-hygiene, test typecheck). One test typecheck error
  found on the first run (`Set<'draft:create'>` is not a `Capability` set) was
  fixed in the reproduction test before this checkpoint.
- `./scripts/verify-local.sh docs` — PASS after the
  `docs/authority-reference.md` update.

No focused or skipped tests were introduced: the five new tests are plain
`test(...)` calls with no `.only` and no `.skip`.

Scope notes for the reviewer:

- The mission declared the reproduction test as
  `test/task-2454-web-board-draft-repro.test.js`. This repository has 435
  `*.test.ts` files and zero `*.test.js`, and `npm test` runs
  `tsx test/run-default-tests.ts`, so the test was authored as `.ts` and the
  `Reproduction-Test:` line in `MISSION.md` was corrected to match. That is the
  only edit to `MISSION.md`.
- The repair stayed inside the Draft path. Directory resolution for unrelated
  commands was not touched: preflight's new `launchDir` defaults to the caller's
  working directory, so `px draft` is behaviourally identical, and only the
  board composition sets the anchor.
- No mission lifecycle semantics changed. The dispatch backstop still rejects
  any aggregate that has advanced past `backlog`; the only widened case is the
  absence of an aggregate, which is what draft itself creates.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| A regression test reproduces the board Draft failure from a mission worktree and fails at the mission parent commit | `test/task-2454-web-board-draft-repro.test.ts`; running it in a detached worktree at `git merge-base main HEAD` (`902562eb4`) reports `fail 5`, with `"board Draft on a pre-draft backlog card reaches the draft workflow instead of reporting a missing mission"` failing on actual `mission authority could not find the mission` | PASS |
| The same regression test passes after the repair and asserts resolved context rather than the server cwd | `npx tsx --test test/task-2454-web-board-draft-repro.test.ts` reports `pass 5, fail 0`; test `"board Draft anchors the draft launch directory to the main checkout when the backend runs in a mission worktree"` asserts the recorded launch directory and task-lookup root | PASS |
| Automated coverage for both launch locations | tests `"board Draft anchors the draft launch directory to the main checkout when the backend runs in a mission worktree"` and `"board Draft anchors the draft launch directory to the main checkout when the backend runs in the main checkout"` in `test/task-2454-web-board-draft-repro.test.ts` | PASS |
| The board command path and drafting subcommands receive a resolved repository root / working directory | test `"board Draft anchors the draft launch directory to the main checkout when the backend runs in a mission worktree"` asserts base-branch detection, backlog task lookup, and mission-branch creation all target the primary checkout; steps past preflight already took explicit directory arguments | PASS |
| The board reports a successful Draft result and no missing-mission failure | tests `"board Draft on a pre-draft backlog card completes and runs the whole draft sequence once"` and `"board Draft on a pre-draft backlog card reaches the draft workflow instead of reporting a missing mission"` in `test/task-2454-web-board-draft-repro.test.ts` | PASS |
| Direct CLI drafting behaviour preserved | test `"px draft keeps the caller working directory as its launch context when the board anchor is absent"`, plus `test/draft-command.test.ts`, `test/draft.test.ts`, `test/draft_preflight_modern.test.ts` | PASS |
| Existing board/draft guards unchanged in strength | `test/board-controller.test.ts`, `test/task-2427-board-draft.test.ts`, `test/task-2426-repro.test.ts` all pass inside the full gate run | PASS |
| `./scripts/verify-local.sh all` completes successfully on the final tree | `./scripts/verify-local.sh all` — exit 0, `tests 2369 / pass 2369 / fail 0` | PASS |
| Lint and static analysis clean on changed files | `./scripts/verify-local.sh static-analysis` — ESLint, typecheck, test-hygiene, test typecheck all PASS | PASS |
| No focused or unannotated skipped tests introduced | `./scripts/verify-local.sh static-analysis` test-hygiene stage; `test/task-2454-web-board-draft-repro.test.ts` contains no `.only` or `.skip` | PASS |
| Docs updated for the user-facing behaviour change | `docs/authority-reference.md` "Workflow model"; `./scripts/verify-local.sh docs` PASS | PASS |
| Red-to-green reproduction test for a bug-labeled mission | `test/task-2454-web-board-draft-repro.test.ts`, declared as `Reproduction-Test:` in `missions/task-2454/MISSION.md`; red at `902562eb4`, green at HEAD | PASS |

Next action: hand off for review — Parallix performs the lifecycle transition; no further implementation work remains for this mission.
