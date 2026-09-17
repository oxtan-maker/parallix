# CP-2 — Minimal closeout staging fix

## Summary

Added `retainCommittablePayloadPaths` to
`src/application/integrate/squash.ts` and called it from `squashAndLand`
immediately before `commitLandedSquash` builds the
`git commit --only -m ... -- <paths>` invocation.

The helper enforces the invariant the mission names: every path handed to
`--only` must resolve to something git knows. It reads the two authoritative
sets once each —

- `git ls-files -z --` (live index entries), and
- `git ls-tree -r -z --name-only HEAD --` (base `HEAD` entries)

— and removes from `intendedPayloadPaths` any path in neither, logging the
drop at debug level. `-z` on both, for the same reason the payload capture uses
it (task-2533): raw unquoted paths compare byte-for-byte against the captured
pathspecs, so a space, backslash, or non-ASCII filename still matches.

Why this is the whole fix, and why it does not widen the payload:

- A path in neither the index nor `HEAD` contributes **no change** to the
  commit. Naming it can only abort the landing; dropping it changes nothing
  about what lands. That is the draft-authored `backlog/tasks/<slug>` after
  closeout moves it away.
- A path in `HEAD` but gone from the index is a **staged deletion** and is
  retained — that is precisely how a base-tracked `backlog/tasks/<slug>` lands
  its removal, so the pre-existing case is untouched.
- The helper only ever *removes* entries from the payload set, so the `--only`
  scoping cannot pull in an ambient index entry.

No change to `stageCloseout`'s move, to `backlog.completeTask`, or to the
`--only` scoping itself. No new dependency, no new port, no new file in
`src/`.

Empirically confirmed against real git before writing the helper: with
`backlog/tasks/<slug>` absent from `HEAD`, `git commit --only -- <that path>`
exits 1 with "pathspec did not match"; with the path tracked at `HEAD` and
deleted in the index, the same invocation commits the rename.

## Verification run at this checkpoint

`node --import tsx --test test/task-2537-squash-closeout-unstaged-task-path.test.ts`
→ **2 pass / 0 fail**.

Red-to-green proof (same test file, same assertions, only the production file
swapped): restoring `src/application/integrate/squash.ts` from the CP-1 commit
`c826fff` via `git show c826fff:src/application/integrate/squash.ts` and
rerunning the same command gives **1 pass / 1 fail**, the base-absent case
failing with the named-pathspec abort. Restoring the fix returns it to 2 pass.

Related landing suites re-run green:
`node --import tsx --test test/task-2533-squash-payload-pathspec-quotes.test.ts test/task-2534-stale-backlog-copy-landing-repro.test.ts test/task-2517-landed-squash-base-branch-detection.test.ts test/task-2517-cp3-landed-closeout.test.ts`
→ 11 pass / 0 fail.
(`test/task-2377.05-integrate-squash-bounce.test.ts` needs the runner's
`--experimental-test-module-mocks` flag and cannot be invoked with a bare
`node --test`; it runs under the project runner in the CP-3 gate.)

Static analysis on every changed file:
`npx eslint src/application/integrate/squash.ts test/task-2537-squash-closeout-unstaged-task-path.test.ts test/lib/test-categories.ts test/default-test-suite.test.ts`
→ clean, and `npm run typecheck` → clean.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC1: base-absent task path lands without a pathspec abort | `test/task-2537-squash-closeout-unstaged-task-path.test.ts` — `TASK-2537: a task file absent from the base branch lands without a pathspec abort` | PASS |
| SC2: landed commit holds the source removal and completed addition | Same test asserts `backlog/completed/<slug>` is `A` in `git diff-tree --name-status -r --no-renames HEAD` and that `git cat-file -e HEAD:backlog/tasks/<slug>` fails, so no tasks copy survives | PASS |
| SC3: base-tracked task path still lands both closeout paths with no ambient staged file | `test/task-2537-squash-closeout-unstaged-task-path.test.ts` — `TASK-2537: a base-tracked task file still lands its removal and completed addition` (asserts `D` on the tasks path, `A` on the completed path, `ambient.txt` absent from the commit and still `A  ambient.txt` in `git status --porcelain`) | PASS |
| SC4: closeout keeps explicitly scoped `git commit --only` pathspecs | `retainCommittablePayloadPaths` in `src/application/integrate/squash.ts` only deletes from `intendedPayloadPaths`; `squashAndLand` still commits via `git commit --only -- ...intendedPayloadPaths`, and both tests in `test/task-2537-squash-closeout-unstaged-task-path.test.ts` prove the ambient staged entry stays out | PASS |
| SC5: repository verification succeeds on the final tree | `./scripts/verify-local.sh all` | DEFERRED to CP-3 (gate runs on the final tree) |

Next action: run the mission gate `./scripts/verify-local.sh all` on the final
tree, confirm both landing cases once more through the project runner
(`npm run test:integration:ci`), and record the final Goal Check in
`missions/task-2537/CP-3.md`.
