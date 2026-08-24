---
id: TASK-2412
title: Make all rebounce prompts unambiguous
status: refined
assignee: []
created_date: '2026-08-24'
labels:
  - bug
  - ai_sdlc
dependencies:
  - task-2377
references:
  - src/application/rebound-kernel.ts
  - src/application/failure-classification.ts
priority: high
ordinal: 109204
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
task-2373.01 stranded after two relaunch attempts. The root cause is not code:
on a low-load run `./scripts/verify-local.sh all` exits 0 (2155 pass, 0 fail).
The gate is probabilistically flaky under host oversubscription — CPU-bound
hermetic tests sit at 1031–1131ms against a 1000ms per-test budget and get
descheduled past it when the shared 16-core host is loaded by other tenants.
The mission died because the rebounce prompt gave no way to tell a code defect
from an environmental one, and the classifier routed the failure to the wrong
action.

Two concrete defects produce an unactionable bounce:

1. **The fix prompt has no first-step diagnostic and a generic remedy.** The
   gate/handoff prompt says only "Fix the underlying issue so the verification
   gate passes". When the failure is host-oversubscription flakiness there is no
   code to fix, so the implementer chases nonexistent bugs, kills processes,
   retries, and exhausts its 2-attempt budget. No prompt tells the implementer
   to run the failing command at low host load and compare.

2. **The classifier lets a generic gate pattern shadow the infra pattern.** In
   `src/application/failure-classification.ts` rule 4 (`/verification gate
   failed/i` → `GateFailure` / `AutoSendBack`) is checked before rule 11
   (`forgejo` / rate-limit / connection → `InfraBlocker` / `HumanOnly`). A gate
   failure whose output names an infra cause — e.g.
   "Forgejo PR creation/update failed: verification gate failed …" — is
   classified `GateFailure` / `AutoSendBack` and bounced as a code fix, even
   though the remedy lies outside the working tree. The infra pattern never
   gets a chance to match.

3. **Host-oversubscription / budget-exceeded failures are not recognised.** The
   npm-test diagnostic carries `budget-exceeded` and `timeout=1000ms per test`
   markers. No rule recognises these as environmental, so the prompt offers no
   "retry at low load, not a code defect" path.

Fix so every rebounce prompt: (a) states one concrete first diagnostic step
that distinguishes a code defect from an environmental failure, and (b) routes
infra-caused and host-oversubscription gate failures to a remedy that says so
explicitly instead of sending the implementer after code that is not broken.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 `classifyError("Forgejo PR creation/update failed: verification gate failed for /x with exit code 1")` returns `InfraBlocker` / `HumanOnly`, not `GateFailure` / `AutoSendBack`. The infra patterns are matched before the generic "verification gate failed" pattern (verified by a test that pins the ordering, not by a line number).
- [ ] #2 A gate diagnostic containing a host-oversubscription marker (`budget-exceeded`, `timeout=…ms per test`, or `cancelled test`) is recognised as environmental: the classify path returns `InfraBlocker` / `HumanOnly`, or the fix prompt for a `GateFailure` carries an explicit "retry at low host load; this is not a code defect" remedy. Document which in the checkpoint.
- [ ] #3 Every rebound fix prompt (gate, hook, artifact-incomplete, agent-timeout, handoff-verification) contains a one-line first-diagnostic step that tells the implementer how to tell a code defect from an environmental failure — run the failing command at low host load and compare. No prompt relies solely on the generic "fix the underlying issue" remedy.
- [ ] #4 The context-compaction boilerplate in `buildReboundFixPrompt` is unchanged in intent; the new diagnostic guidance is added without duplicating the single prompt builder.
- [ ] #5 `./scripts/verify-local.sh docs` exits 0; `docs/agents.md` "Pre-review bounce policy" states the new first-diagnostic guidance and the infra/oversubscription routing.
- [ ] #6 `npm test` runs green on the final tree at normal host load (≤ ~4 load); any expectation change to an existing named suite is listed in the checkpoint with its exact test name and one-line justification.
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
