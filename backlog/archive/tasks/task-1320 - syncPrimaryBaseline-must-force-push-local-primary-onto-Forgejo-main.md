---
id: TASK-1320
title: syncPrimaryBaseline must force-push local primary onto Forgejo main
status: backlog
assignee: []
created_date: '2026-06-16 00:00'
updated_date: '2026-06-16 00:00'
labels:
  - user_value
dependencies: []
references:
  - lib/tools/forgejo.js
priority: high
ordinal: 7000
---

## Description

`syncPrimaryBaseline` in `lib/tools/forgejo.js:713-733` does a plain `git push` of the local primary branch to Forgejo's `main`. When multiple agents work in parallel on the same repo, the local `main` frequently diverges from Forgejo's `main`, causing a non-fast-forward rejection:

    [FAIL] ! [rejected] main -> main (non-fast-forward)
    [FAIL] tips: Updates were rejected because the tip of your
    [FAIL] tips: current branch is behind its remote counterpart.

Forgejo is only a review viewer — the local repo is the source of truth. The sync must always overwrite the remote, not attempt fast-forward.

Fix: add `--force` to the push in `syncPrimaryBaseline`:

    git.git(['-C', rootDir, 'push', '--force', remoteUrl, `${primaryBranch}:${primaryBranch}`], ...)

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 syncPrimaryBaseline uses `--force` so parallel agent work on local main never blocks PR creation
- [x] #2 PR creation flow (`createPr`) proceeds even when Forgejo main has diverged from local main
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Fixed by changing the push in lib/tools/forgejo.js:724 from a plain push to `git push --force`. This is safe because Forgejo is only used as a review viewer — the local repo is the authoritative source of truth, and `syncPrimaryBaseline` runs before every PR creation to ensure the review surface is current.
<!-- SECTION:NOTES:END -->
