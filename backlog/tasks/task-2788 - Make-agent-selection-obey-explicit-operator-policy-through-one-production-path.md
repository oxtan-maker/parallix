---
id: TASK-2788
title: Make agent selection obey explicit operator policy through one production path
status: backlog
assignee: []
created_date: '2026-10-19 09:57'
labels: []
dependencies: []
ordinal: 269008
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Goal:
Remove duplicated agent-selection policy and all invented weight defaults unless they fix a real bug/corner case. The operator authorizes weighting only from the effective configuration; configured zero must remain zero.

Context:
Read ADR 0051's required explicit review policy, ADR 0053, TASK-2294, TASK-2295, TASK-2345, TASK-2351 and TASK-2647. Trace the currently composed callers rather than assuming the prepared selector is live.

Success criteria:

1. Establish one pure selection policy behind the existing application/adapter boundaries and wire the actual review, handoff, active and fallback callers to it. Remove superseded selection algorithms and unused prepared wiring after preserving distinct assertions. Prove actual composition uses the survivor.
2. Unweighted selection remains uniform random. Agent identity, executing/writing agent, array order, history, usage or latency must not create a preference or weights. Preserve explicit operator overrides and required step eligibility, especially review's explicit configured policy.
3. Weighted mode uses only explicit finite nonnegative configuration values. Reject incomplete or invalid weighted configuration instead of inventing weights. A weighted draw never selects a zero-weight family, including at random draw zero; a pool with no available positive weight reports an actionable failure.
4. Reject unknown strategy names instead of selecting the first available family or silently normalizing the strategy. Do not fall back to an unweighted selection when weighted configuration is invalid.
5. Preserve block/availability/admission checks, exclusions, cancellation and legitimate runtime fallback. Keep TASK-2345 override precedence and the synchronous snapshot boundary; coordinate changes to that shared boundary with F11.
6. Use deterministic tests through real production entry points for unweighted selection, configured weights, zero, missing/invalid weights and strategies, overrides and unavailable candidates. Retain the focused zero-weight regression and remove redundant tests. Keep telemetry observational and use existing verification.
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
