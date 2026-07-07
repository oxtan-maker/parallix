---
id: TASK-2203
title: integrate captures publish proof before post-integrate build refresh
status: backlog
assignee: []
created_date: '2026-07-07 19:47'
updated_date: '2026-07-07 19:47'
labels: [ai_sdlc, bug]
dependencies: []
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Reproduced while integrating task-2200 on July 7, 2026: variant B landed the squash commit in `/home/magnus/code/parallix`, then aborted with `Could not verify the exact tree being published` because `lib/commands/integrate.ts` and `lib/commands/mission-start.ts` were newer than their compiled `.js` siblings.

The repo already has a post-integrate hook (`scripts/refresh-global-px.sh`) that runs `npm run build:cjs`, but variant B calls that hook only after it captures and re-checks the publish proof. That ordering makes the rebuild too late to satisfy the freshness guard, so any mission that changes tracked `lib/*.ts` can leave `main` integrated-but-failed until someone manually runs `npm run build:cjs` in the primary checkout.

Fix the integrate/self-hosting flow so this state cannot occur again. Acceptable directions include moving the required build refresh before proof capture for self-hosting repos, making the publish-proof step run against a freshly rebuilt tree, or otherwise guaranteeing that variant B never verifies a tree with stale tracked runtime artifacts.
<!-- SECTION:DESCRIPTION:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 A deterministic regression test reproduces the task-2200 failure mode where variant B lands a mission that changes tracked `lib/*.ts` files and currently fails publish-proof freshness before the post-integrate hook can rebuild.
- [ ] #2 The integrate flow no longer leaves `main` in a partially closed state that requires a manual `npm run build:cjs` after a successful squash commit.
- [ ] #3 The chosen fix preserves the exact-tree publish proof contract rather than bypassing freshness with `PARALLIX_SKIP_BUILD_CHECK=1`.
- [ ] #4 Verification gate ran and passed on the final tree with captured proof rather than an unverified claim.
- [ ] #5 Lint and static analysis report clean on every changed file.
- [ ] #6 No focused or unannotated skipped tests were introduced (no `.only` and no bare `.skip`).
<!-- DOD:END -->
