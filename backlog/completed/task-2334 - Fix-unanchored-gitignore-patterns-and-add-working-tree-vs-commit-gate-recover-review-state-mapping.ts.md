---
id: TASK-2334
title: >-
  Fix unanchored gitignore patterns and add working-tree-vs-commit gate (recover
  review-state-mapping.ts)
status: done
assignee: []
created_date: '2026-08-03 06:10'
updated_date: '2026-08-04 06:38'
labels:
  - bug
  - main-broken
  - tooling
  - gitignore
  - gates
dependencies: []
references:
  - src/platform/runtime/lib/review/review-state.ts
  - .gitignore
  - src/platform/runtime/lib/commands/checkpoint.ts
  - src/platform/runtime/lib/commands/active.ts
  - src/platform/runtime/lib/commands/draft.ts
  - src/domain/review.ts
  - test/domain-review-workflow-state.test.ts
  - test/fixtures/review-state-db.js
  - c96628beabdcca923948e35275c2739b36dbdeca
priority: high
ordinal: 69900
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Mission 2322.12 (commit c96628bea) landed `import { applyReviewStateToReview, reviewStateDataFrom } from './review-state-mapping.js'` in `src/platform/runtime/lib/review/review-state.ts:27` without landing the module it imports. `main` is currently broken — every CLI entrypoint fails:

    [FAIL] Cannot find module '.../lib/review/review-state-mapping.js' imported from .../lib/review/review-state.ts

## Root cause

`.gitignore:23` is `lib/` — unanchored, so it matches every directory named `lib` at any depth, including `src/platform/runtime/lib/`. The intent was root-only; lines 20-23 read:

    # Stray tsc emit to repo root (noEmit=true, these are dead artifacts)
    index.js
    px.js
    lib/

`index.js` and `px.js` are unanchored too — same latent bug, not yet triggered.

The rule was introduced around mission/task-1366..1375. Existing files under `src/platform/runtime/lib/` are unaffected because they were tracked before the rule existed, and gitignore does not apply to tracked files. The rule is therefore invisible until someone adds a NEW file under any `lib/` directory — which 2322.12 did when it split the review-state domain mapping helpers into a new module.

## Why the defences missed it

1. Staging is silent. `checkpoint.ts:52` uses `git add -A`; `active.ts:684` and `draft.ts:1059` use `git add -- <paths>` without `-f`. `-A` skips ignored paths with no warning and exit 0. Nothing in the commit path calls `git check-ignore` or reconciles "files written" against "files staged".
2. Every gate ran against the worktree, not the commit. Typecheck, tests and the review loop all executed in the mission worktree where the file existed on disk, so the build was genuinely green there. No gate builds from a clean checkout/export of the resulting tree, so working-tree != commit is unobserved.
3. Reviewers see the diff, not the tree. `git show` displays a new import line; the absence of a file produces no diff hunk, so a reviewer reasonably assumes the module is in the changeset.

This is not a defence that failed — it is a defect class nothing in the pipeline looks for.

## Recovery status

The module is unrecoverable. `git log --all -- '*review-state-mapping*'` returns nothing, the `/home/magnus/code/parallix-task-2322.12` worktree has been removed, and a filesystem-wide `find` for the filename returned zero hits. It must be rewritten from its three call sites:

- `review-state.ts:142` — `reviewStateDataFrom(result.mission.review)`
- `review-state.ts:324` — `applyReviewStateToReview(seed, legacy as never)`
- `review-state.ts:563` — `applyReviewStateToReview(mission.review, this.toJSON())`

`src/domain/review.ts` (+288 lines in the same commit) did land, so the target types are intact. `test/domain-review-workflow-state.test.ts` and `test/fixtures/review-state-db.js` also landed and should constrain the reconstruction.

Reconstruction is inference, not recovery — it belongs under this fresh task id, not an amendment to 2322.12.

## Scope

1. Restore `main` to a working state by reconstructing `src/platform/runtime/lib/review/review-state-mapping.ts`.
2. Anchor the three root-emit patterns in `.gitignore` to `/index.js`, `/px.js`, `/lib/`. Verify first that no other `lib/` content is intended to stay ignored.
3. Add a commit-time guard so this cannot recur silently.
4. Add a gate that builds from a clean tree rather than the worktree — this catches the whole class, not just gitignore.

Prefer 4 over 3 if only one can be afforded; 3 is the cheap targeted fix, 4 is the general one.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 `.gitignore` root-emit patterns are anchored (`/index.js`, `/px.js`, `/lib/`) and `git check-ignore -v src/platform/runtime/lib/review/review-state.ts` reports no match
- [ ] #2 `src/platform/runtime/lib/review/review-state-mapping.ts` exists, is tracked by git, and exports `applyReviewStateToReview` and `reviewStateDataFrom` with signatures satisfying the three call sites in `review-state.ts` (lines 142, 324, 563)
- [ ] #3 `npm run dev -- draft <slug> --agent codex` and the other CLI entrypoints start without a module-resolution failure
- [ ] #4 `test/domain-review-workflow-state.test.ts` passes and the full suite is no worse than the pre-2322.12 baseline
- [ ] #5 A commit-time guard fails the checkpoint when a source-extension file written in the worktree was skipped by staging because it is gitignored (e.g. `git status --porcelain --ignored=matching` or `git check-ignore` over written paths)
- [ ] #6 A gate builds and typechecks from a clean tree (`git archive HEAD` or a fresh clone of the mission branch) rather than the mission worktree, and would have failed on commit c96628bea
- [ ] #7 Regression test: adding a new file under a nested `lib/` directory is staged normally, and a deliberately gitignored new source file trips the commit-time guard
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 Verification gate ran and passed on the final tree with captured proof rather than an unverified claim
- [ ] #2 Lint and static analysis report clean on every changed file
- [ ] #3 No focused or unannotated skipped tests were introduced (no .only and no bare .skip)
- [ ] #4 Final checkpoint Goal Check table cites real evidence using file:line references and test names
- [ ] #5 Docs updated to reflect any workflow or user-facing behavior change
- [ ] #6 Bug-labeled missions include a red-to-green reproduction test that fails before the fix and passes after
<!-- DOD:END -->
