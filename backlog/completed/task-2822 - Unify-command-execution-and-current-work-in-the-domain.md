---
id: TASK-2822
title: Unify command execution and current work in the domain
status: done
assignee: [codex]
created_date: '2026-10-26'
labels:
  - bug
  - ai_sdlc
dependencies: []
references:
  - src/domain/workflow-operation.ts
  - src/application/workflow-operation-service.ts
  - src/application/recording/execution-activity-recorder.ts
  - src/domain/execution-activity.ts
  - src/application/projections/workflow-board.ts
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Deliver one cohesive replacement of the competing workflow-operation and
current-work models. Put the meaning and valid transitions of command execution
and activity in the domain; make currentWork a projection of that execution,
not a second operational authority. Preserve useful durable admission,
deduplication, exclusive ownership, stop, recovery and write fencing. Preserve
the automatic workflows that already work. This is implementation and removal
in ONE Mission, not a migration wave spread across later Missions.

The operator's central concern is that previous cleanups added unnecessary
blockers, compatibility paths and recursive repairs, leaving the operator to
spend many subsequent Missions restoring ordinary automatic behavior. A larger
enum, more refusals, a new generic framework, or renamed duplicate machinery is
not delivery. DELETE superseded code and migrate every production caller in
this Mission. Leaving old unupdated code for later agents is an explicit failure.

### Operator decisions; do not reopen or silently reinterpret

1. Mission lifecycle, execution lifecycle and execution activity are different
   dimensions of one coherent domain model. Mission remains the authority for
   lifecycle; Review remains the authority for review rounds and judgments.
   The substance of currentWork belongs in the domain. OS observation, capture,
   publication and persistence are mechanisms, not competing domain policies.
2. The execution use case owns starting AND continuing execution. Its checked
   start runs before expensive preparation; the worker continues that accepted
   execution. Generic workflow admission must not independently activate and
   roll back the Mission and then have execution repeat those decisions.
3. There is NO 200 ms target in this Mission. Do not add a timing gate,
   benchmark project or broad startup optimization. Prove ordering: meaningful
   stage-entry transitions precede expensive preparation, Git work, gates,
   provider-capacity waits, prompt construction and agent launch. Cheap request
   validation and the required atomic authoritative writes still apply.
4. Handoff may remain an INTERNAL grouping for preparing a change for agent
   review. From the operator's perspective that work belongs to REVIEW. Do not
   expose handoff as a Mission lane, invented middle state, separate operator
   action or required manual ceremony.
5. If agent review cannot start because implementation or testing evidence
   needs repair, move the Mission back to ACTIVE. Prefer recording concrete
   additional checkpoint work through the existing checkpoint owner so the
   implementer knows what to fix. Infrastructure, credentials, availability or
   other human/mechanism-only problems must not manufacture implementer work.
6. Integration is the HUMAN review stage. A human request for changes follows
   integration -> active -> agent review -> integration, retaining the same
   Mission/change history. Review entry from integration is valid; remove
   duplicate policy authorities, not this behavior. Review never implies merge.
7. Assume NO operations are running when this Mission is applied. No support
   for concurrent old/new workers, compatibility wave, dual writer, legacy
   runtime implementation or fallback importer is required. Do not add a
   mandatory idle-proof check, upgrade blocker or new operator ritual either.
   Preserve valid stored history and use the existing migration mechanism only
   where the chosen persisted contract actually changes.
8. Removing obsolete code is a PRIMARY DELIVERABLE. All production writers,
   readers, callers, contracts and tests must move together. Do not defer
   deletion to another Mission or retain a deprecated implementation behind a
   new facade, alias, cast, feature flag or default fallback.
9. Preserve and improve automatic completion. This Mission does not authorize
   new operator acknowledgments, permissions, verification gates, required
   artifacts or refusal conditions to make the redesigned model easier to code.

### Evidence gathered before creating this task

Investigation baseline: f63d9d763 on human-review-missions, 2026-10-26.
Paths and symbols below are investigation anchors, not a permanent architecture
inventory. Recheck them against the implementation parent before editing.

