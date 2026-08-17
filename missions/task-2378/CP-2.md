# CP-2 — Call-site audit and invariant check

## Summary

Classified every `writeReviewState` / `persistReviewStateOrThrow` / `ReviewStatePersistence.save` /
`createEvent` call site under `src/` as approval-producing or not (SC06); confirmed 0 grep
matches for the four deleted inference helpers; proved no contemporary workflow reaches
`integration` without a Review aggregate; and ran both task-2376 regression suites green.
No genuine Review-less workflow exists, so Stop rule 1 does not trigger.

**Audit method.** A site is *approval-producing* when it can persist review state with
`disposition: 'APPROVED'` / `phase: 'approved'`, which is exactly what makes
`ReviewState.save()` fire the `review → integration` boundary
(`src/adapters/review/review-state.ts`, guard `lifecycleService && this.phase === 'approved'`).
Sites that only append audit events (`createEvent` → `review.reviewEvents`), merge metadata, or
re-persist an already-approved state (idempotent boundary replay via the existing
`idempotencyKey`) do not create a new `ReviewerDecision` and are classified not.

## Approval-producing sites

| # | Site | Function | Production binding |
|---|------|----------|--------------------|
| 1 | `persistReviewStateOrThrow` at `src/adapters/review/review-commands.ts:925` | `submitReviewRound`, provider=none branch (sets `disposition='APPROVED'`) | BOUND — `src/composition/create-cli.ts:191` passes `persistence.writeReviewState` from `bindReviewPersistence(store, lifecycle)` (`src/composition/review-persistence.ts:27`) |
| 2 | `persistReviewStateOrThrow` at `src/adapters/review/review-commands.ts:1000` | `submitReviewRound`, provider branch (same disposition write after `postWorkflowReview`) | BOUND — same wiring as site 1 |
| 3 | `persistReviewStateOrThrow` at `src/adapters/review/review-artifacts.ts:203` | `recordLocalReviewVerdict` (self-author skip; sets `disposition='APPROVED'`) | PARTIAL — bound when reached via `submitReviewRound` (`src/adapters/review/review-commands.ts:955` forwards `writeReviewStateFn`), but UNBOUND when reached via the autonomous loop: `consumeReviewerArtifacts` calls `postWorkflowReview` at `src/adapters/review/review-artifacts.ts:431` without forwarding `writeReviewStateFn`, so `recordLocalReviewVerdict` falls back to the unbound module default. **Flagged for CP-3 binding (one-line forward).** |
| 4 | `persistReviewStateOrThrow` at `src/adapters/review/review-loop.ts:691` | `startReviewLoop` APPROVED branch (autonomous reviewer approval) | BOUND — `reviewLoopBindings(store, lifecycle)` at `src/composition/create-cli.ts:206` and `src/composition/application-services.ts:222` |

Known defect at all four sites (locked RED by CP-1 case 2): `ReviewState.save()` swallows a
failed boundary transition (`src/adapters/review/review-state.ts:705`, "non-fatal"), and the
Backlog promotion proceeds unconditionally — fire-and-forget `transitionTaskFn(slug, 'approved', ...)`
in `submitReviewRound`, and `transitionVirtualFn(transitionTaskFn, slug, 'approved', ...)` at
`src/adapters/review/review-loop.ts:693`. CP-3 target: surface the failure and order promotion
after a successful transition.

## Not approval-producing sites

| Site | Function | Verdict |
|------|----------|---------|
| `src/adapters/review/review-commands.ts:721` | `commentRound` | Re-persists current state unchanged after posting a comment; no disposition write |
| `src/adapters/review/review-commands.ts:820` | `consumeArtifacts` | Persists dedup metadata merged in place by `consumeHumanNotes`; the verdict is returned as a loop control value, not persisted here as a decision |
| `src/adapters/review/review-commands.ts:1192` | `createEventHandler` (`px review --create-event`) | Audit event write only |
| `src/adapters/review/review-artifacts.ts:381,391` | `consumeReviewerArtifacts` | Creates `REVIEWER_FINDINGS` / `REVIEWER_OUTCOME` events only; verdict returned as control value |
| `src/adapters/review/review-artifacts.ts:559,571` | `consumeImplementerArtifacts` | Implementer round-summary / disposition events only |
| `src/adapters/review/review-artifacts.ts:760,762,782,784` | `dispatchArtifactFailure` | Artifact-failure diagnostic metadata only |
| `src/adapters/review/review-loop.ts:329,377,384,395,495,628,757,885,946,965,973,979,1020,1029` | `startReviewLoop` bookkeeping | Handoff-failure metadata, reviewer-identity refresh, normalized-phase repair, human-escalation metadata, and `reviewing`/`fixing` phase transitions; only the APPROVED branch (line 691, site 4 above) writes an approval |
| `src/adapters/review/review-agent-fallback.ts:84,183,202` | `markStageLaunchRecorded` / `recordStageStatsSafe` / `persistNormalizedPhaseRepair` | Stage-launch fingerprints, fallback identity fields, phase-normalization repair of an already-normalized phase; no decision created |
| `src/adapters/review/review-gate-handling.ts:259,261` | gate-retry bounce | Gate retry counter metadata only; task bounces to `active` |
| `src/adapters/rebase/rebase-workflow-adapter.ts:99,213` | `handleHookFailureAutoBounce` / rebase command wiring | `hookFailureRetryCount` metadata only (policy in `src/application/hook-failure-workflow.ts`); state is read-back plus metadata, and hook failures occur in the active/fixing lane. Unbound module default is safe here — flagged but not approval-producing, so not bound speculatively |
| `src/adapters/cli/commands/integrate-post.ts:83` | `handleHookFailureAutoBounce` (integrate variant) | Same hook-failure policy as above |
| `src/adapters/review/review-events.ts:734,769` | `createEvent` → `store.save`, all callers (incl. `review-event` command at `src/composition/create-cli.ts:443`) | Appends `review.reviewEvents` audit records; events do not set a round `ReviewerDecision`. The `review-event` command binds persistence without a lifecycle service (`create-cli.ts:443`) — harmless, event writes never fire the boundary |
| `src/adapters/review/review-state.ts:321,427` | `backfillReviewFromLegacyState` / `reconcileInterruptedHandoff` | Seed a round-1 aggregate for an in-flight review; no decision is written |
| `src/adapters/review/review-state.ts:699,809` | `ReviewState.save` / `resetReviewState` | The boundary itself lives in `save`; `resetReviewState` returns the round to `reviewing` — not approval-producing |

