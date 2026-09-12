---
id: TASK-2498
title: card shows implementer as the live agent while a review runs code before launching the reviewer
status: backlog
assignee: []
created_date: '2026-09-12 10:35'
labels:
  - bug
dependencies: []
---

## Description

The board's running-agent count and the per-card agent pill disagree, and the
card can show the wrong family.

`px review --continue` publishes a `review/running` current-work fact with
`agent: null` for the code-run phase, then the review loop publishes
`review/running/agent=<family>` once the reviewer launches
(`src/application/review-command-use-case.ts` brackets the operation with
`agent: null`; `reviewLoopPublisher` publishes the family). The newest event
wins, so the card's live agent is whatever the latest fact names.

Two defects follow:

1. The card shows the implementer (`custom`) as the active agent during the
   null-agent code-run phase. `web/src/flight-column.tsx` used
   `const agent = liveAgent ?? card.agent`, so a null live agent fell back to
   the mission assignee. The assignee is who owns the mission, not who is
   running, so the implementer was mistaken for the live agent.
2. The running-agent count reports 0 for every family while the null-agent
   bracket is the newest fact. `loadRunningSessions` attributes a session to a
   family from the reconciled current-work agent only for `px review`
   (`AGENT_COMMAND_ROLES['review'] === null`, so the session-marker path does
   not apply), so an unattributed session lands in the unattributed count
   instead of a family.

Reproduced on the operator DB: the live `px review --continue` for
task-2495 had three consecutive current-work facts — `review/running/null`,
`review/running/claude`, `review-response/running/custom` — so the reported
family flipped with whichever event was newest, and the card showed `custom`
via the assignee fallback even while code was running before the reviewer.

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 Verification gate ran and passed on the final tree with captured proof rather than an unverified claim
- [ ] #2 Lint and static analysis report clean on every changed file
- [ ] #3 No focused or unannotated skipped tests were introduced (no .only and no bare .skip)
- [ ] #4 Final checkpoint Goal Check table cites real evidence using file:line references and test names
- [ ] #5 Docs updated to reflect any workflow or user-facing behavior change
- [ ] #6 Bug-labeled missions include a red-to-green reproduction test that fails before the fix and passes after
<!-- DOD:END -->
