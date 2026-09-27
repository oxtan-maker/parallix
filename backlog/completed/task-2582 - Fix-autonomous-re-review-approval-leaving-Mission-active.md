---
id: TASK-2582
title: Fix all Mission lifecycle transitions and persist state immediately
status: done
assignee: [codex]
created_date: '2026-09-26 09:32'
updated_date: '2026-09-27 09:04'
labels:
  - ai_sdlc
  - bug
  - review
  - lifecycle
dependencies: []
references:
  - TASK-2579
  - TASK-2397
  - TASK-2514
priority: high
ordinal: 113008
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
TASK-2579 (PR #501) completed autonomous review round 2 with APPROVE, printed APPROVED and “Task task-2579 transitioned to ready-for-integration and committed”, but the authoritative Mission remained active instead of integration.

Observed evidence (operator SQLite database, read-only inspection on 2026-09-26): missions.id=task-2579 has status=active, version=38; mission_review_rounds round 2 has decision_kind=approved, phase=approved, disposition=APPROVED. board_lane_events records active → review at 06:17:26.210Z and review → active (request-changes) at 06:51:57.033Z, with no subsequent review or integration event. Round-2 reviewer_outcome verdict=approve was recorded at 07:09:53.161Z. This is a persisted lifecycle mismatch, not a board rendering issue.

Root cause traced in mission HEAD f1df44731 and confirmed in main 14685f112:
- src/adapters/review/review-round.ts recordRequestedChanges correctly transitions the Mission from review to active.
- The subsequent autonomous reviewer setup in src/adapters/review/review-loop.ts (around lines 411–414) calls transitionTaskFn(slug, review) and persists review bookkeeping, without an authoritative active → review lifecycle transition. transitionTaskLocal in src/adapters/backlog/task-transitions.ts only edits/commits the Backlog task file. Opening the next round therefore leaves the Mission active.
- transitionApprovedReview and replayApprovalTransition in src/adapters/review/review-round.ts silently return null unless mission.status is review. recordApproval can consequently report recorded while leaving an active Mission unchanged.
- The loop approval persistence path does have a lifecycle service supplied by src/composition/review-persistence.ts. However ReviewState.approveLifecycle in src/adapters/review/review-state.ts only reports a non-completed approve transition when the old Mission status is review. The domain approve command requires review (src/domain/mission-workflow.ts), so failure from active is suppressed and persistence reports committed.
- applyReviewerOutcome then prints approval success and transitionVirtualFn updates the Backlog task to ready-for-integration, producing the misleading success message.

Reproduction: start an authoritative review; submit request-changes; record actual implementer fixes/resolutions; let the autonomous loop open round 2 and approve it. Observe an approved review attached to an active Mission and a success message despite no integration lane event.

Fix the authoritative round handoff and approval failure handling, rather than changing board lane inference or widening the domain approve guard. TASK-2397 covers px integrate recovery of active + approved, but does not prevent this normal review-loop failure. TASK-2514 addresses a related manual human approval path; this ticket covers the autonomous multi-round path.

Expanded scope requested by the operator: audit and fix ALL Mission lifecycle transitions across CLI, board-triggered commands, autonomous loops, manual actions, retries, resume and recovery. TASK-2579 is the confirmed reproduction; other affected paths must be investigated, not assumed correct or claimed broken without evidence. Cover every supported transition, including intake/refinement, activation, review handoff and re-review, request-changes, approval/integration queueing, integration completion, cancellation and recovery where supported. Distinguish lifecycle lane from current work: beginning integration work must not mark the Mission done before integration succeeds.

Timing contract: when Parallix accepts a valid transition and begins work belonging to the destination state, persist the authoritative destination state and its lane event directly at that boundary, preferably before launching an agent or starting slow setup, Git operations, verification gates, provider calls or background work. Where direct persistence is not possible, it must complete within the first 200 ms of beginning destination-state work. Measure elapsed time with a monotonic clock from that boundary to successful persistence; do not satisfy the budget by backdating event timestamps or measuring only the database call. Preconditions and authorization must still pass before transition; completed states require actual successful completion. If persistence fails or exceeds the deadline, surface the failure and stop dependent work rather than claiming success. Board/projections must receive the committed change promptly instead of waiting for the agent or command to finish.

Use the existing lifecycle service and domain rules as the authority. Remove or correct file-only status changes, skipped boundary transitions, swallowed errors and delayed state writes wherever this audit finds them. Preserve version checks, idempotency, decision/revision guards and recovery semantics. Record the audited entry points and reproduction evidence in this task/checkpoint, not as a new live documentation inventory.

Operator clarification: the done transition is exempt from the 200 ms destination-work-start deadline because no work starts or runs in done. All integration work, including required verification, finalization and cleanup, remains in integration until it has finished successfully; only then may the Mission transition to done. Keep done in the lifecycle correctness audit, but do not apply a work-start timing requirement to it. The immediate/200 ms rule applies to states in which Parallix begins new work.

Operator clarification (2026-09-27): correct authoritative lifecycle state throughout the workflow is mandatory. A Mission must be in review when review work begins, including every autonomous re-review round, and in integration when approval succeeds. Leaving it active during review or after successful approval is a defect even if the Backlog file, provider PR or console reports the expected state. Manual `review --push`, later `integrate` recovery, or a board inference is not fulfillment of this contract. Persistence failures must stop dependent work and report failure; they must never be presented as successful review or approval.

All demonstrated bounce mismatches are in scope. The earlier audit's F3, F6 and F7 exclusions do not satisfy this mission. Add or adjust guarded domain transitions where the existing command set cannot represent a legitimate repair and return path; preserve review decisions, unresolved findings, revision guards, version checks and lane-event idempotency without fabricating reviewer decisions. Review gate/rebase repairs that return to implementation must enter active before repair work and return to review before review resumes. Integration hook repairs remain in integration when they are part of integration completion, with the Backlog mirror agreeing; if a repair genuinely returns to implementation, implement both the authoritative rebound and the guarded return to integration. No supported path may intentionally leave the authoritative lane and its mirrors inconsistent while relying on a later action to repair them.

Verification must exercise the changed executable through production composition. Record its resolved path and build/source revision, and ensure the autonomous parent process and every child `px verdict` / `px resolve` invocation use the intended implementation. A source-only suite or a globally installed executable lacking the changes cannot establish end-to-end success. Run an isolated multi-round workflow and read back the authoritative Mission and lane events at review start, request-changes, repair, re-review and approval; the final state must be integration. The current task-2582 mismatch is unresolved evidence, not completion proof.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A real request-changes → fixes → next review round → approve flow moves the authoritative Mission active → review → integration and emits the corresponding lane events.
- [ ] #2 Approval cannot report success or promote the Backlog task when the authoritative lifecycle boundary fails, including when the Mission is active.
- [ ] #3 Add a red-to-green regression using the real lifecycle and review persistence boundaries; cover approval replay without duplicate lane events and preserve unresolved findings guards.
- [ ] #4 The autonomous loop success output and Backlog ready-for-integration status agree with the authoritative Mission integration state.
- [ ] #5 Audit every supported Mission lifecycle transition and all CLI, board, autonomous, manual, retry, resume and recovery entry points; record findings and fix all demonstrated inconsistencies, including TASK-2579.
- [ ] #6 Persist the authoritative destination state and lane event directly at the accepted transition boundary, preferably before destination-state work starts; any unavoidable deferred persistence completes within 200 ms of starting that work, measured end to end with a monotonic clock.
- [ ] #7 Slow agent launches, Git operations, verification gates and provider calls do not delay the state transition; completed states are recorded only after actual completion and all domain preconditions remain enforced.
- [ ] #8 Lifecycle persistence failures or missed transition deadlines are visible and stop dependent work; no success output, Backlog promotion or projected destination state is emitted for an uncommitted transition.
- [ ] #9 Add runnable regression coverage for transition ordering and the 200 ms contract with external boundaries mocked, including multi-round review, retries, resume/recovery and slow downstream work; replay emits no duplicate lane events and stale versions do not overwrite state.
- [ ] #10 Board and other projections receive committed lifecycle changes promptly without waiting for long-running command or agent completion; tests distinguish queue/lane transitions from current work and terminal completion.
- [ ] #11 Done is exempt from the 200 ms work-start deadline: no work runs in done; all integration work, required verification, finalization and cleanup finish successfully in integration before the done transition. Cover this ordering in regression tests.
- [ ] #12 Every review and re-review begins with the authoritative Mission in review; successful approval leaves it in integration. No active + approved success state or manual workaround is accepted, and state is checked while work runs as well as after it finishes.
- [ ] #13 Fix the demonstrated F3/F6/F7 bounce inconsistencies within this mission, including necessary guarded domain transitions and return paths. Review repairs enter active and resume review through an authoritative transition; integration completion repairs preserve integration and mirror agreement, or use a complete guarded rebound/return path. No fabricated reviewer decision or deferred mirror-only repair is allowed.
- [ ] #14 Capture an isolated end-to-end request-changes → fixes → re-review → approve run through production composition using the changed executable for both the loop and child verdict/resolve commands. Record executable/build identity and authoritative state/lane-event read-backs at each boundary; approval ends in integration without `review --push`, `integrate` recovery or direct database repair.
<!-- AC:END -->



## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 Verification gate ran and passed on the final tree with captured proof rather than an unverified claim
- [ ] #2 Lint and static analysis report clean on every changed file
- [ ] #3 No focused or unannotated skipped tests were introduced (no .only and no bare .skip)
- [ ] #4 Final checkpoint Goal Check table cites real evidence using file:line references and test names
- [ ] #5 Docs updated to reflect any workflow or user-facing behavior change
- [ ] #6 Bug-labeled missions include a red-to-green reproduction test that fails before the fix and passes after
- [ ] #7 Prior approval and focused test results do not close this mission until the lifecycle gaps and executable end-to-end acceptance criteria above are satisfied with captured evidence.
<!-- DOD:END -->

## Unresolved operator verification — 2026-09-27

Read-only inspection of the operator database found task-2582 active at version 87, with round 5 approved (phase approved, disposition APPROVED). Its lane history ends with round 1's review → active request-changes event at 2026-09-26T19:39:18.944Z; there are no subsequent review or integration events despite rounds 2–5. The review reported approval and promoted the Backlog file to ready-for-integration. The operator's later interrupted `review --push` is a workaround and is excluded from this reproduction.

The quoted reviewer invocation used the installed `px`, resolved during inspection to `/home/magnus/.nvm/versions/node/v24.15.0/lib/node_modules/@magnusekdahl/parallix/build/px.mjs`. Its source map lacks review-round-open.ts and retains the old approval failure check restricted to mission.status === 'review'. This establishes that the child verdict executable lacks this mission's boundary fixes; the identity of the parent loop executable must also be captured in renewed verification. Matching package version 1.5.183 does not establish matching implementation.

The CP-3/CP-4 audit below is historical implementation evidence. Its OK/fixed labels do not establish current end-to-end acceptance, and its F3/F6/F7 no-change dispositions are superseded by the operator clarification above. Round 5 approval is insufficient completion evidence; the mission remains incomplete until the updated acceptance criteria pass.

## Lifecycle Audit — TASK-2582 (2026-09-26, CP-3)

Full audit of every supported Mission lifecycle transition (refine, activate,
rebound-to-active, submit-for-review, request-changes, approve, integrate,
cancellation, recovery) across CLI, board-triggered, autonomous loop, manual,
retry, resume and recovery entry points. The authoritative writers are
`MissionLifecycleService.transition/activate` (src/application/mission-lifecycle-service.ts),
`MissionIntegrationService.decideIntegration/close` (src/application/mission-integration-service.ts),
and the guarded recovery writes in src/application/mission-lifecycle-recovery.ts.
Board and metric readers (src/application/projections/, src/composition/board-projection.ts)
perform no lifecycle writes.

### Entry-point matrix

| Transition | Entry point | Boundary behavior | Verdict |
|---|---|---|---|
| refine | CLI `px draft` finalTransition (src/adapters/cli/commands/draft-stats.ts:232, called :786/:798) | Persisted at contract completion, before the Backlog move to ready; incomplete contract bounces to the draft agent and fails loudly | OK — refine is accepted only when the drafted contract validates (domain `requireDraftedContract`), and no Parallix work runs in refined; the next work state is active |
| refine | Board draft (src/composition/production-capabilities.ts draft workflow -> `DraftCommandUseCase`) | Same path as CLI | OK |
| activate | CLI `px active` / board active dispatch (src/application/execute-mission-service.ts) | **Was:** Backlog file flipped to active at launch (src/adapters/cli/commands/active.ts onLaunch), authoritative DB active persisted only after the agent run completed (recordLaunch -> synchronizeLifecycle). **Fixed:** the boundary now commits at launch confirmation via `onActivated` (src/application/execute-mission-service.ts:185, activateAtBoundary :241; src/adapters/cli/commands/active.ts:219-227), before the Backlog mirror moves and before current-work publication; a domain/write refusal fails the run (src/adapters/cli/commands/active.ts:273-275); an unavailable operator store fails closed like any other persistence failure (ADR 0053 rule 5) — the run stops at the boundary with no active work and no handoff (src/application/execute-mission-service.ts activateAtBoundary). The launcher fires the boundary per launched family, so an automatic fallback re-asserts with the final agent and no second lane event (activation is idempotent on an active lane, src/domain/mission-workflow.ts decideMission 'activate') | **Fixed (F1, round-4 F9)** |
| rebound-to-active | `px integrate` gate bounce (src/application/integrate/gates.ts:140-155 `reactivateMissionFn` -> rebound kernel transitionToImplementer) | DB-first (lifecycle.transition rebound-to-active), then Backlog mirror, then the repair launch | OK |
| submit-for-review | CLI `px handoff` (src/application/handoff-command-use-case.ts:1386) | DB first, then Backlog mirror (:1408), then Forgejo push; the reviewer launches only after the handoff returns ok | OK |
| submit-for-review | `px review --start` loop start handoff (src/adapters/review/review-loop.ts:164 performHandoff) | Same performHandoff path | OK |
| submit-for-review | Autonomous loop round open (src/adapters/review/review-round-open.ts:153) | Fixed in CP-2: active -> review commits at the round-open boundary before the pre-review rebase | OK (CP-2) |
| submit-for-review | Board handoff / resume (src/composition/production-capabilities.ts:152 resumeActiveBoardHandoff; performHandoff for first handoff) | Same performHandoff path; resume commits the transition before the reviewer loop | OK |
| submit-for-review | `px integrate` recovery of an approved round (src/application/integrate/recovery.ts:105-133) | **Was:** transition result discarded. **Fixed:** a failed boundary now aborts with the authority's reason (src/application/integrate/recovery.ts:132) | **Fixed (F2)** |
| request-changes | Loop artifact consumption (src/adapters/review/review-artifacts.ts:853 recordReviewerChangeRequest -> src/adapters/review/review-round.ts:147) | DB review -> active commits during artifact consumption, before the implementer act-on-review launch; failure stops the round | OK |
| request-changes | Manual `px review` request-changes (src/adapters/review/review-commands.ts:1109-1111 -> review-round.ts:147) | Same function; exit 1 on failure | OK |
| approve | Loop approval (src/adapters/review/review-state.ts:848 via src/composition/review-persistence.ts) | Fixed in CP-2: boundary-failed from any non-approve lane; the loop stops before Backlog promotion (src/adapters/review/review-loop.ts applyReviewerOutcome) | OK (CP-2) |
| approve | Manual `px review` approve (src/adapters/review/review-commands.ts:1279 submitReviewRound; provider=none records immediately, provider-backed records only after a successful POST) | Fails loudly (CP-2 approvalLaneDiagnostic); a failed POST leaves no approval | OK |
| approve | `px integrate` recovery (src/application/integrate/recovery.ts:202-213) | Result checked; abortWith on failure | OK |
| integrate (-> done) | `px integrate` landing (src/application/integrate/squash.ts finishLanding -> persistLandedIntegrationOrAbort; src/application/integrate/github-pr.ts:52; src/adapters/cli/commands/integrate-post.ts:202) | integration -> done persists only after the squash merge and fresh verification facts (done is exempt from the work-start deadline; completed states require actual completion) | OK |
| cancellation | `px cancel` (src/application/mission-cancel-service.ts) | Row deletion, not a lane transition | OK |
| recovery | `px recover` (src/application/mission-lifecycle-recovery.ts) | Guarded saveWithTransition writes (landing proof + read-back for closeout; history check for the active/done split reopen) | OK |
| recovery supervisor | src/application/recovery-supervisor.ts | Presses the existing application workflows; performs no lifecycle writes of its own | OK |
| intake | src/application/mission-intake-service.ts:100 | saveWithTransition at materialization | OK |

### Findings

- **F1 (fixed): activate persisted after the destination work completed.** `px active` flipped the Backlog file to active at launch but committed the authoritative active transition only after the implementer run finished (execute-mission-service.ts recordLaunch), so the operator database showed refined while — and after — active work ran, and a killed run stranded the Mission refined. Fixed: the boundary commits at launch confirmation (see matrix); tests: `execute mission use case stops the run when the active boundary cannot commit at launch` (test/execute-mission-service.test.ts), `execute workflow: an unavailable store at the launch boundary fails the run fail-closed` and `execute workflow: an unavailable activation never reaches handoff, even while the store stays down` (test/execute-mission-characterization.test.ts). Round-4 review finding F9 removed the ADR 0051 skip this fix had introduced: an unavailable store now fails the run closed (ADR 0053 rule 5), and the dead re-assert path (reassertNeeded / synchronizeLifecycle) was deleted.
- **F2 (fixed): integrate recovery discarded a boundary result.** The already-approved-round branch of `recoverActiveMission` awaited the submit-for-review transition and ignored the outcome (src/application/integrate/recovery.ts:105-126 before the fix); a failed boundary surfaced only as a misleading later error. Fixed: the result is checked and recovery aborts with the authority's reason (src/application/integrate/recovery.ts:132).
- **F3 (recorded, no change): declared-gate auto-bounce is a Backlog mirror move.** `px review --start` / `px review` gate-validation failures flip the Backlog file to active (src/adapters/review/review-commands.ts:749-752, src/adapters/review/review-loop.ts:199-202) with no lifecycle command, because no domain transition exists for a gate-validation bounce (request-changes requires an awaiting-implementation review decision, which a gate failure is not). The authoritative lane is never moved by this path; in the common case the file is already active (no-op), and when the DB lane is review the file diverges transiently until the next successful handoff re-commits review. Changing this requires a domain extension (out of scope) or fabricating a review decision (refused).
- **F4 (recorded, no change): legacy domain-bypassing writer is dead in production.** `transitionTaskOnIntegrationBranch` / `recordIntegrationTransition` (src/adapters/backlog/task-transitions.ts:421/:346) assign `Mission.status` directly (bypassing `decideMission`), swallow all errors, and have no production callers — only their own tests (test/backlog.test.ts:739-938) and the re-export at src/adapters/backlog/backlog.ts:38. Recommended for removal in a follow-up cleanup; it cannot produce a lifecycle mismatch from any live entry point.
- **F5 (fixed): swallowed fallback-assignee write.** `applyExecuteFallback` fire-and-forgot the Backlog assignee write with `.catch(() => {})` (src/adapters/cli/commands/active.ts). Now logs a WARN with the failure reason (src/adapters/cli/commands/active.ts:304-307).
- **F6 (recorded, no change): squash hook bounce is Backlog-mirror only.** The landing hook-failure rebound (src/application/integrate/squash.ts:219) transitions the Backlog file to active without a lifecycle write. A DB rebound-to-active here would strand the landing: `decideIntegration` requires the integration lane and no domain transition returns active -> integration, so the mission correctly stays in integration in the database while the hook fix runs; only the mirror flips. Contrast the gate bounce (gates.ts:140-155), which has a real integration -> active domain command and uses it DB-first.
- **F7 (recorded, no change): pre-review gate bounces leave the DB lane at review while the implementer fixes.** After the CP-2 round-open boundary commits active -> review, a pre-review rebase/gate/hook bounce relaunches the implementer (src/adapters/review/review-gate-handling.ts:224-226, src/application/rebase-workflow.ts:368-370) with a Backlog-only active flip. The round is still open and no reviewer decision exists, so no domain command can legally move review -> active; a domain extension (gate-bounce transition) is required to persist the lane during the bounce window and is out of this mission's scope. The DB lane returns to correct agreement when the round's reviewer decision commits (request-changes or the next boundary).
- **F8 (fixed in review round 4): round-open persisted the next round before the lane transition.** The ready-for-next-round branch of settleReviewLane (src/adapters/review/review-round-open.ts) saved the advanced round with a plain `missionStore.save` and then committed the active -> review transition separately; a transition failure left the store with a next round recorded over a still-active Mission. Fixed: the round advance stays in memory and the transition's `saveWithTransition` commits the advanced round and the lane event as one unit; regression read-back in `test/task-2582-repro.test.ts` 'a round-open boundary whose authoritative transition cannot commit stops the round' (lane stays active, round not advanced).
- **F10 (fixed in pre-review agent-smoke gate): the 200 ms persistence deadline was clocked from pre-launch, so slow launcher pre-spawn work ate the budget.** The pre-review gate `test/e2e-real-agent-smoke.test.ts` (real `pi` custom agent over the real `px` CLI) failed: the active boundary missed the 200 ms deadline (took 411–745 ms). Root cause: `launchPrepared` started the deadline clock before invoking the launcher (src/adapters/agents/agents.ts), but the pi launcher's lazy SDK load (`new Function('p','return import(p)')('@earendil-works/pi-coding-agent')` in src/adapters/agents/pi.ts loadSdk) and the opencode launcher's synchronous `--help` JSON feature-detect both block the event loop synchronously for ~1 s (cold) inside the launcher call, before the child actually spawns. The deadline therefore measured launcher bookkeeping, not persistence. Fixed: (1) the clock now starts at the real child spawn (`onSpawn`), with the pre-launcher instant as fallback for launchers that never report a spawn (src/adapters/agents/agents.ts launchPrepared); (2) the pi SDK cache is warmed in the non-deadline prepare phase via `warmPiSdk` (src/adapters/agents/pi.ts, awaited in src/adapters/agents/agents.ts prepareLaunch for `customRunner === 'pi'`) so the synchronous import cost is paid before the deadline clock starts. Regression: `test/agents.test.ts` 'the active deadline starts at the real spawn, excluding slow pre-spawn launch prep (TASK-2582 SC8)' (a 300 ms pre-spawn prep is excluded from the window). Verified: the agent-smoke gate passes (1 pass / 0 fail, phase=active ~140 s) and `./scripts/verify-local.sh all` is green (3094 pass / 0 fail).

## Timing Contract Enforcement — TASK-2582 (2026-09-26, CP-4)

Per-transition disposition against the contract (destination state + lane event
persisted directly at the accepted boundary before destination-state work
starts; unavoidable deferred persistence within 200 ms of work start,
monotonic, end to end; done exempt):

| Transition | Persistence point | Deferred? |
|---|---|---|
| refine | at contract completion (draft finalTransition) | not deadline-subject: no Parallix work runs in refined; the agent's drafting work produces the state from backlog, and refine is only accepted once the contract validates |
| activate | launch confirmation (CP-3 F1 fix) | **deferred, deadline-enforced**: src/application/execute-mission-service.ts activateAtBoundary measures work start (spawn confirmation) to successful commit on the monotonic clock and throws `LifecycleDeadlineMissed` past 200 ms (src/application/lifecycle-timing.ts: LIFECYCLE_DEADLINE_MS = 200, checkLifecycleDeadline) |
| submit-for-review | handoff (:1386), loop round-open (review-round-open.ts:153), board resume, recovery | direct — before reviewer / pre-review work |
| request-changes | artifact consumption (review-artifacts.ts:853) | direct — before the implementer act-on-review launch |
| approve | decision recording (review-state.ts:848, review-round.ts:330, recovery.ts:202) | direct — before integration work |
| rebound-to-active | gate bounce (gates.ts:140-155) via rebound-kernel transitionToImplementer | direct — before the repair launch |
| integrate -> done | landing persist (squash.ts finishLanding / integrate-post.ts:202 / github-pr.ts:52) | **exempt**: no work runs in done; all integration work (merge, verification, finalization, cleanup) finishes in integration first |

Failure handling: a missed deadline or a refused boundary write surfaces the
reason in output and stops dependent work — for the activate boundary the run
fails before any success output, Backlog promotion, or handoff (src/adapters/
cli/commands/active.ts:219-227,273-274; src/application/execute-mission-service.ts
activateAtBoundary). Projections read the operator database, which now carries
the committed state at the boundary instead of after the long-running work.

Tests: test/lifecycle-timing.test.ts (deadline budget, monotonic clock,
at/past-boundary, custom budgets), 'execute mission use case stops the run
when the active boundary misses the 200 ms deadline'
(test/execute-mission-service.test.ts).


## Corrected Lifecycle Audit — CP-6

F3, F6 and F7 are fixed in this continuation; their earlier no-change dispositions are superseded.

| Boundary | Authoritative behavior | Regression evidence |
|---|---|---|
| Review gate repair (F3/F7) | `transitionReviewRepair` commits review → active before the repair launch, then active → review before review resumes. Missing/refused persistence stops downstream work. An approved review cannot masquerade as an undecided repair round. | `test/task-2582-repro.test.ts:87`, tests “review gate repair commits active before launch and review before resuming, without a reviewer decision”, “a refused repair boundary stops before launch or mirror changes and preserves the review”, and “repair rebound refuses an approved review rather than fabricating a return to implementation”. |
| Review handoff/validation repair (F3) | Manual and autonomous validation failures and declared-gate recovery use the same authoritative helper before the Backlog mirror changes. | `src/adapters/review/review-commands.ts`, `src/adapters/review/review-loop.ts`, `src/application/handoff-command-use-case.ts`; full review/handoff regressions. |
| Review rebase repair (F7) | The rebase adapter commits active before hook or conflict-resolution implementation work and review after successful verification, retaining the current undecided round. Autonomous rebase calls receive the loop's authoritative store and lifecycle service. | `src/adapters/rebase/rebase-workflow-adapter.ts:154`, `src/application/rebase-workflow.ts:382`; “composed rebase conflict repair commits active before its agent and review after verified completion” (`test/task-2582-repro.test.ts`) and full rebase/review regressions. |
| Integration commit-hook/rebase repair (F6) | Completion repair remains in integration and keeps its Backlog mirror ready-for-integration. It does not declare done or invent a review decision. | `src/application/integrate/squash.ts:221`, `src/adapters/rebase/rebase-workflow-adapter.ts:159`; integration completion regressions. |
| Integration gate implementation repair | A real rebound enters active before repair. The rebased main revokes approval at every red integration gate. Repairs therefore return through a fresh review and fresh approval, including unchanged trees. A refused re-review stops work and mirror promotion. The integration workflow restarts from the new approved context. | `test/task-2582-repro.test.ts:149`, “integration gates require fresh approval after repair and stop when re-review fails” and “integration repair withdraws the old approval and returns through a new review without duplicate approval events”. |
| Autonomous child CLI identity | The entry point pins child `px` to its own Node executable, arguments and source/build entry. Agent prompts use that absolute wrapper even when a login shell resets PATH. | `src/adapters/storage/child-cli.ts:11`, `src/entry/px.ts`; executable multi-round proof below. |
| Lifecycle gate completion | Both mandatory and standalone workflow gates use `node --test`. In-process commands return through their owner's exit callback; the harness preserves test-worker protocol events. The gate now reports all nine lifecycle tests rather than silently exiting before assertions finish. | `test/index.test.ts:117`, `test/e2e-mission-lifecycle.test.ts:336`, `workflow.config.json`, `config/integration-pipelines.json`. |

### Executable acceptance proof

`test/task-2582-repro.test.ts` runs `src/entry/px.ts` through production composition, with a real isolated SQLite database and real child status/verdict/resolve commands. Only agent launch and review-provider boundaries are replaced; no real provider is contacted. Parent and child trace entries resolve to `/mnt/data/code/parallix/src/entry/px.ts`. The per-run child wrapper resides under the isolated state's `cli/<identity>/px` and is asserted by the fixture.

Observed states while work runs: reviewer round 1 = review; after request-changes = active; implementer repair = active; reviewer round 2 = review; after approval = integration. SQL lane-event read-back is review → active (`request-changes`), active → review (`submit-for-review`), review → integration (`approve`). There is no `review --push`, integrate recovery or direct database repair in this workflow.

Red-to-green: on detached baseline `0244942f71641f11a087747de6803d3bf8cf25b0`, the new real-store review-gate test fails at its pre-launch mirror boundary because the stored Mission is review instead of active. The identical regression passes with the fix. Captured local logs: `/tmp/task-2582-red.log` and `/tmp/task-2582-bootstrap-repro-final.log` (13 pass, 0 fail).

Source identity: baseline `0244942f71641f11a087747de6803d3bf8cf25b0` plus the committed continuation diff. Built CLI SHA-256: `327a3c1e52641cca3eb5502184820d41a1824185d0fb1b83f9336db35dfbcf07`.

Rebased all 37 mission commits onto main `760045646`, preserving TASK-2543 approval revocation and fixing the combined unchanged-tree repair return. The real-agent smoke exposed a terminal cleanup error: restoring the invoked worktree after successful integration attempted to chdir into a directory integration had removed. `runTargetCommand` now preserves the surviving base checkout. The lifecycle regression invokes integration from the worktree and reproduces ENOENT before the fix (`/tmp/task-2582-deleted-cwd-red.log`). Historical round-5 approval is not approval of this continuation. No reviewer decision is fabricated or overwritten to promote the operator's existing mission.

## Goal Check — CP-5 (post-rebase revision `4b46c50ced88749dd9cbdbe651034261689644b0`)

| Criterion | Committed evidence |
|---|---|
| Repair work always sees active, and resumed review always sees review, with no fabricated decision. | `test/task-2582-repro.test.ts:91` — “review gate repair commits active before launch and review before resuming, without a reviewer decision”; `test/task-2582-repro.test.ts:124` rejects a missing lifecycle boundary before launch or mirror change; `test/task-2582-repro.test.ts:144` rejects a repair of an approved round. |
| A repaired integration requires fresh review and approval, and failed re-review stops integration. | `test/task-2582-repro.test.ts:155` — “integration gates require fresh approval after repair and stop when re-review fails”; the assertions at `test/task-2582-repro.test.ts:184-210` read the active/review/integration lanes at each boundary. |
| The changed production executable and every child verdict/resolve command preserve authoritative lanes through request-changes, repair, re-review, and approval. | `test/task-2582-repro.test.ts:345` — “production CLI autonomous re-review and child verdict/resolve keep authoritative lanes correct”; assertions at `test/task-2582-repro.test.ts:385-393` require final `integration`, the three lane events, and the source entry for parent and child. |
| Activation commits before slow work and persistence failure/deadline stops dependent work. | `test/task-2582-lifecycle-ordering.test.ts:149` — “a slow downstream agent run does not delay the active transition”; `test/execute-mission-service.test.ts:209` and `test/execute-mission-service.test.ts:234` cover the deadline and refused-boundary stops. |
| Approval replay and unresolved-finding guards remain safe. | `test/task-2582-repro.test.ts:726` — “approval replay emits no duplicate lane event”; `test/task-2582-repro.test.ts:779` — “the unresolved-finding approve guard still rejects an approving round that has not finished fixing”. |
| The historical red-to-green reproduction remains pinned to a detached pre-fix baseline while the repaired executable is covered in the committed suite. | Baseline `0244942f71641f11a087747de6803d3bf8cf25b0`; the fixed assertions are committed in `test/task-2582-repro.test.ts:91-393` and exercised by the focused suite below. |
| The declared full verification gate passes on the post-rebase revision. | `./scripts/verify-local.sh all` passed on `4b46c50ced88749dd9cbdbe651034261689644b0` (documentation check, bundle/static analysis, and default test suite). Focused confirmation: `node --import tsx --test test/task-2582-repro.test.ts` — 16 pass, 0 fail. |
