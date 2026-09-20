---
id: TASK-2543
title: >-
  Revoke an unfounded review approval and return the mission to its correct
  lifecycle state
status: backlog
assignee: []
created_date: '2026-09-20 09:05'
labels:
  - workflow
  - cli
  - architecture
  - ai_sdlc
dependencies: []
references:
  - docs/adr/0053-operational-persistence-and-authority-boundaries.md
  - docs/adr/0048-fail-closed-harness-defense-against-agent-hallucinations.md
priority: high
ordinal: 86008
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
An agent reviewer can approve a mission on claims it never verified. When it
does, the lifecycle believes it, promotes the mission, and there is no supported
way back. The operator is left with a mission parked in a state its work has not
earned, and no command that corrects it.

### The incident this comes from

TASK-2521.03, 2026-09-19:

- At 18:55:02 the `custom` reviewer approved round 2 with "No findings", stating
  `npm run test:integration — 2167 pass, 0 fail`.
- The branch at that commit had **four failing integration tests**. Re-running
  the suite against that exact tree reproduces `fail 4`. The reviewer reported a
  result it had not obtained.
- Four seconds later the workflow transitioned the mission `review →
  ready-for-integration` and committed the Backlog status flip (`51426b0b3`).
- The human then left three `REQUEST_CHANGES` reviews on the pull request. None
  of them reached the operator database, which still reads round 2, phase
  `approved`, disposition `APPROVED`.
- Because the round is approved, `px resolve` reports
  `Implementer resolution already recorded (review is approved)` and opens no new
  round, so later repair work cannot be submitted through the review loop at all.

The mission was nowhere near integration. Nothing in the product disagreed.

### Why there is no way back today

- No command revokes or supersedes a recorded approval.
- `px cancel <slug> --yes` is the only thing that removes the rows, and it
  destroys the mission's entire lifecycle record.
- Hand-editing the Backlog frontmatter and the SQLite rows is precisely the
  manual editing ADR 0053 excludes as a category.

So the only available actions are "destroy it" or "edit the database by hand".
Both are wrong, and the operator currently picks one of them under pressure.

### What this task provides

An operator-initiated correction: revoke a specific review decision the operator
judges unfounded, and return the mission to the lifecycle state its work has
actually reached, through a supported application command.

Two constraints shape the design.

**Revocation is an event, not an erasure.** Review history retains its lifecycle
invariants: rounds, reviewed revisions and prior decisions stay attributable. A
revoked approval must remain visible as an approval that was revoked, by whom
and why — not vanish. A later reader must be able to see that the mission was
approved, that the approval was withdrawn, and on what grounds.

**The operator is the authority, not an agent.** This is a human judgement about
whether a decision was earned. It is not something the review loop may invoke to
retry itself, and it is not a way for an implementer to escape a verdict it
dislikes. ADR 0048's human-only disposition is the relevant precedent.

The Backlog task status and the operator database must not be able to disagree
afterwards; whichever the product treats as authority, the other follows through
the same supported path that every other transition uses.

### Scope

The revocation command, its domain rules, the lifecycle move back, and the
projection of the revoked decision in `px status`.

Out of scope: preventing an agent reviewer from claiming an unverified gate
result in the first place. That is a separate problem — verifying a reviewer's
evidence rather than correcting the aftermath — and belongs in its own task.
Note it, do not build it here.

### Do not

Do not add a general "set mission state" command, a state override flag, or an
operator escape hatch that can move a mission anywhere. The correction must be
expressible in the existing state machine and refuse a target state the mission's
recorded evidence does not support. Do not delete review rows. Do not introduce
a second review authority beside the operator database.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 An operator can revoke a named recorded review decision for a mission through a supported command, without editing a repository file or the database by hand.
- [ ] #2 Revocation requires a recorded operator reason and records who revoked it; a revocation with no stated reason is refused.
- [ ] #3 The revoked decision remains in the review history, marked as revoked with its reason, rather than being deleted or overwritten.
- [ ] #4 After revocation the mission reports a lifecycle state consistent with its actual recorded evidence, and the Backlog task status and the operator database agree.
- [ ] #5 The review loop can open a new round after a revocation, and an implementer can submit a resolution against it.
- [ ] #6 Revocation is available to the operator only; no agent-facing prompt or automated loop path can invoke it.
- [ ] #7 Revoking a decision that does not exist, or that is not the mission's current effective decision, is refused with a clear diagnostic and changes nothing.
- [ ] #8 Revocation cannot move a mission to a state the existing state machine does not permit from its current state.
- [ ] #9 A mission that has already been integrated or closed cannot be silently reopened by revocation; the command states why.
- [ ] #10 `px status` reports the revocation so a later agent reads the corrected state rather than the withdrawn approval.
- [ ] #11 Negative tests prove a revocation that fails validation leaves the mission, its review history and its Backlog status completely unchanged.
- [ ] #12 A reproduction test covers the incident shape: an approval followed by a revocation returns the mission to a reviewable state and lets a new round open.
- [ ] #13 Operator-facing documentation explains when to revoke, what it preserves, and that it is a judgement call rather than a retry.
<!-- AC:END -->