| Finding and confidence | Executable source / consequence |
| --- | --- |
| Confirmed by a pure-function probe: live admission publisher masks worker updates under the SAME operation ID. | `projections/current-work.ts: resolveOperation` skips a running publication whenever the standing publisher is another live process, without first distinguishing a different operation. A live web publisher's preparing message survives a worker's later review-response publication. |
| Confirmed by a pure-function probe: a nested terminal publication sharing the parent ID clears standing parent work. | The same resolver accepts an ended event with the standing operation ID. `recording/current-work-recorder.ts: append` replaces publication IDs with `authorizedOperationId()`. Source trace establishes the shared-ID path; preserve nested completion without granting the child parent settlement authority. |
| Confirmed by pure-function probes: uncertain stopping ownership hides operator attention and replaces a blocked activity display. | `projections/workflow-board.ts` filters every owned Mission out of attention and synthesizes currentWork even for stopping. `projections/mission-activity.ts: projectWork` then prefers that work over blockingReason. The probe returns working/unknown, coordinator stopped, and an empty attention queue. |
| Source-confirmed duplication: two activation and pre-launch rollback owners. | `WorkflowOperationService.accept/compensate` and `ExecuteMissionService.execute/synchronizeLifecycle/failedExecution` both do this. The worker sees already-active state while outer admission retains the original refined state. Move behavior, do not merely delete rollback. |
| Source-confirmed duplicate eligibility authority. | `WorkflowOperationService.boardAdmissionEligibility` checks `workflowEligible`, then `availableBoardCommands`, with an integration-review exception. Execution still reaches domain/use-case guards. A board projection must not be the application's admission policy. |
| Source-confirmed lossy activity feedback. | `CurrentWorkRecorder.append` forwards phase/summary to authorization progress for running, ended AND blocked; it does not forward the state. `WorkflowOperationService.progress` maps handoff/review/integrate to checking and uses sticky providerStarted for other phases. The board overwrites original activity with that interpretation. |
| Source-confirmed command/payload mismatch. | `controller/board-command.ts` models handoff:record as an NEL payload. `BoardCommandController.dispatchHandoff` runs the full review workflow and does not pass those measurement fields. Existing payload-survival tests stop at dispatcher doubles, not the final handler. |
| Source-confirmed NEL double write; concurrency consequence needs retained reproduction. | `MissionHandoffService.recordNel` first saves the updated aggregate with its expected version. The production `_recorder` is the same store; `SqliteMissionStore.recordNel` then UPDATEs the same scalar without an expected version. It does not save the richer report its comments imply. A second write must not overwrite a newer measurement or claim absent report persistence. |
| Source-confirmed first-review boundary risk. | `HandoffReviewSubmission.submit` currently creates/binds Review only after verification and captures real HEAD. `review-repair-lifecycle.ts` currently requires a Review to exist. Early review preparation may precede the FIRST Review; do not fake a round, revision, reviewer or gatesPassed to force that path through. |
| Source-confirmed projection composition risk. | `BoardProjectionBuilder.observeExecution/observeCardExecution` already project ownership; `composition/workflow-operations.ts: attachWorkflowOperations/observeWorkflowOperations` wrap board projection again. `board-subscription.ts: boardFingerprint` currently omits command availability and the ownership object. Removing the masking currentWork overlay must not stop action/Stop changes from reaching subscribers. |

Probe scope: actual production pure functions with isolated synthetic input;
no real Mission, provider, database or statistics were mutated. These probes
are evidence of the stated behavior, not retained regression tests or a claim
that production lifecycle checks have run. Retain focused parent-red/fixed-green
cases in the owning suites during implementation. Do not label an untested
concurrency or subprocess hypothesis a reproduced production bug.

### Required model and responsibility boundaries

- Define the smallest domain execution/activity model supported by real
  commands and consumers. One accepted top-level execution can span preparation,
  waiting, several agent launches, review and repair. Reuse AgentRun identity
  for actual launches. Do not invent Attempt, durable Process, another workflow
  aggregate alongside the replacement, or an event-sourcing framework.
- Separate execution ownership/settlement, actual activity and observation
  certainty. Retained ownership is not proof an agent is working; an unavailable
  liveness probe is not proof of death; stale/missing progress is not permission
  to release ownership. A previously started provider is not proof it is still
  executing. Do not merge these facts into an ambiguous phase field.
- Domain rules are pure and checked. Application ports carry typed intent and
  observed facts. Adapters validate external/storage inputs and supply process
  identity/liveness; the domain imports no SQL, process globals, argv parser,
  filesystem or application/presentation module.
- Use one business admission/transition owner. CLI, web, TUI and lead derive
  action availability from that policy; the application does not consult the
  rendered board to decide whether a command is legal. Admission, worker
  continuation and resumed execution must agree without hardcoded exceptions
  copied into each surface.
