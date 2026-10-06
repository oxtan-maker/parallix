---
id: TASK-2655
title: 'Fix web-board freshness, snapshot ordering, and live-progress retention'
status: backlog
assignee: []
created_date: '2026-10-06 08:23'
labels: []
dependencies: []
ordinal: 166008
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Make the web board converge to the authoritative server projection without
manual reloads, stale-response rollback, or accidental loss of recent live
progress.

Implement a bounded synchronization fix, not a new state-management framework.

## Context and defects to verify

Reference revision: 09dfbad1dc7fa69a15a6b747cca5e6de2eeeba51.

The reviewed implementation has three connected defects:

1. The host emits SSE `invalidate` events, but Shell handles only `progress`.
   Changes made outside this browser can leave the board indefinitely stale.
   Connection errors and reconnects also lack freshness handling.

2. Progress-triggered and command-triggered snapshot reads apply their results
   independently. A superseded response can replace newer state, including
   replacing a successful snapshot with an obsolete error.

3. Progress events are appended to snapshot.operationLog. A subsequent snapshot
   replacement removes live entries absent from persisted operation history.

Verify these paths on the mission's starting HEAD. The previous review is a
diagnosis, not a substitute for retained regression tests.

## Scope and ownership

Primary production ownership:
- web/src/shell.tsx
- web/src/operation-log.tsx
- A small cohesive synchronization module or hook, only if useful.
- The snapshot-loading portion of web/src/board-data.ts, only if necessary.

Read for existing contracts:
- src/interfaces/web/stream.ts
- src/interfaces/web/host.ts
- src/interfaces/web/transport.ts
- The board projection and persisted operation-log adapter.
- Existing browser tests and applicable web/architecture ADRs.

Do not change:
- Command dispatch or pending-state behavior in board.tsx.
- Host session cookies, authentication, or shell routing.
- Application lifecycle, persistence schemas, or projection authority.
- The Board snapshot/onRefresh public interface unless separately approved.

## Required behavior

### 1. One refresh coordinator

Route initial loading, SSE invalidation, connection opening/reconnection,
progress-triggered refresh, and Board's onRefresh callback through one owner.

Choose the smallest mechanism that guarantees:
- Superseded responses cannot overwrite newer accepted state.
- Superseded errors cannot replace newer successful state.
- An invalidation arriving during a read is not lost.
- Bursts of events are coalesced without starving refresh indefinitely.
- Awaiting onRefresh waits for the relevant requested revalidation to settle;
  it must not return early merely because another request was already active.
- Unmounting invalidates pending work and prevents later state writes.

A single-flight read with a queued dirty flag is acceptable. A generation-based
implementation is also acceptable. Do not add polling alongside working SSE
as a substitute for fixing synchronization.

### 2. Recover freshness through the connection lifecycle

Handle the existing `invalidate`, `progress`, `open`, and `error` events as
appropriate to their actual contracts.

Close the initial snapshot/subscription race. A change occurring between
the first snapshot and the established subscription must not remain invisible.

Re-establish truth with a snapshot after connection opening/reconnection.
Do not depend on complete SSE replay history.

Represent connection/freshness state honestly:
- A disconnect must not leave the board presented as unquestionably current.
- A last validated snapshot may remain visible with an explicit stale or
  reconnecting indication.
- Reconnection alone must not claim successful revalidation before it occurs.
- Preserve the existing distinct handling of malformed and incompatible
  snapshots. Never render an invalid response as valid board data.

Clean up EventSource, listeners, timers, and pending work on unmount.
Do not create parallel reconnect loops around EventSource's own retry behavior.

### 3. Retain bounded live progress independently of snapshots

Keep transient progress separate from replaceable authoritative snapshots.
Merge it for presentation without silently erasing it on ordinary refreshes.

Inspect the actual event identities before choosing a deduplication key:
- Deduplicate replayed events using reliable existing identity.
- Do not collapse distinct events merely because their messages match.
- Deduplicate persisted and streamed entries against each other only where
  a genuine shared identity exists; do not fabricate correlation.
- Bound both retained entries and deduplication metadata.
- Define ordering and reset behavior, including host reconnection/restart.

Do not introduce durable browser storage or persist transient progress on the
server. Do not promise recovery of history that the server no longer retains.

## Required regression tests

Extend the existing owning suites. Exercise imported production behavior;
do not copy Shell's implementation into a test-only simulation.

Use controlled promises, fake timers, and an EventSource boundary double
where appropriate. Include component-level wiring coverage, not only tests
of a new helper.

Prove:

1. An `invalidate` event, without any progress event, causes revalidation and
   displays the changed mission state.
2. The initial subscription race converges without a second external event.
3. Connection failure becomes visible; reconnect triggers revalidation even
   when no progress event is replayed.
4. An invalidation during an active read causes a subsequent authoritative
   read rather than being discarded.
5. Adversarial response ordering cannot roll back accepted state or replace
   it with an obsolete error. For a serial design, prove that the unsafe
   overlap is prevented and the queued refresh still occurs.
6. Command-triggered and SSE-triggered refreshes share the same coordination.
   Awaited refresh callers settle correctly when requests are coalesced.
7. A live progress entry survives a snapshot that does not contain it.
   Replayed entries are deduplicated, distinct repeated text is retained,
   and history/deduplication storage stays bounded.
8. Malformed events and invalid snapshot payloads preserve contract rejection.
9. Unmount/remount does not leak listeners, timers, requests that can commit
   state, or duplicate progress subscriptions.

Retain focused tests that fail on parent behavior and pass with the fix.
The core invalidation, response-ordering, and progress-retention defects each
need explicit before/after evidence.

## Guardrails and verification

Read AGENTS.md, scoped instructions, and ADR 0057 before editing or selecting
tests. Follow current repository instructions when they differ from this
reference revision.

Trace each behavior to its owning suite before adding files. Extend that suite.
New unit suites, only where an owner is absent, must follow the repository's
current mirrored test/unit structure and use contract-based names.

Run focused regressions first, then:
- ./scripts/verify-local.sh static-analysis
- Relevant existing browser build/type checks.
- ./scripts/verify-local.sh docs only if live documentation changed.

Do not repeatedly run npm test or full repository gates. Leave full lifecycle
gates to Parallix unless current repository instructions require otherwise.

No new runtime framework, test stack, model calls, external services, broad
refactor, weakened assertions, or changed verification budgets. Respect file
size caps and ports-and-adapters boundaries.

## Completion evidence

Record in the normal mission checkpoint:
- Starting and final commit identities.
- Each defect's reproduction and retained regression location.
- Exact verification commands and results, including limitations.
- The chosen refresh-ordering and progress-identity rules.
- Evidence of bounded request/history behavior under an event burst.
- Any defect already fixed at starting HEAD, with proof.

Do not treat code inspection or agent prose as passing test evidence.
Do not integrate or push to origin; follow the normal review workflow.
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
