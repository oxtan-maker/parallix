---
id: TASK-2789
title: Use one expiry decision for persisted agent blocks
status: backlog
assignee: []
created_date: '2026-10-19 09:57'
labels: []
dependencies: []
ordinal: 270008
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Make AgentBlockService and the synchronous selection snapshot interpret the same persisted runtime block consistently. A future ISO expiry currently reports blocked through the service but unblocked through the legacy snapshot consumer.

Context:
Preserve ADRs 0051/0053, TASK-2295's materialized synchronous snapshot, TASK-2322.10's runtime authority and TASK-2345's later explicit local override fix. Preserve subsequent TASK-2724 configuration/probing and TASK-2729 cancellation/fallback behavior.

Success criteria:

1. Reuse one pure interpretation of persisted block state/expiry in the application service and actual synchronous selection path. Remove the competing persisted-expiry interpretation and keep representation conversion at its adapter boundary.
2. Preserve accepted persisted legacy hourly and ISO values without losing precision or timezone meaning. Timed blocks must expire as time advances after snapshot creation; do not freeze a startup decision or turn a timed block into an indefinite block.
3. Preserve explicit local override precedence, including blocked:false clearing a runtime block. Keep the legacy configuration format and writer's deliberate rejection of ISO input; persisted rows and local input retain their appropriate boundary normalization.
4. Extend existing block-service, SQLite operator-state and block-authority tests. With a controlled clock, compare actual service and snapshot-consumer decisions before, at and after expiry; cover indefinite/unblocked states and local overrides. An active persisted block with malformed expiry retains the service's conservative blocked result.
5. Retain the pre-launch block recheck, one async materialization boundary, synchronous hot selection, explicit configuration and bounded probes. Preserve quota detection, TTL/rounding, SIGTERM fallback without persistent blocking and shutdown/cancellation semantics. Follow existing verification and coordinate the shared selection boundary with F10.
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
