---
id: TASK-2398
title: px review approve never records an authoritative approval when the round is in fixing
status: todo
assignee: []
created_date: '2026-08-22'
labels:
  - bug
  - ai_sdlc
dependencies: []
references:
  - src/adapters/review/review-commands.ts
  - src/adapters/review/review-artifacts.ts
  - src/adapters/review/review-round.ts
  - src/adapters/review/review-state-mapping.ts
  - src/adapters/cli/commands/integrate.ts
priority: high
ordinal: 105918
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
An `approve` verdict recorded through `px review` reports `[PASS]` while writing
no authoritative `ReviewerDecision` on the Review aggregate whenever the current
round's phase is not `reviewing`. The mission is then permanently unintegratable:

```
[PASS] Review outcome "approve" posted on PR for mission/task-2380.
[PASS] Task task-2380 transitioned to review and committed.
$ px integrate
[FAIL] Mission task-2380 is in review without an authoritative approval.
       Record a ReviewerDecision through px review before integration.
```

Observed aggregate state for `task-2380` (`mission_review_rounds`, round 1):

| column | value |
| --- | --- |
| `decision_kind` | `changes-requested` |
| `decision_comment` | `APPROVED` |
| `disposition` | `APPROVED` |
| `phase` | `fixing` |
| `decided_at` | `2026-08-21T07:02:51.021Z` (the *request-changes* time) |

### Root cause

`request-changes` is recorded on the aggregate through
`recordRequestedChanges` -> `applyReviewerCommand` (`review-round.ts:86`,
`review-commands.ts:906-928`). `approve` has **no aggregate counterpart**. Both
approve paths only mutate the flat `ReviewState` and attempt a phase transition
inside a swallowing `catch`:

- `submitReviewOutcome` — `review-commands.ts:1034-1042`
- `recordReviewVerdict` — `review-artifacts.ts:227-232`

```ts
state.disposition = 'APPROVED';
try { state.transitionTo('approved'); } catch { /* ignore */ }
```

`REVIEW_PHASE_TRANSITIONS` (`src/domain/review.ts:129-134`) allows
`fixing -> reviewing | pending-approval` only, so from `fixing` the transition
throws and is discarded. The write then reaches
`applyReviewStateToReview` with `phase: 'fixing'`, `disposition: 'APPROVED'`, and
`decisionFromState` (`review-state-mapping.ts:54-75`) retains the previous
`changes-requested` decision, rewriting only its `comment` to `APPROVED`.

`recoveryEstablishesApproval` (`integrate.ts:868-895`) requires
`lastRound.decision.kind === 'approved'`, so integration refuses forever, and no
CLI path repairs the round: re-running `px review ... approve` reproduces the
same silent no-op.

Trigger in practice: the reviewer requested changes (round -> `fixing`), the
implementer follow-up never recorded a resolution (`responded_at` is null after
six `follow-up:custom` stage launches), and a later `approve` was recorded
against the still-`fixing` round.

This is pre-existing review-loop code; mission `task-2380` (Claude stale-session
handling) did not introduce it — its branch touches no review-recording code.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 An `approve` verdict records an authoritative `ReviewerDecision`
  (`decision.kind === 'approved'`) on the Review aggregate, mirroring how
  `recordRequestedChanges` records `changes-requested`.
- [ ] #2 An `approve` recorded while the round cannot legally reach the
  `approved` phase fails loudly (non-zero exit, actionable message) instead of
  printing `[PASS]` after a swallowed transition error; no path leaves a round
  with `disposition === 'APPROVED'` and `decision.kind === 'changes-requested'`.
- [ ] #3 Both approve paths are covered: `submitReviewOutcome`
  (`review-commands.ts`) and `recordReviewVerdict` (`review-artifacts.ts`).
- [ ] #4 A mission already stuck in the inconsistent state (approved
  disposition on a `fixing` round) has a documented repair path that reaches
  integration.
- [ ] #5 Approving a round that is legitimately `awaiting-review` is unchanged.
- [ ] #6 A red-to-green test reproduces the task-2380 state: request-changes,
  then approve on the `fixing` round, and asserts the resulting decision and the
  `px integrate` approval gate.
- [ ] #7 `./scripts/verify-local.sh static-analysis` passes.
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
