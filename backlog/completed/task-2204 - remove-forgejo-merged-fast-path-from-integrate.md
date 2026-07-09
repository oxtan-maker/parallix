---
id: TASK-2204
title: remove forgejo merged fast path from integrate
status: done
assignee: [codex]
created_date: '2026-07-07 20:23'
updated_date: '2026-07-07 20:23'
labels: [ai_sdlc, bug]
dependencies: []
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
`px integrate` still has a Variant A fast path selected by `context.pr.merged`, meaning a PR already merged on Forgejo is treated as an acceptable integration state and closeout proceeds from the mirrored Forgejo result instead of the local/base-branch squash path.

Forgejo is a diff viewer — it is never merged to main and gets overwritten by new missions each time. The honest merge position is determined solely by local/remote branch state; ForgeJo state is irrelevant.

Fix the integration contract so ForgeJo merge state is never consulted when computing the honest merge position. `px integrate` should use a single local-authority merge/closeout path based solely on local/remote branch state.
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
