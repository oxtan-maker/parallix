---
id: TASK-2685
title: Align bug statistics and DONE rail with the shared rolling decision window
status: backlog
assignee: []
created_date: '2026-10-08 04:47'
updated_date: '2026-10-08 04:47'
labels:
  - ai_sdlc
  - bug
dependencies: []
priority: medium
ordinal: 190008
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The default px stats bug trend introduced by TASK-2669 uses full Monday-Sunday UTC ISO weeks, while mission flow, agent performance and board FLOW use rolling seven UTC calendar days. On October 8 the bug report still shows September 28-October 4 (22/81, 27.2%), excluding new deliveries since October 5. Its fourteen-day default span usually contains only one full ISO week, making the advertised three-week average and direction ineffective. The DONE rail separately uses an exact now-minus-168-hours cutoff on administrative closure, which differs from the calendar-day and delivery-completion boundaries used by FLOW.

Align bug reporting and the board DONE rail with the existing shared decision-window definition: current today-6 through today inclusive, previous today-13 through today-7 inclusive, UTC midnight through the last day inclusive. Remove the separate full-ISO-week bug section and its misleading default trend presentation; show bug counts and shares for the same current and previous populations as mission flow. Align DONE retention with calendar-day boundaries and canonical delivery completion so administrative closure cannot shift a mission into a different reporting window. Preserve visibility of unclosed DONE missions needing closeout and handle missing completion evidence explicitly. Reuse existing application authorities and preserve adapter boundaries.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Default px stats shows bug counts and shares for the same current and previous rolling seven-day completion populations as mission flow; the separate full UTC ISO week section is removed.
- [ ] #2 Bug labels remain authoritative Mission labels and additive to classification; empty populations and unavailable history remain distinguishable from observed zero bug share.
- [ ] #3 Bug reporting honors explicit range selection without silently dropping partial calendar weeks; any comparison labels accurately describe the selected periods.
- [ ] #4 DONE retention uses the shared UTC calendar-day boundary convention, defaulting to today-6 through today inclusive, with any configured retention length preserved using the same convention.
- [ ] #5 Closed DONE mission retention is anchored to canonical delivery completion rather than administrative closure; unclosed DONE missions needing closeout remain visible and missing evidence has an explicit tested policy.
- [ ] #6 Focused red-to-green cases in owning suites cover first-day midnight, last-day late completions, previous-window separation, same-day clock changes, new deliveries affecting bug share and delayed administrative closure.
- [ ] #7 Live metric and configuration documentation describes the aligned behavior; focused checks and required static analysis pass, and isolated manual end-to-end verification demonstrates CLI and board behavior without changing real statistics.
- [ ] #8 Reporting-week calculation has one pure domain owner, independent of application and adapter types, with an injected observation instant and UTC normalization; current/previous windows and configured retention use the same calendar-day policy.
- [ ] #9 Mission flow, bug statistics, agent performance, board FLOW and DONE retention consume the domain-owned policy without separate week or cutoff arithmetic; focused domain contract cases cover offset timestamps and calendar/year boundaries.
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Scope clarification from the operator: reporting-week calculation belongs in the domain because independent definitions have already diverged. Establish one domain-owned rolling calendar-day window policy, including current/previous windows, containment and configurable retention boundaries. Inject the observation instant; normalize timestamp instants to UTC before determining day membership. Application services and CLI/web projections consume this policy instead of independently calculating weeks or cutoffs. Domain code must not import application ReportingWindow or other application/adapter types.

Before changing dependency direction or adapter boundaries, follow the repository architecture decision requirement: present measured divergence evidence, alternatives, behavioral risks and the concrete proposed domain contract, then obtain an explicit subsequent operator decision before dependent implementation. This task records the intended domain ownership; it does not bypass that implementation decision step.
<!-- SECTION:NOTES:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 Verification gate ran and passed on the final tree with captured proof rather than an unverified claim
- [ ] #2 Lint and static analysis report clean on every changed file
- [ ] #3 No focused or unannotated skipped tests were introduced (no .only and no bare .skip)
- [ ] #4 Final checkpoint Goal Check table cites real evidence using file:line references and test names
- [ ] #5 Docs updated to reflect any workflow or user-facing behavior change
- [ ] #6 Bug-labeled missions include a red-to-green reproduction test that fails before the fix and passes after
<!-- DOD:END -->
