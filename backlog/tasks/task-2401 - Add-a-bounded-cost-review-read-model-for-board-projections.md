---
id: TASK-2401
title: Add a bounded-cost review read model for board projections
status: active
assignee: [codex]
created_date: '2026-08-23 07:24'
labels: [user_value]
dependencies: []
ordinal: 111917
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

The board currently treats the checked Mission aggregate as a polling read model. For every mission, `BoardProjectionBuilder` separately asks for `loadReview()` and `loadReviewApproval()`. In production both calls can load the same Mission aggregate independently.

`SqliteMissionStore.load()` is intentionally a rich checked aggregate load: it hydrates the Mission root and many related collections and serializes aggregate operations to preserve consistency. Keep that behavior. It is appropriate for domain operations but is the wrong primitive for rebuilding a board every few seconds.

Create a projection-oriented SQLite review read path that obtains all review information needed by the board for a set of missions in a bounded number of queries rather than loading a complete Mission aggregate twice per mission.

The read model must preserve the board's current semantics, including all data it actually displays or uses for decisions:

- current review round
- review phase
- disposition
- reviewed subject/revision
- approval state and approved revision
- PR/local-change reference
- reviewer and implementer
- review history required by MissionCard
- findings/resolutions/events required to render that history
- integration-command eligibility derived from approval of the same reviewed revision

Prefer batch reads followed by in-memory grouping/hydration. Query count for a normal board build must not grow approximately as `MissionStore.load × mission count`. For mission sets within SQLite's normal bind limits, review projection query count should be bounded by the number of required relational projections, not the number of missions.

Do not weaken or bypass `SqliteMissionStore` consistency guarantees. Do not remove its operation queue. Do not turn the checked aggregate into a partial aggregate. Do not introduce a second review authority or copy review state into another durable table merely for performance.

The board projection should consume the purpose-built read model; command/domain paths which genuinely need the Mission aggregate should continue using the Mission store.

Add query-count regression tests using an injectable/counting database seam or equivalent deterministic evidence. A test with many missions must prove that review query count does not scale linearly by repeatedly hydrating full aggregates.

Do not optimize SQLite PRAGMAs, move SQLite to worker threads, add a prepared-statement cache or introduce generic caching as a substitute for fixing the read shape.

Keep this mission focused on review projection reads. Do not absorb TASK-2400 filesystem/worktree work, TASK-2402 status targeting, running-agent detection or general performance instrumentation.

<!-- SECTION:DESCRIPTION:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 Verification gate ran and passed on the final tree with captured proof rather than an unverified claim
- [ ] #2 Lint and static analysis report clean on every changed file
- [ ] #3 No focused or unannotated skipped tests were introduced (no .only and no bare .skip)
- [ ] #4 Final checkpoint Goal Check table cites real evidence using file:line references and test names
- [ ] #5 Docs updated to reflect any workflow or user-facing behavior change
- [ ] #6 Bug-labeled missions include a red-to-green reproduction test that fails before the fix and passes after
<!-- DOD:END -->
