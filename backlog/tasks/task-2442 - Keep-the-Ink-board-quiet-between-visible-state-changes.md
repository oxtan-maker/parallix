---
id: TASK-2442
title: Keep the Ink board quiet between visible state changes
status: backlog
assignee: []
created_date: '2026-08-30 00:00'
labels:
  - user_value
  - bug
  - board
  - performance
  - reliability
dependencies: []
priority: high
---

## Description

`px ui` exhausted Node's heap after running for several hours while an agent was usage-blocked for multiple days. The board keeps its two-second polling reconciliation loop, but the raw remaining block duration changes on every poll even when the rendered countdown remains `3d`. That produces a different refresh fingerprint and a full Ink repaint for a frame whose visible content is identical.

Make repaint eligibility reflect visible board state. Keep the existing polling cadence and projection rebuild path as the cross-process reconciliation authority. In particular, do not replace polling with a filesystem watcher, event bus, daemon, database trigger, SSE stream, or a new cache/invalidation system in this task.

The countdown must repaint at the next boundary the operator can see: day changes for day labels, hour changes for hour labels, and minute changes for minute labels. A state change that the agent strip actually renders (availability, family, block reason, live-process evidence, or an expiry becoming available) must still repaint immediately on the next poll. Raw precision may remain in the projection; it must not alone cause a repaint when the rendered text is unchanged.

## Acceptance Criteria

- [ ] #1 With a multi-day blocked agent, consecutive projections whose raw remaining duration differs by the poll interval but render the same countdown produce no second board change notification or Ink content frame.
- [ ] #2 The existing polling loop still invokes its projection build once per scheduled tick even when the visible fingerprint is unchanged; polling remains the reconciliation mechanism for changes made by other `px` processes.
- [ ] #3 Day, hour, and minute countdown display-boundary crossings each produce one update, and an elapsed block changes the rendered availability without waiting for an unrelated state change.
- [ ] #4 Changes to agent availability, displayed block reason, family identity, attributed live-process count, unattributed live-process count, card state, attention state, source status, or current-work state still produce an update on the next poll.
- [ ] #5 The comparison is deterministic and clock-injected in tests. Tests advance a fake scheduler/clock; no real-time sleep, retry loop, enlarged timeout, forced GC, heap-size flag, or environment-specific memory threshold is used as proof.
- [ ] #6 A mounted Ink regression test demonstrates the no-op case through the actual subscription-to-render path, not only a helper-level fingerprint assertion.
- [ ] #7 The board remains truthful: it does not claim a block expired, an agent became available, or a process stopped merely to avoid a repaint.

## Agent-slop guardrails

- Do not replace polling with push, watchers, signals, an event bus, a daemon, database triggers, SSE, WebSockets, or a new invalidation architecture. This mission is display-deduplication only; polling is intentional cross-process reconciliation.
- Do not change the polling interval, skip projection builds, cache task files, cache SQLite query results, truncate history, alter metrics, or optimize unrelated board reads. Those are separate hypotheses and need separate evidence.
- Do not raise `--max-old-space-size`, add a periodic process restart, suppress GC errors, or weaken a memory threshold. Those conceal the repaint defect rather than fixing it.
- Do not compare arbitrary rounded durations that disagree with what `AgentStrip` renders. One display-normalization rule must match the visible day/hour/minute countdown exactly, including zero/expired and indefinite cases.
- Do not import Ink, React, terminal formatting, or process APIs into the application projection layer. Preserve the existing application/TUI boundary; extract a small pure shared formatter only if that is the smallest way to avoid duplicated display semantics.
- Do not delete fingerprint fields or broadly stringify less data just to make the test pass. Preserve refreshes for every state the board displays, especially liveness, current work, source freshness, block reason, and availability transitions.
- Do not make tests pass by disabling the subscription, mounting a static shell, mocking away the listener, or asserting implementation calls instead of observable notifications/frames.
- Do not add dependencies, configuration knobs, feature flags, telemetry pipelines, background workers, or a general-purpose scheduling abstraction.
- Do not touch web-board, lifecycle, agent-launch, persistence schema, or task-document behavior. Keep the diff in the existing board refresh/display seam and its focused tests unless a direct compile boundary requires one adjacent shared pure helper.
- Do not use `any`, type suppression, focused tests, bare skipped tests, snapshots that hide repeated frames, or timing-sensitive sleeps. Unit tests must remain hermetic and complete within the repository's unit-test headroom.

## Definition of Done

- [ ] #1 Focused deterministic subscription and mounted-Ink regressions pass and fail against the pre-fix behavior.
- [ ] #2 `npm test -- --unit-test-headroom` passes for every added or changed unit test.
- [ ] #3 `./scripts/verify-local.sh static-analysis` passes on the final tree.
- [ ] #4 The final checkpoint states explicitly that polling cadence and projection rebuilding were retained, and records evidence for same-label suppression, visible-boundary refresh, elapsed-block refresh, and non-countdown state refresh.
- [ ] #5 Review confirms no new eventing/invalidation architecture, cache, heap-size workaround, restart workaround, dependency, or cross-layer import was introduced.
