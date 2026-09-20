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
- The human then left `REQUEST_CHANGES` reviews on the pull request. None of
  them reached the operator database, which still reads round 2, phase
  `approved`, disposition `APPROVED`.
- Because the round is approved, `px resolve` reports
  `Implementer resolution already recorded (review is approved)` and opens no new
  round, so later repair work cannot be submitted through the review loop at all.

The mission was nowhere near integration. Nothing in the product disagreed.

### The provider is wrong in the same way, for its own reason

Listing the pull request's reviews shows both authorities are stale, separately:

```text
2297  custom  APPROVED         dismissed=False  2026-09-19T18:55:05
2298  magnus  REQUEST_CHANGES  dismissed=False  2026-09-19T21:14:09
```

The human's `REQUEST_CHANGES` is newer than the agent's approval, and the
approval still stands undismissed beside it. Forgejo already models dismissal —
the API returns a `dismissed` flag and other reviews on this pull request carry
`dismissed: true` — so nothing about the provider prevents the correction. The
product simply never makes it.

Human reviews never reach the database because the only path that reads provider
reviews filters them out twice. `getLatestReviewForPr` keeps a review only when
`user === reviewerUser && submitted >= since`: it looks exclusively at the agent
reviewer's own identity, and only inside the current round's polling window. A
review by a human, or any review submitted after the round closed, is invisible
to the workflow by construction. Human *comments* are classified by
`consumeHumanNotes`; human *reviews* are not ingested at all.

So the operator's most natural gesture — requesting changes on the pull request —
is the one action the system cannot see.

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

### Both authorities, or it is not fixed

A revocation that corrects only the operator database leaves an undismissed
approval on the pull request, which is what a human reviewer and any provider
gate will read. A revocation that corrects only the provider leaves the database
approved and `px resolve` still refusing to open a round. Either half alone
recreates the same disagreement in the opposite direction.

The correction therefore has to span both, in both directions:

- Revoking locally must supersede the corresponding provider review, so the pull
  request stops presenting a withdrawn approval as current.
- A human `REQUEST_CHANGES` on the pull request must reach the mission, whoever
  posted it and whenever it was posted — not only the configured agent reviewer
  inside a live polling window.

Where the provider is disabled or unreachable, the local correction must still
complete and must say plainly that the provider was not updated, rather than
failing silently or leaving the two half-applied.

### Scope

The revocation command, its domain rules, the lifecycle move back, the provider
propagation and human-review ingestion described above, and the projection of
the revoked decision in `px status`.

Out of scope: preventing an agent reviewer from claiming an unverified gate
result in the first place. That is a separate problem — verifying a reviewer's
evidence rather than correcting the aftermath — and belongs in its own task.
Note it, do not build it here.

### Do not

Do not add a general "set mission state" command, a state override flag, or an
operator escape hatch that can move a mission anywhere. The correction must be
expressible in the existing state machine and refuse a target state the mission's
recorded evidence does not support. Do not delete review rows, and do not delete provider reviews where the provider
can dismiss them instead. Do not make the pull request a second review authority:
it is a projection that must be corrected alongside the database, not a store the
workflow starts trusting in place of it.
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
- [ ] #11 Revoking a decision supersedes the corresponding review on the Forgejo pull request, so the pull request no longer presents a withdrawn approval as current.
- [ ] #12 A `REQUEST_CHANGES` review posted on the pull request by a human reaches the mission's recorded review state, regardless of which user posted it and whether a round was polling at the time.
- [ ] #13 A provider review that arrives after a round has closed is still ingested rather than discarded for falling outside the polling window.
- [ ] #14 With the review provider disabled or unreachable, the local revocation still completes and reports that the provider was not updated; no half-applied correction is left behind.
- [ ] #15 A test proves the incident shape end to end on the provider: an agent approval followed by a human `REQUEST_CHANGES` leaves the mission reviewable rather than approved.
- [ ] #16 Negative tests prove a revocation that fails validation leaves the mission, its review history, its Backlog status and the pull request completely unchanged.
- [ ] #17 A reproduction test covers the incident shape: an approval followed by a revocation returns the mission to a reviewable state and lets a new round open.
- [ ] #18 Operator-facing documentation explains when to revoke, what it preserves, that it spans both the database and the pull request, and that it is a judgement call rather than a retry.
<!-- AC:END -->