**Audit conclusion:** every approval-producing site is bound to the lifecycle service in
production wiring except site 3's loop path, where `consumeReviewerArtifacts` drops the bound
`writeReviewStateFn` before `postWorkflowReview`. Per the mission risk note, the binding work
shrinks to that one forward plus failure-surfacing and Backlog ordering (CP-3). No speculative
bindings.

## Deleted-helper check

`grep -rn "deriveImplementerAndFixRoundsFromPrComments\|deriveFixRoundsFromReviewStateHistory\|deriveFinalImplementerFromBranchHistory\|deriveFixRoundsFromTaskText" src/ test/`
→ **0 matches**.

## Review-less integration proof

`src/domain/mission-workflow.ts` (`decideMission`): the only command that produces
`status: 'integration'` is `approve`, which is typed `{ type: 'approve'; review: Review }` and
throws `Approval requires an approved review` unless `reviewStatus(review) === 'approved'`. All
three producers pass the Mission's Review aggregate: the approval boundary
(`src/adapters/review/review-state.ts:712`) and the `px integrate` recovery paths
(`src/adapters/cli/commands/integrate-command.ts:817`, `src/adapters/cli/commands/integrate.ts:958`).
**No contemporary workflow can reach `integration` without a Review aggregate.** No Review-less
workflow to document; Stop rule 1 clear.

## task-2376 regression confirmation

- `test/task-2376-lifecycle-timing.test.ts`: **11 pass / 0 fail** — R1, R1 production, R2, R2
  sensitivity, R3, R8, R8 sensitivity, R10, R11, R12, R13
- `test/integrate.test.ts`: **72 pass / 0 fail**, including
  `"R4: stale active recovery chains submit-for-review then approve with original decidedAt"`,
  `"R7: review without approval stops — Mission remains review"`,
  `"R9: normal integration state proceeds without rerunning approval"`,
  `"recovery promotes an approved Review with its original decidedAt before integration"`,
  `"recovery refuses an active Mission without authoritative Review facts"`

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Verdict recorded for every review-persistence call site under `src/` (SC06) | Tables above cover `src/adapters/review/review-commands.ts`, `src/adapters/review/review-loop.ts`, `src/adapters/review/review-artifacts.ts`, `src/adapters/review/review-agent-fallback.ts`, `src/adapters/review/review-gate-handling.ts`, `src/adapters/review/review-events.ts`, `src/adapters/review/review-state.ts`, `src/adapters/rebase/rebase-workflow-adapter.ts`, `src/adapters/cli/commands/integrate-post.ts`, `src/composition/review-persistence.ts`, `src/composition/create-cli.ts` | PASS |
| Every approval-producing site bound to a lifecycle service (SC06) | `src/composition/review-persistence.ts` (`bindReviewPersistence`, `reviewLoopBindings`) with wiring at `src/composition/create-cli.ts:191,206` and `src/composition/application-services.ts:222`; `"R1 production: local approval path transitions Mission to integration before px integrate"`; sole unbound path (`review-artifacts.ts:431` forward) flagged for CP-3 | PASS |
| 0 grep matches for the four deleted inference helpers | `grep -rn` over `src/ test/` reported 0 matches (Deleted-helper check above) | PASS |
| No contemporary workflow reaches `integration` without a Review aggregate | `src/domain/mission-workflow.ts` (`decideMission` `approve` case requires `review: Review` with approved status); all producers pass the Mission Review | PASS |
| task-2376 landed parts green on current tree (CP-2 audit item) | `test/task-2376-lifecycle-timing.test.ts` 11/11, `test/integrate.test.ts` 72/72 | PASS |
| No genuine Review-less workflow requiring a required-store exception (Stop rule 1) | Review-less integration proof above | PASS |
| Restricted areas untouched (audit-only checkpoint) | `src/domain/mission.ts`, `src/domain/mission-workflow.ts`, `src/domain/review.ts`, `src/application/mission-lifecycle-service.ts` unchanged; only this CP doc added | PASS |

Next action: CP-3 — make `ReviewState.save()` report the boundary transition outcome in the
persistence result, surface the failure through `submitReviewRound` (and the loop APPROVED
branch) with a non-zero, operator-visible outcome, order Backlog promotion after a successful
transition, forward the bound `writeReviewStateFn` through `consumeReviewerArtifacts` →
`postWorkflowReview`, and drive CP-1 case 2 to green.
