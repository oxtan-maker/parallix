# Mission: Integrate refuses to land stale backlog task copies resurrected from mission branches (task-2534)

## Goal
Make the local squash landing path (`squashAndLand` in `src/application/integrate/squash.ts`) drop every staged `backlog/tasks/` path whose task id already has a canonical file in `backlog/completed/` or `backlog/archive/tasks/` at the base branch `HEAD`, fail closed if any repo-wide `duplicate-completed` issue survives closeout, and add a CI guard that fails whenever the real repository carries such a duplicate.

Reproduction-Test: test/task-2534-stale-backlog-copy-landing-repro.test.ts

## Why Now
Closed missions keep reappearing in `backlog/tasks/` after unrelated missions land. `fd6b0d485` (mission/task-2525.02) re-added five stale copies, and `9abfab5c0` (mission/task-2526) re-added three. Ten stale copies were removed by hand in `2e026761d`. Open branches (`mission/task-2489`, `mission/task-2478`, `mission/task-2525`, `mission/task-2522`, `mission/task-2235`) would re-add them again if landed today. TASK-2524 fixed only the landing mission's own twin. `checkBacklogIntegrity()` and `pruneStaleBacklogDuplicates()` already exist in `src/adapters/backlog/task-file-io.ts`, but nothing on the landing path calls them. CI stays green while main is polluted, and the board shows closed work as open.

## Refinement Signals
- Predicted NEL bucket: Medium (81–235)
- Confidence: High
- Selection note: activate as-is
- Main drivers: one git-fixture reproduction test (integration-ci tier, about 80 lines), one helper plus two call sites in `squash.ts` (about 30 lines), one repo-state unit test (about 15 lines), and a registration line in `test/lib/test-categories.ts`

## Scope
- Author the red reproduction test `test/task-2534-stale-backlog-copy-landing-repro.test.ts`, register it as `integration-ci` in `test/lib/test-categories.ts`, and have it drive the real `squashAndLand` path against a throwaway git repo.
- In `squashAndLand`, after `squashMerge(...)` and before `intendedPayloadPaths` is captured, find staged `backlog/tasks/` paths whose task id has a `backlog/completed/` or `backlog/archive/tasks/` file at base `HEAD`. Run `git reset -q HEAD -- <path>` on each one, delete it from the working tree, and log it with `fmt.log.info`, naming the task id and the canonical path. Reuse `checkBacklogIntegrity` or `pruneStaleBacklogDuplicates`. Add at most one helper function.
- After `stageCloseout(...)` and before `commitLandedSquash(...)`, run `checkBacklogIntegrity(baseWorktree)` across the whole repo. If any `duplicate-completed` issue remains, call `abortWith(landing, ...)` and list the offending paths.
- Check whether `src/application/integrate/github-pr.ts` builds a local payload from a branch merge. The header comment states that GitHub owns the merge. Record the finding with a citation in the checkpoint, and change the file only if a local payload is actually built.
- Add a repo-state unit test, `test/task-2534-backlog-repo-state.test.ts`, that reads the real checkout without git calls and asserts that `checkBacklogIntegrity(repoRoot).filter(i => i.type === 'duplicate-completed')` is empty.
- Only if the meaning of documented behavior changes: add one sentence to the integration behavior docs saying that stale backlog copies are dropped at landing.

## Out of Scope
- Hand-deleting files from `backlog/tasks/` as the fix, and committing any "restore main's backlog" data to the branch (like `ef04eb307`).
- TASK-2524 `completeTask` twin handling in `src/adapters/backlog/task-transitions.ts` and `test/task-2524-slug-duplicate-closeout-repro.test.ts`.
- `resolveTaskFile` ambiguity semantics and how ambiguity shows up in `px status` or the board.
- `src/application/rebase-workflow.ts` and `test/task-2503-repro.test.ts`.
- Landing order, gate selection, `commit --only` payload scoping, the `-z` payload capture (TASK-2533), and the pre-landing integration guard (TASK-2517).
- Cleaning or landing the open polluted branches (`mission/task-2489`, `mission/task-2478`, and others). This mission prevents their stale copies from landing. It does not rewrite those branches.
- New dependencies, new classes, strategy objects, config flags, and a "warn only" mode.

## Success Criteria
> **Falsifiability rule (ADR 0039 Part 2):** Each criterion must be falsifiable. Forbidden: subjective adjectives ("easy, fast, simple, intuitive, user-friendly, responsive, quick, efficient" without an attached metric) and vague quantifiers ("multiple, several, some, many, few, various"). For refactor / condense / migration missions, the criterion must enumerate the specific elements (rules, files, behaviours) that must survive — generic phrases like "preserve critical content" are not sufficient.

