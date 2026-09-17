# CP-1 — Failing reproduction test for the closeout pathspec abort

## Summary

Authored the reproduction test at
`test/task-2537-squash-closeout-unstaged-task-path.test.ts` before touching any
production code. The test drives the real `squashAndLand` from
`src/application/integrate/squash.ts` against throwaway offline Git
repositories (`fs.mkdtempSync`, `core.hooksPath=/dev/null`, no network, no
Forgejo — the provider seam returns `isForgejoReviewEnabled: () => false`).

Two cases share one seeding helper:

1. **Base-absent (the defect).** The base commit carries only `README.md`; the
   mission branch authors `backlog/tasks/<slug>` plus `src/landed-feature.txt`,
   exactly like a `px draft`-authored task file. After the squash merge the
   closeout moves the task file to `backlog/completed/<slug>`, which leaves the
   source path in neither the index nor `HEAD`.
2. **Base-tracked (non-regression).** The base commit already carries
   `backlog/tasks/<slug>`; the mission branch modifies it.

Both cases stage an unrelated `ambient.txt` from inside the `completeTask` seam
— that is, *after* the squash payload is captured — standing in for a
concurrent bare-board commit dirtying the index. Each case asserts that entry
never enters the landed commit, so the `git commit --only` scoping stays under
test (SC4).

Registered the new file as integration-tier in `test/lib/test-categories.ts`
and `test/default-test-suite.test.ts`; `test/default-test-suite.test.ts` passes
4/4, so the tier registration is consistent.

### Red result (at this mission's parent commit, no production change yet)

`node --import tsx --test test/task-2537-squash-closeout-unstaged-task-path.test.ts`
→ 1 pass / 1 fail.

The base-absent case fails with the exact defect from TASK-2537, captured from
the production `fmt.log.fail` output with the test's log mock lifted:

```
[FAIL] Could not create the squash commit in the local integration checkout.
[FAIL] fel: sökvägsangivelsen ”backlog/tasks/task-9002 - Land-a-draft-authored-task.md” motsvarade inte några av git kända filer
```

("pathspec did not match any git-known files".) The base-tracked case already
passes, which is the property CP-2 must not break.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC1: base-absent task path lands without a pathspec abort | `test/task-2537-squash-closeout-unstaged-task-path.test.ts` — `TASK-2537: a task file absent from the base branch lands without a pathspec abort`; run with `node --import tsx --test test/task-2537-squash-closeout-unstaged-task-path.test.ts` | RED (expected at CP-1; named-pathspec abort reproduced) |
| SC2: landed commit holds the source removal and completed addition | Same test asserts `backlog/completed/<slug>` is added and no `backlog/tasks/<slug>` survives in the landed tree (`git cat-file -e HEAD:<tasks path>` must fail) | RED (blocked by the SC1 abort) |
| SC3: base-tracked task path still lands both closeout paths with no ambient staged file | `test/task-2537-squash-closeout-unstaged-task-path.test.ts` — `TASK-2537: a base-tracked task file still lands its removal and completed addition` | PASS |
| SC4: closeout keeps explicitly scoped `git commit --only` pathspecs | Both tests assert `ambient.txt` (staged during closeout) is absent from `git diff-tree HEAD` and still shows as `A  ambient.txt` in `git status --porcelain` | PASS (base-tracked case); pending for base-absent |
| SC5: repository verification succeeds on the final tree | `./scripts/verify-local.sh all` | DEFERRED to CP-3 (gate runs on the final tree) |

Supporting: `node --import tsx --test test/default-test-suite.test.ts` → 4 pass
/ 0 fail, confirming the new file's integration-tier registration in
`test/lib/test-categories.ts`.

Next action: implement the CP-2 closeout staging fix in
`src/application/integrate/squash.ts` so every path named by the final
`git commit --only` resolves to a live index or `HEAD` entry, then rerun
`node --import tsx --test test/task-2537-squash-closeout-unstaged-task-path.test.ts`
and record the green result.
