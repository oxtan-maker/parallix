---
id: TASK-2204
title: remove forgejo merged fast path from integrate
status: backlog
assignee: []
created_date: '2026-07-07 20:23'
updated_date: '2026-07-07 20:23'
labels: [ai_sdlc, bug]
dependencies: []
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
`px integrate` still has a Variant A fast path selected by `context.pr.merged`, meaning a PR already merged on Forgejo is treated as an acceptable integration state and closeout proceeds from the mirrored Forgejo result instead of the local/base-branch squash path.

That behavior conflicts with this repo's actual model: Forgejo is a review/publication surface, while the authoritative integration target is the local base branch (`main`/`master` or a recorded feature base). A merge performed on Forgejo is therefore an out-of-band mutation of the mirrored base branch, not a normal workflow state that integrate should optimize for.

Fix the integration contract so Forgejo merge state is never used as authority for landing a mission. `px integrate` should use a single local-authority merge/closeout path, and a Forgejo PR already marked merged should either fail preflight with explicit recovery guidance or otherwise be treated as an invalid mirror-drift condition rather than a valid fast path.
<!-- SECTION:DESCRIPTION:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 `integrate.ts` no longer selects a separate success path solely because `context.pr.merged === true`.
- [ ] #2 A deterministic regression test proves that a Forgejo PR already marked merged does not trigger local closeout success and instead fails with explicit operator-facing recovery guidance.
- [ ] #3 Integration still supports both trunk-based and feature-base missions, but always lands through the same local/base-worktree authority path.
- [ ] #4 Docs and tests that currently describe Variant A are updated to match the new contract.
- [ ] #5 Verification gate ran and passed on the final tree with captured proof rather than an unverified claim.
- [ ] #6 No focused or unannotated skipped tests were introduced (no `.only` and no bare `.skip`).
<!-- DOD:END -->
