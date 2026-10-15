---
id: TASK-2763
title: Pin the reviewer-classifier decision model to Jev 1.13
status: done
assignee: [codex]
created_date: '2026-10-15 12:57'
labels:
  - ai_sdlc
  - bug
dependencies: []
priority: high
ordinal: 251008
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Every decision provider route in `src/adapters/decision/provider.ts` requests a moving alias (`jev-latest`, or `typesafe-ai/jev` on Vercel). Between 2026-10-14 14:46Z and 2026-10-15 10:46Z the provider moved that alias from typesafe/jev-1.13-20260917 to typesafe/jev-1.14-20261014, with no change in Parallix. Production telemetry shows 129 answered calls on 1.13 and, since then, only 1.14.

Every classifier threshold in production was calibrated on 1.13: the weakening bar of 0.60, the panel bars, and the px-0010 per-obligation bars. The token-budget tokenizer is also 1.13 (`token-budget.ts`), and `supportsDecisionBudget` does not list any 1.14 name.

px-0010 (`../parallix-research/px-0010/j14/`, README section 19) compared both versions, each pinned, on identical already-used packets, labelled by the general reviewer:
- Integration repair with a gate fact (43 approved, 8 changes-requested): 1.13 clears 24 approved at 0.60, 1.14 clears 12. The best 1.14 bar (0.50) clears 19. Both clear the same single changes-requested round, and neither clears any of 6 synthetic weakenings.
- Integration repair without a gate fact (81 approved, 19 changes-requested): 1.13 clears 35 approved at 0.60, 1.14 clears 32. Both clear the same 4 changes-requested rounds.
- Per obligation (TASK-2753 route): at 0.97, 1.13 clears 11 approved and 1.14 clears 8. Both clear the same 2 changes-requested rounds.

1.14 decides fewer rounds with no safety gain, so production pins 1.13. A later version is adopted only after the same pinned comparison.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Every decision provider route requests a pinned Jev version. OpenRouter and Typesafe request typesafe/jev-1.13-20260917. The Vercel route requests the matching pinned identifier if the gateway offers one; otherwise the task records why it keeps its alias.
- [ ] #2 The pinned version is one named constant. Budget measurement (`supportsDecisionBudget`, `measureDecisionBudget`) accepts it, and a pinned name with no matching tokenizer is refused rather than measured with the wrong tokenizer.
- [ ] #3 The resolved model returned by the provider stays in classifier telemetry, so a provider substitution remains visible.
- [ ] #4 Focused owning-suite tests cover: each provider route sends the pinned model; budget measurement for the pinned name; refusal of an unsupported pinned name.
- [ ] #5 Red-green reproduction: on the parent, a provider route requests the moving alias; with the fix it requests the pinned version.
- [ ] #6 Manual end-to-end check: one real classifier call made by Parallix records typesafe/jev-1.13-20260917 as the model in classifier telemetry.
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

## Provider catalog observation

On 2026-10-15, GET https://ai-gateway.vercel.sh/v1/models returned only
`typesafe-ai/jev` for Jev, with no versioned identifier for the calibrated build.
The Vercel route therefore retains that alias under the mission's explicit
exception; Typesafe and OpenRouter request `typesafe/jev-1.13-20260917`.
The alias does not guarantee the calibrated build; returned model telemetry
remains the authority for substitutions.

## Manual live classifier observation

At 2026-10-15T13:07:19.781Z an isolated shadow invocation of the application
review flow (`tryClassifyReview`, using the existing repeat-review scenario and
`createDecisionPort` with operator OpenRouter credentials and real transport)
recorded classifier decision
`22fc84e43dd2f87e1cc5d2594c785b22ad5e1fa707e39efaaf8946a8eb2d0724`.
Its telemetry row had `model: typesafe/jev-1.13-20260917`; all three panel
members (v3, v1, original) independently retained that same actual model and
configuredModel. Input-token usage was 973, 867, 805 respectively.
The synthetic evidence led to abstention; shadow mode published no verdict.
Telemetry was captured through the application telemetry port in isolated memory
and exported to `/tmp/task-2763-live-telemetry.json`, avoiding production statistics.
This exercised the application review flow and live provider, not the UI or
a production mission lifecycle.
