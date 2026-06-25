---
id: TASK-1349
title: >-
  px review --push must sync primary baseline on the existing-PR path, not only
  at PR creation
status: backlog
assignee: []
created_date: '2026-06-25 21:27'
labels:
  - ai_sdlc
  - bug
  - forgejo
dependencies: []
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
`px review --push` only force-syncs the local primary branch onto Forgejo `main` (`syncPrimaryBaseline`) during pull-request *creation* (`lib/tools/forgejo.js`, the create-PR flow ~line 435). When the PR already exists, `--push` takes the branch-only push path and skips `syncPrimaryBaseline` entirely.

Consequence: if local `main` has advanced or diverged from Forgejo's `review/main` since the PR was opened, the branch is pushed but Forgejo's `main` stays stale. The PR then diffs the mission branch against a stale/divergent base, surfacing hundreds of unrelated files (e.g. task-1325 PR #33 showed ~590 files / a whole backlog restructure) even though the branch's diff against local `main` is just the intended change. This makes review impossible and hides the real diff.

Root cause: baseline sync is wired to PR creation only. Both push paths (create + update-existing) must guarantee Forgejo's primary baseline equals the local authoritative primary before/after pushing the branch. Relates to task-1320 (syncPrimaryBaseline must force-push local primary onto Forgejo main).

Workaround used manually: force-push local `main` -> `review/main` via the authenticated review URL, then re-push the branch.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 px review --push runs syncPrimaryBaseline (force-push local primary -> Forgejo primary) on the existing-PR update path, not only at PR creation
- [ ] #2 After --push on an existing PR, Forgejo's primary branch SHA equals the local authoritative primary SHA
- [ ] #3 Both push paths share a single baseline-sync code path so they cannot drift again
- [ ] #4 A regression test asserts the existing-PR push path triggers syncPrimaryBaseline (e.g. via the gitRunner/push spy) and fails on the current branch-only behavior
- [ ] #5 Verification proof gating from syncPrimaryBaseline is preserved on the new path
<!-- AC:END -->
