---
id: TASK-2651
title: Integrate-gate rebound fallback must persist the live current round, not a stale snapshot round
status: done
assignee: [codex]
created_date: '2026-10-05 06:10'
labels:
  - bug
  - systemic
dependencies:
  - TASK-2642
priority: high
ordinal: 162008
---

## Description

Systemic latent bug in the `px integrate` failure-repair path. When an
integration gate fails and a repair relaunches an agent that falls back to a
different model family, the identity write is rejected and dropped.

Trigger chain: `px integrate` gate fails -> `rebound` repair -> `launchFixAttempt`
-> the launched agent hits a model limit and falls back (for example
`custom -> claude`) -> `applyAgentFallback` persists the review-state snapshot.

The snapshot the integration context hands to the fallback is `context.reviewState`,
read once at context-build time (`src/application/integrate/context.ts`). It carries
the round the mission had when the context was built. The rebound repair then
advances the live review aggregate to a new current round (for example 8). The
stale snapshot still carries its original round (for example 7). Persisting a
round lower than the aggregate's current round trips the TASK-2385
stale-flattened-write guard in
`src/adapters/review/review-state-mapping.ts`:

    Cannot apply review state: supplied round 7 is lower than the current round 8;
    a stale flattened write must not renumber an existing round

The guard is correct and desirable: before TASK-2385 the same stale write fell
through to `roundFromState`, rewrote the newest round downward, and failed the
SQLite round-uniqueness constraint, silently dropping the verdict. TASK-2385 made
it loud instead of silent. The latent bug is the stale snapshot, not the guard.

Scope: this affects any mission that reaches the `px integrate` rebound repair and
experiences a mid-repair agent model fallback. The ordinary review-loop fallback
(`src/application/review-loop/round.ts` `adoptLaunchedAgent`) uses the live loop
`context.state` and is not affected. Keep the fix in the application layer; do
not import from `src/adapters/review` (ADR 0037).

## Acceptance Criteria
- [ ] #1 A unit regression reproduces an integration-gate rebound where the repair advanced the live aggregate to a higher round than the context-build snapshot; the state handed to the fallback carries the live current round and the repair identity persists.
- [ ] #2 When no live review aggregate is available, the snapshot is passed through unchanged (no invented round).
- [ ] #3 The TASK-2385 stale-flattened-write guard stays in place and still rejects a genuinely stale lower round from any other writer.
- [ ] #4 No application file imports from `src/adapters/review` to perform the alignment (ADR 0037).
- [ ] #5 Live documentation notes the integrate-gate rebound round-alignment behavior where review-state persistence is documented.

## Definition of Done
- [ ] #1 Verification gate ran and passed on the final tree with captured proof rather than an unverified claim
- [ ] #2 Lint and static analysis report clean on every changed file
- [ ] #3 No focused or unannotated skipped tests were introduced (no .only and no bare .skip)
- [ ] #4 Final checkpoint Goal Check table cites real evidence using file:line references and test names
- [ ] #5 Docs updated to reflect any workflow or user-facing behavior change
- [ ] #6 Bug-labeled missions include a red-to-green reproduction test that fails before the fix and passes after