- Keep authoritative acceptance, initial activity and applicable stage-entry
  transition atomic. Preserve expected-version and stop-vs-write protection.
  No transaction spans process launch, Git, gates, providers, prompts or network
  I/O. Diagnostic output/capture remains distinct from authoritative state;
  unavailable optional metadata must not become a new execution prerequisite.
- Start/continue must preserve the original activation outcome and pre-launch
  failure behavior without a second rollback owner. No-agent-started failures
  must not undo unrelated/newer work; resumed active executions must not revert
  to refined. After real work starts, do not claim rollback of external effects.
- Keep request identity, execution identity, worker ownership generation and
  per-provider run identity distinct where their contracts differ. Duplicate
  requests join the accepted execution; competing commands do not launch twice.
  A nested agent may record its assigned evidence/verdict without acquiring
  authority to stop, settle or recursively start its parent's lifecycle.
- One projection combines the domain execution/activity with bounded observed
  liveness. currentWork may remain a transport field, not an independent state
  machine. Remove the current publication -> guessed workflow phase -> replaced
  currentWork feedback path and duplicate projection wrappers.
- Authority must not depend on the admission/web process remaining alive.
  Authorized worker activity updates take precedence for the accepted execution;
  nested completion restores/continues parent activity, and late superseded
  events cannot clear or block a replacement execution. Preserve deterministic
  ordering and isolation under equal timestamps, PID reuse and host restart.
- Ownership controls conflicting mutations and Stop availability. Actual
  activity, failure evidence and uncertainty control attention. A genuine
  human-only or uncertain-stop condition remains visible without force-enabling
  active/review/integrate or letting lead dispatch an ineligible action.
- Preserve actual provider counts, capture correlation, terminal replay,
  explicit family pinning, fallback family attribution, configured credentials,
  mission/base checkout selection, foreground Ctrl+C semantics and independent
  execution after browser/host disconnection. Generic cleanup must not regress
  these existing contracts or count coordinators as providers.

### Review preparation, failure handling and NEL

Begin review preparation through its existing application review owner and
record entry to the review stage before expensive preparation. An unfinished
preparation is not a submitted Review, passed verification or an approval.
Support the first review with no round yet as well as resubmission and human
change requests. Bind actual Review subjects to the committed revision only
when that evidence exists; preserve prior round judgments, times and subjects.
Do not move gate results earlier, forge gatesPassed, create placeholder review
rounds, invalidate approval without authority or bypass reviewer independence.

| Observed condition | Required behavior |
| --- | --- |
| Implementation, missing/invalid testing evidence or another implementer-actionable defect prevents review starting. | Record the real cause, return to active through the lifecycle owner and make the repair available to the existing bounded automatic path. Prefer an honest durable repair/planned checkpoint through its existing owner. This is work, not a new manual prerequisite. |
| Same failure is retried or replayed. | Reuse the incident/work item where appropriate; no new checkpoint on every poll or command retry, no evidence fabrication, no duplicate lane events, no recursively replenished recovery budget. |
| Network/credentials/provider capacity, a routine mechanism repair or another problem requiring no implementation/evidence changes. | Preserve existing automatic wait/failover/mechanism-repair behavior. Do not dispatch an implementer or fabricate a repair checkpoint. If existing recovery is exhausted or genuine human action is required, retain the actual diagnostic visibly in review. |
| Human-only locked-contract or authority decision. | Preserve the existing human boundary and provenance. Do not silently acknowledge it, rewrite success criteria, manufacture evidence or launch an agent to decide it. |
| Unknown diagnostic or incomplete optional observation. | Keep the existing conservative policy and uncertainty visible. Do not introduce a blanket new human stop or call a routine error infrastructure merely to escape implementing recovery. |

Inspect `RepairCheckpointService`, `MissionCheckpointService`, the rebound
kernel and the typed failure-classification owners BEFORE adding anything.
The existing repair contract is gate-specific; do not encode arbitrary review
preparation as a fake gate command just to reuse it. Prefer an existing planned
checkpoint when that is the truthful contract. Add a narrow typed extension
only if a concrete supported failure cannot be represented. Checkpoint creation
must not itself become a new unrelated gate on otherwise supported recovery.
Preserve actual required checks, budgets and operator-owned gate configuration.

Remove the conflation of handoff:record, starting review and recording NEL.
Move real callers to the existing review entry and a measurement-specific
operation as appropriate; migrate schemas, validation, capability checks,
browser requests, CLI/automatic callers and tests together. Do not retain a
handoff:record compatibility alias or silently accept-and-ignore its payload.
Do not expand this into a broad review CLI redesign or reintroduce retired
start/continue flags.

