---
id: TASK-2705
title: >-
  Fix web button reachability across board states and recurring backlog Cancel
  misclick
status: done
assignee: [codex]
created_date: '2026-10-09 18:36'
labels:
  - bug
  - web
dependencies: []
priority: high
ordinal: 207008
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
User reports repeated regression after at least two previous missions: clicking Cancel on a backlog card in the web UI behaves as a card click instead of activating the button. Inventory and repair control reachability across the web states, with real browser evidence before declaring this fixed.

Evidence inventory (source audit, 2026-10-09)

1. REPORTED, browser root cause unconfirmed: backlog Cancel opens/selects the card instead of showing cancellation confirmation. Repro: open web board, locate an unselected backlog mission, click the visible Cancel button with a physical pointer. Expected: confirmation for that mission, no terminal/card activation and no cancellation request until confirmation. Record browser, served asset version, viewport, pointer coordinates and event targets. Current Board.selectTerminal explicitly excludes button/a/[role=button] targets (web/src/board.tsx:175); do not assume missing stopPropagation is the cause. Investigate actual hit target, drag interception, DOM changes between pointerdown/up, refresh races and whether the running host serves the audited bundle.

2. CONFIRMED coverage gap: test/unit/interfaces/web/web-board-interaction.cases.ts:158 uses happy-dom, manually dispatches mousedown and calls button.click(); it checks refined and active only, not backlog, review or integration. This bypasses layout, coordinate hit testing, native drag, touch and real browser focus/default-event sequencing. References TASK-2553 in that test and completed TASK-2657 (pending/silent action repairs). Neither is proof that the reported physical click works.

3. CONFIRMED action reachability defect: IntakeCard and FlightCard primaryAction render only the first enabled non-cancel action plus Cancel (web/src/intake-column.tsx:14, web/src/flight-column.tsx:165). availableBoardCommands in src/application/projections/mission-board.ts:332 can enable multiple commands simultaneously. Examples: stranded active with checkpoint evidence offers active + handoff; approved active can offer active/handoff + integrate; review fixing offers active + review; approved review offers review + integrate. Later enabled actions have no card control. Audit attention-rail coverage; it presents only one ranked action and cannot be assumed to expose every omitted command. Provide an explicit reachable way to invoke every enabled server-projected action.

4. CONFIRMED discoverability/focus gap: cancellation confirmation is an ordinary section appended below the board (web/src/board.tsx:226), without focus transfer or scrolling into view. On a tall/scrolled board the button can appear to do nothing even when its handler ran. Verify actual visibility in browsers; make confirmation and unavailable/pending feedback perceivable and keyboard reachable. Keep cancellation a separate explicit confirmation and revalidate the latest projection before sending.

5. AUDIT RISK, not a reproduced bug: intake/flight articles are draggable while child ActionButton prevents mousedown default but does not independently guard native drag initiation; article onFocus changes selection. Board keyboard arrows also operate for descendant controls. Exercise real pointer, touch, keyboard and small pointer movement, including an initially unselected card and refresh between press/release. Establish evidence before choosing a fix.

State/control audit matrix

- Lanes: backlog (draft + cancel), refined (active + cancel), active (resume/handoff/integrate where projected + cancel), review (resume/review/integrate where projected + cancel), integration (integrate + cancel), done (history disclosure; cancellation unavailable).
- Work/action state: idle, starting, working, gate failure, orphaned/stale work, enabled/unavailable, another command pending on same mission, unrelated mission pending, conflict/error/retry, card/action removed or lane changed during refresh.
- Connection: ready, reconnecting, revalidating, refresh failed with retained snapshot; loading/request-failed/malformed/incompatible screens should expose no phantom board actions.
- Surfaces: intake/flight action footers, attention Run, checkpoint evidence toggle/selectors/close, terminal close, cancellation confirm/keep, create mission/open/submit/cancel and dependency selector, flow toggle, shipped disclosure, PR links where rendered.
- Interaction/layout: selected/unselected, mouse/touch/Enter/Space/Tab, genuine coordinate clicks, slight pointer movement, horizontal/vertical scroll, narrow viewport/zoom, open checkpoint/terminal/create overlays, SSE refresh between pointerdown/up. Overlay-background clicks should dismiss only the intended overlay; controls must not fall through to a card or another overlay.

This ticket records a source audit and the user's reproduction, not a completed browser reproduction. No production mission was cancelled, no live database modified, and no implementation change made. Use isolated fixtures and intercepted commands for destructive paths.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Reproduce the reported backlog Cancel failure with a real browser pointer against identified served assets; retain a focused regression red on parent behavior and green with the repair. Record the actual cause, not an assumed event-bubbling explanation.
- [ ] #2 Complete the state/control matrix in the description and record pass/fail/not-applicable with evidence; distinguish reproduced defects from risks and fix discovered reachability failures.
- [ ] #3 Enabled controls invoke their intended action exactly once without terminal/card activation, unintended drag or overlay fallthrough; unavailable/pending controls explain why and send no request.
- [ ] #4 Every enabled server-projected command is reachable, including simultaneous resume/handoff/review/integrate actions; preserve server authority and typed adapter boundaries.
- [ ] #5 Cancel visibly exposes a keyboard-reachable confirmation for the correct mission; Keep sends nothing, explicit confirmation sends at most one request, and refreshed unavailable actions are rejected with visible feedback.
- [ ] #6 Extend the owning web interaction and mission cancellation suites; retain meaningful real-browser coordinate coverage for backlog/refined/active/review/integration and refresh races. Classify any new boundary suite per ADR 0057 and the category registry.
- [ ] #7 Manually exercise the repaired web flow end to end using isolated disposable missions, including unselected backlog Cancel and simultaneous actions; run focused checks and required static-analysis without mutating real operator data.
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
