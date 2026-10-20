---
id: TASK-2781
title: Reuse serial cancellable polling for the live mission pane
status: backlog
assignee: []
created_date: '2026-10-19 09:54'
labels: []
dependencies: []
ordinal: 262008
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Replace LivePane's duplicate interval loop in web/src/mission-history.tsx with the existing polling owner. Live reads must remain serial and stop when the pane closes or its mission changes.

Context:
Preserve ADR 0064 and TASK-2749's retained-history contract, ADR 0051's application boundary and ADR 0055's typed transport. The optional live view must remain separate from retained history.

Success criteria:

1. LivePane uses the existing polling mechanism, with at most one outstanding live read per pane and an AbortSignal passed to loadLive. Remove its competing timer implementation.
2. Closing the pane, changing mission or unmounting cancels the owned read and prevents late responses from changing the new view. Continued refresh works after a completed read or recoverable failure.
3. Preserve bounded reads, typed probe errors, retained output, incremental updates and the existing polling cadence. Preserve history paging, search, copy and paused scrollback.
4. Extend the owning history tests with controlled delayed responses and cancellation, proving the existing overlap before the fix and serial behavior afterward. Manually inspect the live/history view using disposable data, following current verification instructions.
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