NEL remains the existing Mission measurement unless demonstrated consumers
require more; this task does not authorize a new NEL entity/table or analytical
pipeline. Trace all callers of MissionNelRecorder and retire its duplicate
scalar write/report fiction if its production contract is already met by the
Mission save. Preserve real measurement calculation, prediction and consumers,
return truthful persistence evidence, and do not alter statistics definitions
or invent persisted artifacts/times/round metadata. Keep separate behavior
only when an actual caller needs a distinct contract.

### Removal and scope guardrails — required delivery, not optional cleanup

1. Before editing, trace actual production entry points through domain, use
   cases, stores, inherited child authorization and projections. Record a short
   caller/owner/removal map in Mission evidence, not live documentation.
2. Replace the model rather than adding a third one. All currentWork writers
   participate, including draft, active, review, integrate, nested repair,
   recovery and lead. A writer outside exclusive execution ownership still
   needs an explicit valid contract; do not invent a global lock that prevents
   routine child evidence, short read commands or independent Missions.
3. DELETE superseded state machines, policy copies, projection overlays,
   recorders, ports, re-exports, adapters, helpers, unused fields, old request
   payloads, aliases, configuration/environment wiring and redundant tests.
   Trace each before removal; retain distinct behavioral assertions in their
   correct owning suites. A renamed old implementation is not deletion.
4. No deprecated runtime path, conditional old/new fallback, compatibility
   mapper, legacy file import, dual writer, feature flag, facade forwarding to
   old behavior, or TODO to finish the cutover later. Historical immutable SQL
   migrations and real retained history are not obsolete runtime code; preserve
   checksums and use a forward migration only if needed. Do not delete data to
   make the replacement appear complete.
5. Search the final tree for retired symbols, imports, command kinds, fields
   and wiring. Classify every retained reference as necessary history/migration
   or an actively used new contract. Demonstrate that production composition
   uses the replacement. No broad allowlist or architecture-test deletion to
   hide remnants; no source-string-only test as proof of runtime correctness.
6. ZERO speculative new blockers. Every newly introduced refusal or human stop
   needs an existing required invariant or concrete observed human-only need,
   plus a regression explaining why the supported automatic path cannot proceed.
   Optional telemetry, stale progress, naming mismatch, absent historical
   artifacts and routine recoverable preparation are not new prerequisites.
7. Do not weaken existing safety to avoid stops either: preserve real domain
   prerequisites, expected-version writes, identity-checked stop, uncertain
   termination protection, evidence integrity and human approval/merge authority.
   If an actual requirement conflicts, present the concrete conflict rather
   than silently adding a stop, bypass or repair loop.
8. No new verification gates, operator confirmations, CPU-budget increases or
   retry-budget resets. Preserve removed gates as removed. No live provider,
   Mission, database or statistics mutations during implementation rehearsal.
9. Stay within existing ports-and-adapters principles and composition authority.
   This task authorizes the domain consolidation discussed with the operator,
   not a change of architectural principles. A genuine principle change still
   requires the repository's explicit subsequent operator decision.
10. Keep production files within 500 lines and test sources within 1,000 lines
    under repository rules. Use cohesive contracts, not mechanical file shards,
    new size exemptions or a generic framework to make the diff look smaller.

### Verification and risk closure

Extend the existing owning suites before inventing a new one. Relevant search
anchors are workflow admission/execution contracts, current-work reconciliation
and publication, attention/action projection, child authorization, SQLite
ownership/identity, process interruption/restart, review submission/repair and
NEL measurement contracts. These anchors are not a second test inventory;
discovery and the category registry remain authoritative.

Retain parent-red/fixed-green reproductions for the confirmed publication and
attention defects. Prove the real handler's command/payload contract, not just
that a dispatcher double received it. Reproduce the suspected NEL concurrent
overwrite in isolation before claiming it fixed. Check first-review preparation
without an aggregate, replay after each partial write and atomic failure paths.
Use barriers/doubles for expensive boundaries; do not sleep through whole gates.

The final behavioral evidence must cover:

- An ordinary CLI and web execution starts, enters the appropriate stage before
  held expensive preparation, launches an agent and completes automatically.
  Worker startup does not repeat activation. No 200 ms assertion is required.
