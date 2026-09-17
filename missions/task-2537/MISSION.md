# Mission: Preserve closeout pathspecs for draft-authored tasks (task-2537)

## Goal
Make `px integrate` land a mission whose backlog task was authored only on the
mission branch, while retaining the intentionally scoped `git commit --only`
payload and the existing behaviour for task files already tracked by the base
branch.

## Why Now
The final integration step currently aborts after closeout moves a
draft-authored task from `backlog/tasks/` to `backlog/completed/`: the removed
source has no base-branch index entry, so it cannot satisfy the squash commit's
named `--only` pathspec. This blocks integration of otherwise reviewed work.

## Refinement Signals
- Predicted NEL bucket: Small (0–80)
- Confidence: High
- Selection note: activate as-is
- Main drivers: isolated closeout staging invariant, existing focused
  regression-test location, and no change to the commit payload boundary

## Scope
- Add a regression test at
  `test/task-2537-squash-closeout-unstaged-task-path.test.ts` covering a base
  checkout that does not track the task path.
- Change the closeout staging in `squashAndLand`/`stageCloseout` so every path
  named by the final `git commit --only` is a valid staged pathspec when the
  task is moved to `backlog/completed/`.
- Preserve the closeout result for a task path already tracked on the base
  branch: removal under `backlog/tasks/`, addition under
  `backlog/completed/`, and a payload limited to intended paths.

## Out of Scope
- Changing task-path capture or quoting behavior addressed by TASK-2533.
- Broadening the squash commit beyond its explicit `--only` payload.
- Changing backlog completion semantics, mission lifecycle policy, or remote
  integration workflows.

## Success Criteria
> **Falsifiability rule (ADR 0039 Part 2):** Each criterion must be falsifiable. Forbidden: subjective adjectives ("easy, fast, simple, intuitive, user-friendly, responsive, quick, efficient" without an attached metric) and vague quantifiers ("multiple, several, some, many, few, various"). For refactor / condense / migration missions, the criterion must enumerate the specific elements (rules, files, behaviours) that must survive — generic phrases like "preserve critical content" are not sufficient.

- SC1: The test `test/task-2537-squash-closeout-unstaged-task-path.test.ts`
  creates a repository whose base commit lacks `backlog/tasks/<slug>`, performs
  the closeout-and-squash sequence, and passes without a pathspec-match abort.
- SC2: In the SC1 landed squash commit, the changed paths include the removal
  of `backlog/tasks/<slug>` and the addition of `backlog/completed/<slug>`.
- SC3: Regression coverage verifies a base-tracked task path still lands with
  the same two closeout paths and with no ambient staged file included in the
  landed squash commit.
- SC4: The final closeout commit continues to use explicitly scoped
  `git commit --only` pathspecs rather than committing the full index.
- SC5: `./scripts/verify-local.sh all` exits successfully on the final tree.

## Risks and Assumptions
- Risk: staging an untracked source solely to create a valid deletion pathspec
  could accidentally widen the payload or leave stale index state.
- Risk: test setup that invokes real external integration infrastructure would
  violate the unit-test boundary; the regression must use an offline throwaway
  Git repository.
- Assumption: `git commit --only` rejects an explicitly named path absent from
  both the index and worktree, so both intended closeout paths must be staged
  before commit construction.

## Checkpoints
- CP 1: Author the failing reproduction test at
  `test/task-2537-squash-closeout-unstaged-task-path.test.ts` before changing
  production code. It must create an offline repository where the parent/base
  commit has no `backlog/tasks/<slug>`, then create and move that task to
  `backlog/completed/<slug>` and exercise the closeout squash path. Assert that
  the sequence completes and the landed commit contains the source removal and
  destination addition. The assertion must fail at this mission's parent
  commit (red) with the named-pathspec failure and pass after the fix (green).
- CP 2: Implement the minimal closeout staging change that makes each intended
  `--only` pathspec valid without widening the payload; run the focused
  regression test and record its result.
- CP 3: Confirm both base-absent and base-tracked task cases, including the
  absence of an ambient staged file in the landed commit, then run the required
  verification gate and document the final Goal Check.

Reproduction-Test: test/task-2537-squash-closeout-unstaged-task-path.test.ts

### Checkpoint Documentation Requirements
Every checkpoint document (CP-N.md) MUST include:
- Durable evidence first: cite exact test names, ADR references, test file
  paths, or recognized repository commands/paths such as backticked `npm ...`,
  `node ...`, `git ...`, `px ...`, or `./...`. File:line references are
  accepted parenthetically when needed but discouraged because line numbers rot.
- A summary of work done.
- The exact heading `## Goal Check`.
- A 3-column pipe-delimited table with this exact header:
  `| Criterion | Evidence | Status |`.
- At least one evidence row for every SC1–SC5 criterion. For CP 1, identify the
  red result of `test/task-2537-squash-closeout-unstaged-task-path.test.ts`; for
  later checkpoints, record its green result and the exact verification command
  used.
- Raw `stat`/`ls` output or generic prose alone is not enough. Shell output may
  supplement evidence only when paired with one of the accepted references
  above.
- A concrete `Next action:` line at the bottom.

Example Goal Check table:

| Criterion | Evidence | Status |
|---|---|---|
| SC1: untracked base task lands | `test/task-2537-squash-closeout-unstaged-task-path.test.ts` | PASS |
| SC5: repository verification succeeds | `./scripts/verify-local.sh all` | PASS |

## Gates
- [ ] ./scripts/verify-local.sh all

## Restricted Areas
- Do not modify `src/application/integrate` outside the closeout staging and
  final squash payload logic needed for this defect.
- Do not alter `git commit --only` scoping or commit unrelated index entries.
- Do not modify TASK-2533's NUL-delimited filename-capture behavior.
- Do not access real Forgejo or remote integrations from the regression test.

## Stop Rules
- Stop and seek direction if a valid staged source-path representation cannot
  be created without widening the final commit payload.
- Stop and seek direction if the needed fix changes task completion semantics
  outside the closeout staging path.
- Stop and seek direction if reproducing the defect requires network access,
  real Forgejo, or changes outside the allowed integration and test areas.
