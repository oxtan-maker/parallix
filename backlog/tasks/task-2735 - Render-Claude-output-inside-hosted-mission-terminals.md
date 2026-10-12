---
id: TASK-2735
title: Render Claude output inside hosted mission terminals
status: backlog
assignee: []
created_date: '2026-10-12 13:45'
labels:
  - bug
dependencies: []
priority: high
ordinal: 233008
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
TASK-2722 showed raw Claude stream-json records during integration-gate repair. The pasted provider session b558ac51-a8ad-4d83-8d76-96c452fcefcb matches .workflow/run-history/task-2722/execute-claude-a1-mv5awc8g/run.json: started 2026-10-12T13:41:38.433Z, terminalHost=tmux, socket /run/user/1000/parallix-terminal/233bbddb32ac/task-2722.sock. Earlier execute runs used pipe hosting.

Root cause: presentation runs downstream of the terminal being observed. claude.ts launches --output-format stream-json and installs createClaudeRenderSink as spawnAndTee stdoutSink. tmux-host.ts executes the provider directly in its operation pane, then pipe-pane relays those already-displayed raw bytes through a FIFO to the supervisor. spawn-tee.ts invokes the human-readable sink only after that relay. Consequently the supervisor can render readable output while px attach and the live web reader see raw JSON. tmux-terminal-reader.ts selects the active operation pane and returns capture-pane verbatim. Retained console transcript capture also receives pre-rendered pane bytes. The existing recorded-output renderer only applies when the live terminal is unavailable, so it cannot fix this live presentation path.

Fix the output routing so the visible agent pane receives the shared provider presentation while raw provider events remain independently available for telemetry, session IDs and retained run evidence. Preserve typed ports, composition authority, terminal cleanup and explicit raw-stream opt-in. Do not fix only the web view or discard the raw telemetry stream.

Extend the owning Claude stream normalization/launcher and tmux host contract suites; add a focused red-to-green real-tmux reproduction in test/integration/process/tmux-terminal-host.test.ts (classify by ADR 0057 and existing registry). Current host coverage does not prove readable Claude JSONL through attach/live capture. Manual isolated end-to-end verification must cover initial execute and nested integration-gate repair without touching real mission state.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Claude execute and integration-gate repair show readable assistant text and tool activity in px attach and live web output; stream_event and assistant JSON envelopes do not leak by default.
- [ ] #2 Raw provider events remain intact for telemetry, session extraction and retained evidence; explicit raw-stream opt-in continues to work.
- [ ] #3 A focused regression fails on the parent routing and passes with the fix, exercising the real tmux presentation boundary and live pane reader.
- [ ] #4 Manually verify the repaired flow with isolated mission fixtures and cleanup; run focused owning suites and required static analysis.
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 Verification gate ran and passed on the final tree with captured proof rather than an unverified claim
- [ ] #2 Lint and static analysis report clean on every changed file
- [ ] #3 No focused or unannotated skipped tests were introduced (no .only and no bare .skip)
- [ ] #4 Final checkpoint Goal Check table cites real evidence using file:line references and test names
- [ ] #5 Docs updated to reflect any workflow or user-facing behavior change
- [ ] #6 Bug-labeled missions include a red-to-green reproduction test that fails before the fix and passes after
<!-- DOD:END -->