- Review preparation is in review; implementer/evidence defects return to active
  with concrete repair work, then independently reviewed work returns to human
  integration. First review, existing rounds and human-requested changes work.
- Infrastructure/capacity cases follow existing wait/failover/mechanism recovery;
  actual human-only cases remain visible. Same incident does not multiply
  checkpoints or restart budgets. No operator work is invented for routine cases.
- Live web publisher plus live worker, same-parent child completion, late old
  terminal events, equal timestamps, publisher death/PID reuse, host restart,
  duplicate requests/workers, competing CLI/web commands, and stop-versus-write
  races preserve identity, activity and exclusive execution correctly.
- Uncertain stop is visible and prevents unsafe replacement. Genuine live work
  does not cause duplicate lead launches. Human/manual attention is representable
  without force-enabling invalid executable actions or auto-merging.
- Board, focused status, TUI, web snapshots/SSE and lead agree. An ownership-only
  or action/Stop availability change reaches subscribers after removal of the
  synthesized currentWork workaround. Read-only observation never recovers work.
- Pinning/fallback attribution, provider counts, owned terminal replay and real
  mission/base checkout selection retain their contracts.
- Valid persisted history remains readable after the one-shot cutover; fresh
  execution uses only the new owner. No compatibility implementation survives.
- NEL is written once through the checked owner, retains real consumers and
  cannot overwrite a later measurement through an unversioned second write.

Read ADR 0057. Use unit doubles for policy/state rules and existing adapter
integration suites only for genuine process/SQLite/HTTP boundaries. Unit tests
must satisfy the repository's 500 ms headroom requirement; no new or modified
integration case/suite may exceed 3.5 seconds. Respect category ownership,
finite CPU budgets, cleanup on failure/timeout/signal and operator-owned gates.
Do not run full gates merely because this is a large Mission; run focused
contract checks and let the normal Parallix lifecycle run its configured gates.
Do not edit CI/gate configuration to make this Mission pass.

The implementer MUST manually exercise the production CLI/web lifecycle in a
disposable repository and isolated operator database/configuration. Hold real
preparation boundaries to inspect committed state, then exercise automatic
review/repair, a human-only blocker and stop/restart. Use safe agent/provider
doubles where real traffic or statistics would be affected, and state exactly
what they prove; a double does not certify model behavior. Use the existing
browser/lifecycle rehearsal owners rather than creating a new test framework.
Record exact tree, commands, actual results and limitations in Mission evidence.
No green claim based solely on unit mocks or unavailable tooling.

Authoring environment limitation: the installed Backlog.md native CLI cannot
start on this macOS host (missing ___ulock_wait2); this task was written in the
repository's normal Backlog.md format. The earlier tsx/esbuild probe also failed
on _SecTrustCopyCertificateChain. Pure-function investigation succeeded with
Node type transformation and an in-memory import resolver; that is NOT official
runner/headroom/package certification. Do not fix toolchains, weaken tests or
mark unavailable verification passed as part of this Mission.

Related work: TASK-2821 canonical Review phases/legacy-import removal is present
in the investigation parent; preserve it. TASK-2810 overlaps review entry naming;
do not reintroduce its removed modes. TASK-2799 and TASK-2814 describe adjacent
attention/action defects; preserve their distinct human-only and executable
recovery contracts, record any overlap actually resolved, and do not silently
close or absorb their unrelated work. TASK-2818 owns statistics definitions.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria

