---
id: TASK-2754
title: Ask the weakening question on integration repairs without a recorded gate re-run
status: backlog
assignee: []
created_date: '2026-10-15 11:00'
labels:
  - ai_sdlc
dependencies:
  - TASK-2751
priority: medium
ordinal: 244008
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The integration-repair weakening path (v4, then V5) asks the classifier only when `admitGateFact` (`gate-fact.ts`) finds a green re-run of the failed gate recorded before the round started. Otherwise the round goes to the general reviewer as `weakening-no-fact`, `weakening-fact-after-round-start`, `weakening-gate-not-validated` or `weakening-code-after-validated-sha`. Of the 25 integration repairs decided after 2026-10-12T16:00, 11 went to the reviewer for these reasons alone.

The fact is not needed for safety relative to the general reviewer. Neither the reviewer nor the classifier runs the gate, and `px integrate` re-runs every pre-integration gate before landing and refuses on failure. The weakening question already tells the classifier not to judge whether the failure is fixed.

px-0010 (`../parallix-research/px-0010/nf/`, README section 18) tested this on 137 integration repairs that the general reviewer decided between 2026-10-01 and 2026-10-15:
- **Packet.** Production `buildWeakeningPacket` from main, with the validation fact replaced by the integration guarantee.
- **Questions.** Production v4 and V5, changed in one sentence only.
- **Split by mission.** Dev, test, validation-1, and a validation-2 that is still unused.
- **Rule.** Frozen after dev: v4, then V5, clear at preserves >= 0.60.

Results:

| Split | Approved cleared | Changes-requested cleared | Repair at fault |
|---|---:|---:|---:|
| dev | 11 / 30 | 1 / 7 | 0 |
| test | 9 / 25 | 0 / 5 | 0 |
| validation-1 | 12 / 26 | 3 / 7 | 0 |

- **Rounds with no recorded re-run.** 17 of 52 approved rounds cleared; today none of them can clear.
- **The four changes-requested clears.** All four concern findings outside the repair:
  - task-2668.05 r5: docs were already missing at the approved revision.
  - task-2706 r3: pre-existing migration defects. Production clears this round today, with the fact.
  - task-2722 r7 and r9: the repair checkpoint dropped earlier Goal Check rows. TASK-2755 removes this cause.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 An integration repair with a substantive repair diff is asked the weakening question whether or not a gate fact is admitted. The no-fact, fact-after-round-start, gate-not-validated, code-after-validated-sha and relation-unavailable rejections no longer route to the reviewer on their own.
- [ ] #2 With an admitted fact, the packet keeps today's fact and question text. Without one, the packet states that the failed gate was not re-run before review and that integration re-runs every gate and refuses integration on failure. The question replaces only the fact sentence with: "The failed gate has not been re-run at this revision yet; Parallix re-runs it and every other integration gate before the mission can integrate and refuses integration if any fails (validation.failedIntegrationGateRerun). Do not judge whether the failure is fixed." It also reads "Decide whether the repair preserves" instead of "Decide whether the repair made the gate pass while preserving". Everything else stays verbatim (`nf/questions.mts`).
- [ ] #3 The routing is unchanged: v4 first, V5 only when v4 does not clear, clear at preserves >= 0.60, and the reviewer decides otherwise. A clear without a fact still leads to the normal pre-integration gates.
- [ ] #4 Packet baselines are the main commits each revision was actually built on. Production must not reproduce the research flaw of a merge-base with a rewritten main.
- [ ] #5 Telemetry records whether a fact was admitted. Prompt and packet versions change, and `px stats` splits weakening clears into with-fact and without-fact.
- [ ] #6 Focused owning-suite tests cover: a no-fact round being asked and cleared at the threshold; the no-fact packet and question text; an admitted-fact round unchanged; and an empty repair diff still going to the reviewer.
- [ ] #7 Manual end-to-end check on a real integration repair without a recorded re-run shows the question asked, the stored probabilities and the route.
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
