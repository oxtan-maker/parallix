# CP-3 — Both closeout cases confirmed; verification gate run

## Summary

Narrowed the CP-2 fix and ran the mission gate.

### Fix narrowed after the gate found a regression

CP-2's first shape trimmed the whole payload set against repository-wide
`git ls-files` / `git ls-tree` listings. The full gate showed that widened the
blast radius: `test/task-2377.05-integrate-squash-bounce.test.ts` — `SC2 S3: an
already-landed payload short-circuits without bouncing` went from green to
failing, because a doubled git boundary that returns empty listings emptied the
payload and defeated the already-at-HEAD short-circuit.

The shipped fix is scoped to the one path that can actually go missing. Every
other payload path comes from `git diff --cached --name-only -z`, so it is
staged by construction; only `originalTaskPath`, added by `stageCloseout` after
`backlog.completeTask` moves the file, can end up named but unknown to git.
`stageCloseout` now drops exactly that path from `intendedPayloadPaths` when
`isLivePathspec` reports it is in neither the index (`git ls-files
--error-unmatch`) nor `HEAD` (`git cat-file -e HEAD:<path>`), both in
`src/application/integrate/squash.ts`. A path still in `HEAD` but gone from the
index is a staged deletion and is retained — that is how a base-tracked task
file keeps landing its removal. The helper only ever removes one entry, so the
`git commit --only` scoping cannot widen.

`SC2 S3` is green again, and the focused regression stays green.

### Red-to-green, against this mission's parent commit

Same test file, same assertions, only `src/application/integrate/squash.ts`
swapped for its parent-commit version via
`git show d264f35fa:src/application/integrate/squash.ts`:

- parent version → `node --import tsx --test test/task-2537-squash-closeout-unstaged-task-path.test.ts` = 1 pass / 1 fail, the base-absent case aborting with `fel: sökvägsangivelsen ”backlog/tasks/task-9002 - Land-a-draft-authored-task.md” motsvarade inte några av git kända filer` ("pathspec did not match any git-known files")
- fixed version → same command = 2 pass / 0 fail

### Gate result

`./scripts/verify-local.sh all` → **2855 pass / 0 fail, exit 0**.

The first gate run failed one test —
`test/task-2534-backlog-repo-state.test.ts` — `TASK-2534: the repository has no
stale backlog/tasks copies of completed tasks` — because the checkout carried
both `backlog/tasks/task-2535 - Restore-the-90-line-coverage-gate-by-covering-low-coverage-modules.md`
and the canonical `backlog/completed/` copy of the same task. That duplicate was
inherited from `main` (`git ls-tree -r --name-only main backlog`) and present at
this mission's parent commit `d264f35fa`; it is the residue of this very defect,
since the landing that should have removed the tasks copy is the one that
aborted with the pathspec error quoted in TASK-2537.

The two files' bodies are byte-identical; only the tasks copy's frontmatter is
stale (`status: backlog`, `assignee: [claude]`, missing the `user_value` label)
against the completed record's `status: done`. TASK-2534's own assertion message
states the rule — "stale backlog/tasks copies must be dropped at landing, not
carried on main" — so the tasks copy was removed with `git rm`, leaving the
canonical completed record untouched. `node --import tsx --test
test/task-2534-backlog-repo-state.test.ts` → 1 pass / 0 fail, and the full gate
now exits 0.

### Docs

No workflow or user-facing behaviour change: `px integrate` lands the same
files with the same `--only` scoping; the fix removes an abort on a path that
never carried a change. `./scripts/verify-local.sh docs` passes ("authored
documentation contains no volatile implementation evidence and relative links
resolve"), so no documentation update is owed.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC1: base-absent task path lands without a pathspec abort | `test/task-2537-squash-closeout-unstaged-task-path.test.ts` — `TASK-2537: a task file absent from the base branch lands without a pathspec abort`; `node --import tsx --test test/task-2537-squash-closeout-unstaged-task-path.test.ts` → 2 pass / 0 fail (1 pass / 1 fail with `git show d264f35fa:src/application/integrate/squash.ts` restored) | PASS |
| SC2: landed commit holds the source removal and completed addition | Same test asserts `backlog/completed/<slug>` is `A` in `git diff-tree --no-commit-id --name-status -r --no-renames HEAD` and that `git cat-file -e HEAD:backlog/tasks/<slug>` fails, so the landed tree carries no `backlog/tasks/` copy | PASS |
| SC3: base-tracked task path still lands both closeout paths with no ambient staged file | `test/task-2537-squash-closeout-unstaged-task-path.test.ts` — `TASK-2537: a base-tracked task file still lands its removal and completed addition` (`D` on the tasks path, `A` on the completed path, `ambient.txt` staged during closeout absent from the commit and still `A  ambient.txt` in `git status --porcelain`) | PASS |
| SC4: closeout keeps explicitly scoped `git commit --only` pathspecs | `stageCloseout` / `isLivePathspec` in `src/application/integrate/squash.ts` only delete `originalTaskPath` from `intendedPayloadPaths`; `squashAndLand` still commits via `git commit --only -- ...intendedPayloadPaths`. Guarded by both tests in `test/task-2537-squash-closeout-unstaged-task-path.test.ts` and by `test/task-2533-squash-payload-pathspec-quotes.test.ts` — `TASK-2533: squash landing commits backslash and non-ASCII payload paths with ordinary ones` | PASS |
| SC5: repository verification succeeds on the final tree | `./scripts/verify-local.sh all` → 2855 pass / 0 fail, exit 0 on the final tree; the one first-run failure, `test/task-2534-backlog-repo-state.test.ts` — `TASK-2534: the repository has no stale backlog/tasks copies of completed tasks`, was repaired by removing the inherited duplicate `backlog/tasks/task-2535 - Restore-the-90-line-coverage-gate-by-covering-low-coverage-modules.md` | PASS |

Supporting evidence: `npx eslint src/application/integrate/squash.ts
test/task-2537-squash-closeout-unstaged-task-path.test.ts
test/lib/test-categories.ts test/default-test-suite.test.ts` → clean;
`npm run typecheck` → clean; `node --import tsx --test
test/default-test-suite.test.ts` → 4 pass / 0 fail, confirming the new test's
integration-tier registration.

Next action: hand off for review — the mission gate
`./scripts/verify-local.sh all` exits 0 on the committed tree, and SC1–SC5 are
each backed by a named test in
`test/task-2537-squash-closeout-unstaged-task-path.test.ts`.
