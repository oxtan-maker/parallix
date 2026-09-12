---
id: TASK-2492
title: Auto-bounce integration gate failures to the implementer instead of hard-aborting
status: done
assignee: [codex]
created_date: '2026-09-11 12:30'
labels:
  - ai_sdlc
dependencies: []
references:
  - src/adapters/cli/commands/integrate.ts
  - src/adapters/cli/commands/integrate-gates.ts
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
`px integrate` has no rebound path for a failed integration gate. When
`runPhaseGates('integration', …)` returns `!result.ok`, `integrate.ts` logs
`Integration gates failed for <slug>` and throws `IntegrationAbort`
(src/adapters/cli/commands/integrate.ts, the `else if (!result.ok)` branch).
The mission stays in `ready-for-integration` with an approved review and a red
gate, and a human has to notice, diagnose, and drive the fix by hand.

The squash-commit hook failure path right beside it already does the right
thing: it classifies the failure and routes it through the rebound kernel,
transitioning the task back to `active` with a fix prompt
(`transitionToImplementer` in the same file). Integration gates should reuse
that same kernel rather than dead-ending.

Observed on TASK-2483: review approved in round 2, default verification gate
green (2513/2513), but the integration-suite gate failed on
`test/review-identity-placeholder.test.ts:20`, which pinned the exact review
prompt sentence the mission deliberately removed. The failure is a genuine
mission regression the implementer could have fixed in one line — but nothing
bounced it back, so the mission simply sat blocked until a human intervened.

Secondary cause worth covering in the same mission: the assertion lives in a
test that the default suite does not run, so the mission's own verification
gate could be green while an integration-only test was red. Either surface
which suites a mission's gate did *not* cover, or make the bounce prompt say
plainly that the failing test is integration-only.

Scope:
- Route a failed integration gate through the existing rebound kernel:
  transition the task back to `active`, capture the gate output as the fix
  prompt, and relaunch the implementer, exactly as the squash-commit hook
  bounce does.
- Keep genuine blocks non-bouncing: a gate failure that reproduces on `main`
  is a main problem, and per the team-lead policy it must become its own
  backlog ticket rather than an implementer bounce loop.
- Bound the retries so a persistently red gate escalates to a human instead
  of looping.
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
