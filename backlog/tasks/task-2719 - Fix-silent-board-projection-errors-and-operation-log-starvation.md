---
id: TASK-2719
title: Fix silent board projection errors and operation-log starvation
status: backlog
assignee: []
created_date: '2026-10-10 15:38'
labels: []
dependencies: []
ordinal: 219008
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Objective
Keep the board honest about failed projection updates and ensure older live progress cannot hide newer persisted operation history. This is a focused correction to the existing synchronization/log design, not a board rewrite.
Confirmed defects
Reviewed at 4d459cbbfd27ab5a880964542bd4bdfb55a776a2; check the current implementation before editing and retain regression coverage if either defect is already fixed.
1. In web/src/board-sync.ts, onError discards data-bearing server SSE errors after observing their event ID. A valid event: error frame with {transportVersion: 1, kind: "stream-error", error: {kind: "unavailable", message: "database is locked"}} leaves a previously loaded board open, revalidated: true, and refreshError: null, without requesting revalidation.
2. In web/src/operation-log.tsx, withLiveProgress appends unmatched live entries after the persisted snapshot and then takes the last 256 entries. With 256 older live entries, even a newer persisted completion disappears. This is 256 log entries accumulated in a tab, not 256 simultaneous missions. Persisted entries currently lack the live sequence identity, so they do not reliably absorb corresponding live entries.
The existing parallix-incoming-main-recheck.zip reproduces both defects against production helpers/hook code. Its two defect assertions deliberately assert buggy behavior; do not mistake its successful exit for a passing regression test.
Required behavior
Validate and surface server projection-error frames while retaining the last good board visibly stale. Distinguish this from a native EventSource disconnect. Recover through the existing serial/coalescing refresh coordinator: only a successful, non-superseded read that began after the failure may clear that failure state. Repeated error frames must not create an immediate retry loop or an unbounded read queue. Preserve reconnect handling, awaited refresh semantics, and disposal behavior; use existing transport validators or extend them minimally rather than accepting arbitrary error payloads.
Fix live/persisted reconciliation so newer persisted entries remain visible when live history is saturated, while genuinely new live progress still survives a snapshot that has not caught up. Preserve the 256-entry display bound and stable event identity/replay deduplication; do not deduplicate by message text, enlarge the limit to hide the bug, simply clear live history on every refresh, or invent chronology from incomparable per-operation sequences. Use the smallest coherent ordering/identity correction supported by the existing producer and transport; document any unavoidable legacy ambiguity without presenting guessed order as authoritative.
Verification and completion
Extend the existing focused tests for: a valid server error after a good board; a pre-error read completing late; bounded recovery after repeated errors; malformed errors and native disconnects; saturated old live progress plus a newer durable completion; unmatched recent live progress; replayed events versus distinct events with identical text. Retain the already-fixed serial/coalesced refresh and live-progress behavior.
Exercise the changed behavior through the running application's public interface and record what was actually observed, using existing tools without adding an E2E suite. Run only relevant checks during iteration and the repository's required gates once at the prescribed lifecycle point; do not repeatedly run the entire suite or paid agents. Finish with the exact changes, focused test results, public-interface observation, and any remaining limitation. Do not claim browser verification from the hook-only reproduction harness.
Out of scope: activation concurrency, tmux sessions/history, lifecycle redesign, dependencies, and unrelated UI cleanup.
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