- SC1 (AC #1, DoD #1): In `test/task-2534-stale-backlog-copy-landing-repro.test.ts`, main contains `backlog/completed/task-9001 - x.md`, and the mission branch history adds `backlog/tasks/task-9001 - x.md`. After the real squash landing, `git ls-tree -r HEAD` of the landed commit does not list `backlog/tasks/task-9001 - x.md`. This test fails on the parent commit `2e026761d` and passes after the fix.
- SC2 (AC #2): In the same fixture, the landed commit does contain `backlog/tasks/task-9002 - new.md`, a new task file with no canonical twin.
- SC3: The landing log captured by the reproduction test contains an info line with `task-9001` and the canonical path `backlog/completed/task-9001 - x.md`.
- SC4 (AC #3): A test forces a `duplicate-completed` issue to remain after closeout, for example a stale copy that the step-1 filter did not remove. In that test, `px integrate` / `squashAndLand` aborts through `abortWith`, the error message lists the offending path, and base `HEAD` is unchanged (no squash commit is created).
- SC5 (AC #4): `test/task-2534-backlog-repo-state.test.ts` exists as a unit-tier test that makes no git calls, and it passes on the final tree. The checkpoint shows that it fails when a temporary duplicate `backlog/tasks/` copy of a completed task is present. That duplicate must not be committed.
- SC6 (AC #5): The reproduction fixture mirrors the `mission/task-2489` / `mission/task-2478` shape: stale copies added only in unsquashed branch history, with canonical files added on main by a squash commit. The fixture lands zero stale `backlog/tasks/` paths.
- SC7: The checkpoint records the `src/application/integrate/github-pr.ts` finding with a citation, as either "no local payload, unchanged" or the applied change.
- SC8 (DoD #4, #6): The diff contains no `.only`, no bare `.skip`, no `todo`, no `|| true`, and no try/catch that swallows the integrity abort. Changed files are limited to `src/application/integrate/squash.ts`, `src/adapters/backlog/task-file-io.ts` (export or reuse only), `src/application/integrate/github-pr.ts` (only if SC7 requires it), `test/lib/test-categories.ts`, the two new test files, at most one docs sentence, and mission/backlog files. Any other file has a written reason in the checkpoint.
- SC9 (DoD #2, #3): `./scripts/verify-local.sh static-analysis` and `./scripts/verify-local.sh all` both pass on the final tree, and the checkpoint quotes the tail of the captured output.

## Risks and Assumptions
- Assumption: `checkBacklogIntegrity` and `pruneStaleBacklogDuplicates` read the working tree, not `HEAD`. Right after `git merge --squash`, the working tree already contains the stale files. The helper must therefore decide "canonical at base `HEAD`" by checking the `completed/` and `archive/tasks/` paths present before the merge (they are unchanged by the squash), or it must confirm that the working-tree scan gives the same answer. Document the choice in the checkpoint.
- Risk: the landing mission's own `tasks/` file legitimately exists before `stageCloseout` moves it to `completed/`. The step-1 filter must use only canonical files on base `HEAD`, so the landing mission's own first closeout is not dropped. Keep the TASK-2524 twin path intact.
- Risk: the trailing backlog-noise patch that `squashMerge` preserves and restores can touch `backlog/`. Removing stale paths must happen after that restore and must not disturb unstaged noise.
- Risk: the repo-state test can fail on a branch whose own history re-added stale copies. The fix is the landing code or a rebase that takes main's side, never hand-deleted data in the mission diff.
- Assumption: task ids are parsed with the existing helper in `task-file-io.ts`. Dotted ids such as `task-2525.01` must match exactly, and `task-2525` must not match `task-2525.01`.

## Checkpoints
- CP 1: Lock the bug (red). Create `test/task-2534-stale-backlog-copy-landing-repro.test.ts` and register it under `integration-ci` in `test/lib/test-categories.ts`. Scenario: build a temporary git repo with base branch `main` containing `backlog/completed/task-9001 - x.md`. Create a mission branch whose unsquashed history adds `backlog/tasks/task-9001 - x.md` and `backlog/tasks/task-9002 - new.md`, with the canonical file reaching main through a separate squash commit so the merge-base lacks it. Drive the real `squashAndLand` landing code path, with no git stubs. Assertions: the landed `HEAD` tree lacks `backlog/tasks/task-9001 - x.md` and contains `backlog/tasks/task-9002 - new.md`, and the log names `task-9001`. The test must fail on parent `2e026761d` because the landed tree contains the stale file. Quote the exact failure line in `CP-1.md`. Do not change `src/` in this checkpoint.
- CP 2: Fix (green). In `squash.ts`, add the step-1 stale-path filter before `intendedPayloadPaths` is captured and the step-2 fail-closed `checkBacklogIntegrity` backstop before `commitLandedSquash`, reusing the existing `task-file-io.ts` helpers. Add the SC4 abort test. Inspect `github-pr.ts` and record the SC7 finding. Show the reproduction test passing.
- CP 3: CI guard and final verification. Add `test/task-2534-backlog-repo-state.test.ts` and demonstrate SC5 (red with a temporary uncommitted duplicate, green on the clean tree). Add the docs sentence only if needed. Run `./scripts/verify-local.sh static-analysis` and `./scripts/verify-local.sh all`, then write the final Goal Check covering SC1–SC9.

### Checkpoint Documentation Requirements
Every checkpoint document (`missions/task-2534/CP-N.md`) MUST include:
- A summary of work done, naming each changed file and why it changed. SC8 requires a written reason for any file outside the allowed list.
- A section with the exact heading `## Goal Check`.
- Under it, a 3-column pipe-delimited markdown table with the exact header `| Criterion | Evidence | Status |`, and one row per success criterion (SC1–SC9) that the checkpoint touches. The final checkpoint needs rows for all nine criteria.
- Evidence in durable forms that Parallix verifies today. Lead with these:
  1. **Exact test names** that exist in the final tree, for example the `it(...)` title in `test/task-2534-stale-backlog-copy-landing-repro.test.ts` that asserts `task-9001` is absent from the landed commit.
  2. **Test file paths**, for example `test/task-2534-stale-backlog-copy-landing-repro.test.ts` and `test/task-2534-backlog-repo-state.test.ts`.
  3. **ADR references**, for example `ADR 0039`, which must match a file under `docs/adr/`.
  4. **Recognized repo commands or paths** in backticks, for example `` `./scripts/verify-local.sh all` ``, `` `./scripts/verify-local.sh static-analysis` ``, `` `npm test -- test/task-2534-stale-backlog-copy-landing-repro.test.ts` ``, `` `git diff --name-only main...HEAD` ``, or `` `px integrate task-2534` ``.
  5. File:line references such as `src/application/integrate/github-pr.ts:2` are accepted when needed (for example for the SC7 github-pr finding), but they are discouraged because line numbers rot. Prefer the forms above.
- For CP 1, the exact red failure line from the reproduction test run at the parent commit. For CP 2 and CP 3, the passing output tail.
- Weak-agent failure mode, stated explicitly: raw `stat`/`ls`/`git ls-tree` output or generic prose ("should work", "verified manually") alone is NOT evidence, and such a row counts as FAIL. Always pair shell output with an accepted reference above: a test name, a test file path, an ADR, or a backticked repo command.
- A non-generic `Next action:` line at the bottom that names the next concrete step (for example, "Next action: add step-2 integrity backstop in squashAndLand and the SC4 abort test").

Example Goal Check table:

| Criterion | Evidence | Status |
|---|---|---|
| SC1 stale task-9001 copy absent from landed commit | `test/task-2534-stale-backlog-copy-landing-repro.test.ts`, test name as written in file, `npm test -- test/task-2534-stale-backlog-copy-landing-repro.test.ts` | PASS |
| SC5 repo-state guard | `test/task-2534-backlog-repo-state.test.ts` | PASS |
| SC9 full gate | `./scripts/verify-local.sh all` | PASS |

## Gates
- [ ] ./scripts/verify-local.sh static-analysis
- [ ] ./scripts/verify-local.sh all

## Restricted Areas
- `src/adapters/backlog/task-transitions.ts` and `test/task-2524-slug-duplicate-closeout-repro.test.ts` (TASK-2524 twin handling)
- `src/application/rebase-workflow.ts` and `test/task-2503-repro.test.ts` (TASK-2503)
- `resolveTaskFile` ambiguity semantics
- The pre-landing integration guard (TASK-2517), the `-z` payload capture (TASK-2533), `commit --only` scoping, landing order, and gate selection in `src/application/integrate/`
- `backlog/tasks/`, `backlog/completed/`, and `backlog/archive/` data files other than this mission's own task file
- Git history: no rewriting of main, no force-push, and no pushing mission branches to `origin`
- `package.json` dependencies

## Stop Rules
- Stop and report if the reproduction test cannot be made red on parent `2e026761d` using the real squash path. Do not fall back to a mock-only reproduction.
- Stop and report if the fix appears to require changing a Restricted Area or adding more than one new helper function.
- Stop and report if `checkBacklogIntegrity` cannot tell "canonical at base `HEAD`" apart from the landing mission's own pending closeout without changing its semantics for `draft-stats.ts`.
- Stop and report if the repo-state test fails on the branch because of inherited stale copies that a clean rebase onto main does not remove. Do not hand-delete data to make it pass.
- Stop and report if `github-pr.ts` turns out to build a local merge payload whose fix would exceed the one-helper limit.
- Stop after two consecutive failed `./scripts/verify-local.sh all` runs with the same unrelated failure, and record the failure output.
