---
id: TASK-2773
title: Improve web board layout legibility and interaction design
status: backlog
assignee: []
created_date: '2026-10-18 07:52'
labels:
  - enhancement
dependencies: []
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Turn the 18 October 2026 web-board design review into independently reviewable, production-ready missions. This parent groups the work; execute the numbered children rather than activating the umbrella as an implementation mission.

Sources: [original design review](../docs/task-2773/parallix-design-review.md) and [original indicator SVG](../docs/task-2773/parallix-indicators.svg), preserved unchanged so the review image resolves without Downloads paths.

The review examined e38bec8, not the current tree. In particular, current CheckpointPips already iterates the supplied checkpoint plan. CP suffixes are not completion counts, and current is not completed. The suggested faint replacement still fails 4.5:1 on the card background; require measured contrast rather than copying its hex value. Keep the review's hierarchy and bounded-track/circle distinction while applying these corrections.

## Execution order

Tasks are serialized because board, card, lane and shared styling edits overlap. Each prerequisite must be integrated and done before its successor activates. Every child must be usable independently when integrated; the last child includes the complete browser walkthrough. Refine each child's NEL prediction before activation; split cohesive scope above ADR 0036 limits without weakening coverage.

| Task | Outcome | Depends on |
| --- | --- | --- |
| TASK-2773.01 | Fill the viewport and restore independent lane scrolling | None |
| TASK-2773.02 | Establish shared spacing radius typography and modal color tokens | TASK-2773.01 |
| TASK-2773.03 | Make secondary board text legible with measured contrast | TASK-2773.02 |
| TASK-2773.04 | Replace checkpoint pips with a bounded evidence-backed progress track | TASK-2773.03 |
| TASK-2773.05 | Distinguish review attempt budget and disposition from progress | TASK-2773.04 |
| TASK-2773.06 | Reclaim space from empty in-flight lanes | TASK-2773.05 |
| TASK-2773.07 | Show command outcomes beside the mission that triggered them | TASK-2773.06 |
| TASK-2773.08 | Reduce repeated status text and remove misleading card decoration | TASK-2773.07 |
| TASK-2773.09 | Keep card actions usable and expose selection and click affordances | TASK-2773.08 |
| TASK-2773.10 | Render concise local operation log timestamps and messages | TASK-2773.09 |
| TASK-2773.11 | Bundle the intended fonts and verify the complete board redesign | TASK-2773.10 |

## Shared constraints

Preserve server-owned facts and honest unknown states; do not infer lifecycle progress, review approval, or gate success in the client. Preserve done-rail disclosure, reduced-motion support, red blocked/failed borders, and explicit two-stage cancellation. Keep ports/adapters and composition boundaries intact. Do not change verification gates or retry budgets.

Before implementation, revalidate this historical review against the active tree. Read ADR 0057 before selecting tests; extend the owning behavior suite. Use focused checks, retain a parent-red/fix-green reproduction for bug-labeled work, and manually exercise the affected behavior in a browser using isolated fixtures without mutating operator missions or statistics. New or changed integration tests must finish within 3.5 seconds; unit cases must meet the 500 ms headroom requirement. Respect production/test source caps. Update live documentation only where user-facing behavior needs explanation.

This wave authors backlog work only. It does not start missions, alter the operator database, change gates or publish branches.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 All eleven children are done and integrated in dependency order.
- [ ] #2 Every review finding is addressed by a child, with historical inaccuracies corrected against executable authority.
- [ ] #3 Final isolated browser E2E evidence covers the complete redesign and preserves the protected operational behaviors.
<!-- AC:END -->