<!-- AC:BEGIN -->
- [x] #1 One coherent domain execution/activity model replaces the competing workflow-operation/current-work authorities. Domain transitions are checked; currentWork is a projection; Mission and Review retain their existing business authority. No invented Attempt/Process entity or third state machine is introduced.
- [x] #2 Execution use cases own start and continuation. Acceptance, initial activity and applicable lifecycle entry commit atomically before expensive preparation; worker startup does not repeat activation. Pre-launch compensation has one owner and cannot undo newer or resumed work. No numeric latency gate is added.
- [x] #3 Review preparation belongs to the review stage without a handoff lane, fabricated Review/HEAD/reviewer/approval or prematurely passed gates. First review and resubmission preserve actual evidence and independent reviewer selection.
- [x] #4 Implementer-actionable review-start failures return to active with the real cause and concrete repair work through existing owners; infrastructure/capacity retains automatic recovery and human-only failures remain visible. Retry/replay does not multiply checkpoints, reset budgets or create new manual prerequisites.
- [x] #5 Human-requested changes from integration complete the active -> agent review -> integration cycle with retained Mission/change history. Review entry never grants approval, merges or bypasses human integration authority.
- [x] #6 One business eligibility/transition owner serves admission, execution and UI action projection. The application does not consult board rendering or maintain a copied eligibility switch; the legitimate integration-review continuation remains supported.
- [x] #7 Retained parent-red/fixed-green regressions prove worker activity is not masked by a live admitting host, nested completion cannot settle its parent, and late superseded publications cannot clear or block current work. Equal-time, liveness and restart behavior retain their contracts.
- [x] #8 Ownership no longer manufactures working activity or removes genuine blockers/uncertain stops from attention. Board/status/TUI/web/lead agree on activity, certainty and valid actions; human-only items do not require an invalid executable action. Subscriber fingerprints include the user-visible consequences of ownership/action changes.
- [x] #9 Request replay, competing commands, duplicate workers, transaction failure, stop-versus-write, stale generations, PID reuse, uncertain termination and inherited child authorization preserve existing concurrency guarantees without adding speculative stops or operator acknowledgments.
- [x] #10 handoff:record no longer conflates starting review and recording NEL. Real callers, wire validators, capabilities and command handling use meaningful distinct contracts; no accepted payload is silently ignored and no deprecated compatibility alias remains.
- [x] #11 NEL retains its existing Mission meaning and consumers with one checked persistence owner. The redundant unversioned scalar/report path is removed after a focused reproduction; returned evidence describes what was actually saved. No new NEL entity, statistics definition or analytical pipeline is introduced.
- [x] #12 Existing ordinary automatic execution, preparation, repair, waiting/failover and review completion remain automatic. Every added refusal is justified by a real existing invariant or observed human-only need; optional progress/history metadata and internal inconsistencies cannot become new operator work. No additional gates, approval rituals or retry budgets are introduced.
- [x] #13 PRIMARY DELIVERABLE: all superseded implementations, policy copies, projection overlays, old recorders, ports, types, fields, adapters, exports, aliases, payloads, wiring and redundant tests are deleted after caller migration. Final evidence identifies migrated callers and proves remaining references are necessary history/migrations or actively used new contracts. Unreachable old code, forwarding facades and deferred cleanup fail acceptance.
- [x] #14 One-shot cutover assumes no running operations, preserves valid durable data/history and uses only necessary forward migrations. No mixed-version worker support, dual writer, legacy runtime/importer, idle-proof gate or upgrade ceremony remains.
- [x] #15 Production CLI/web/TUI/lead, nested recovery, child evidence/verdict writes, terminal replay, explicit family pinning/fallback, provider counts and mission/base checkout routing all use the replacement and retain their distinct behavior. Pure observation performs no recovery or mutation.
- [ ] #16 Focused owning suites retain distinct assertions, show real bug red/green evidence and meet repository headroom, isolation, cleanup, size and 3.5-second integration limits without gate/category/budget weakening. Actual-handler and boundary cases complement policy tests; mocks alone do not certify composition.
- [x] #17 Manual production CLI/web lifecycle rehearsal in disposable Git/database/configuration state demonstrates stage-entry ordering, ordinary automatic completion, repair classification, human-only attention and stop/restart. Evidence states exact tree, commands, doubles and limitations; real operator state/statistics/providers remain untouched.
- [x] #18 Help and concise live docs reflect supported stage/activity behavior and removed public concepts. Required architecture descriptions are corrected without adding a second implementation/test inventory. No known in-scope duplicate owner, removed-path caller or unresolved behavior is deferred to another Mission; unavailable verification stays explicitly pending.
<!-- AC:END -->

## Definition of Done

<!-- DOD:BEGIN -->
- [ ] #1 Verification gate ran and passed on the final tree with captured proof rather than an unverified claim
- [ ] #2 Lint and static analysis report clean on every changed file
- [x] #3 No focused or unannotated skipped tests were introduced (no .only and no bare .skip)
- [x] #4 Final checkpoint Goal Check table cites real evidence using file:line references and test names
- [x] #5 Docs updated to reflect any workflow or user-facing behavior change
- [x] #6 Bug-labeled missions include a red-to-green reproduction test that fails before the fix and passes after
- [x] #7 Superseded code and redundant assertions are removed, every real caller uses the replacement, and no compatibility path or deferred cleanup remains
- [x] #8 Automatic happy paths and bounded recovery are demonstrated alongside bug reproductions; the redesign creates no unnecessary operator intervention
<!-- DOD:END -->
