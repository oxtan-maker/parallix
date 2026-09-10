---
id: TASK-2473
title: Wire resumeReview into a CLI command so stopped reviews can recover
status: done
assignee: [custom]
created_date: '2026-09-09 14:30'
labels:
  - ai_sdlc
  - bug
dependencies: []
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
### What happened
Mission `task-2465` round 4 is stuck in a permanent dead end. The reviewer
(`claude`) returned `REQUEST_CHANGES` with all findings fixed, but the operator
had already *stopped* the review because the implementer's in-attempt repair
budget was exhausted (`IMPLEMENTER_ARTIFACT_RETRY_EXHAUSTED`). That stop sets a
`human-intervention` flag on the review. Every subsequent handoff then fails with:

    A submitted review must be awaiting a reviewer decision.

The implementer cannot proceed, and there is no CLI command that clears the
intervention to let the review continue.

### Root cause
`src/domain/review.ts` defines

    export function resumeReview(review: Review): Review

which clears `review.intervention` and returns the review to `awaiting-review`
(so the next round flows normally). The function is **only called from tests**
(`test/domain-mission.test.ts`); no CLI command and no application use-case ever
invoke it. It is dead code.

The failure is enforced by the `submit-for-review` guard in
`src/domain/mission-workflow.ts` (`reviewStatus(review) !== 'awaiting-review'`
throws `MissionRuleViolation`). `reviewStatus` returns `'human-intervention'`
whenever `review.intervention` is set, and `'awaiting-review'` only after the
intervention is cleared. So while an intervention is pending, the review cannot
be resubmitted, and `resumeReview` — the one function that would clear it — is
never exposed.

`px review --continue` does not help: it re-runs the review loop, which hits the
same `submit-for-review` guard and throws the same error. There is no command
that transitions a `human-intervention` review back to `awaiting-review`.

### Impact
Any review stopped via `request-human-intervention` — budget exhaustion, a
manual operator stop, or the gate-rebound path — is unrecoverable by the agent.
The only way forward today is a human touching the operator database by hand.
This is exactly what blocked `task-2465`.

### Required fix
Expose `resumeReview` on a CLI path so a stopped review can be resumed, e.g.
`px review --continue` (or a dedicated `px review --resume`) that, when
`reviewStatus(review) === 'human-intervention'`, calls `resumeReview` to clear
the flag and lets the review flow to the next round. Consider operator/actor
authority (who is allowed to resume) and whether resuming should reset the
implementer retry budget.

Trigger: surfaced while resolving mission `task-2465` round 4; the review was
stopped on budget exhaustion and could not be resumed.
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
