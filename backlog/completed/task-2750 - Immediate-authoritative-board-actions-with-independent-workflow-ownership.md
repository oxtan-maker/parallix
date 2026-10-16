---
id: TASK-2750
title: Immediate authoritative board actions with independent workflow ownership
status: done
assignee: [codex]
created_date: '2026-10-14 18:17'
labels: []
dependencies: []
ordinal: 240008
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The board submits a start/restart/continue/stop action, receives an acknowledgement, then observes server-owned execution. Ten missions can operate without ten operator terminals. An accepted activation is durably active and visible before slow preflight/tests run. Fix request admission, state authority, execution ownership and browser observation as one end-to-end mission, not another spinner/refresh patch.
Reference inspected: 4d459cbbfd27ab5a880964542bd4bdfb55a776a2. Verify starting HEAD. Use the shared identity/history capability from mission-canonical-terminal-identity-and-history.md; do not implement a second terminal manager. Read current repository instructions and applicable ADRs; preserve ports-and-adapters boundaries.
Known blockers to trace
ExecuteMissionService.execute() calls resolveWorkspace() (including preflight) before publishing work or activating; full agent preparation also precedes activation. host.ts rebuilds the whole board for command eligibility and awaits complete dispatch. Production adapters include synchronous subprocess calls. Neither moving activation immediately before provider spawn nor returning an unawaited promise isolates the HTTP event loop or gives the workflow an independent owner.
Trace actual admission -> commit -> notification -> response -> browser observation, including shared database locks and projection work. Separate measured delays from assumptions; do not assert that preflight explains every reported two-minute pause.
Required contract
1. Admit and commit before expensive work
After bounded authentication, request validation and authoritative per-mission eligibility checks, durably accept an operation and acquire exclusive mission ownership. Reject illegal/stale actions without moving the mission. Refactor shared eligibility into the existing application authority where needed; do not bypass it or duplicate it in HTTP handlers. Admission must not await repository-wide projections, builds, tests, provider startup, capacity waits or complete prompt preparation.
For a valid refined -> active start, commit the real Mission activation, its lane event and attributable preparing work before preflight/verification/provider startup. Separate cheap configured agent selection and domain prerequisites from expensive launch preparation. Preserve the domain's contract checks. An already-active restart records a new operation/attempt, not a fictitious second lane transition.
Acceptance/ownership/state must be transactionally consistent, or recoverable through a proven persisted intent protocol using the existing store. No SQLite transaction or repository-wide lock may span tests or worker execution. Notify the board from the committed change. The HTTP reply and SSE delivery must not be trapped behind the slow operation they describe.
Long-running commands return typed 202 Accepted with a stable operation ID and queryable current status, not completed or an HTTP request held open for the workflow. Repeated delivery of one request key returns the same operation; distinct competing requests for the same mission conflict or join that owner, never launch twice. Keep short editing/read operations synchronous where appropriate.
2. Let a process own the entire workflow
Use a process-owned workflow boundary: the owner runs preparation, agent execution, validation, handoff/review and recording through existing application services. Do not duplicate workflow policy. Browser disconnect or web-host restart must not stop execution, transcript capture or continuation. Merely detaching/unreferencing the provider child is insufficient. Worker stdio/capture and required services must not depend on a live HTTP parent or its IPC channel.
Provision hosting explicitly for headless board launches, respecting configured tmux/pipe policy and supported in-process providers. Reuse the shared terminal/history capability. Keep operation identity consistent through progress, retries and outcomes; eliminate fixed IDs such as board-draft where used for concurrent requests.
Use the same per-mission ownership/admission rule for web, CLI and other dispatch surfaces. Fence old owners and delayed callbacks with an operation/owner identity; PID existence or an idle tmux console is not sufficient. Recover accepted-but-not-started work and rediscover running owners after web restart. Reconcile uncertain launches before retrying; do not blindly replay irreversible effects or promise exactly-once external execution.
Independent missions may overlap. Preserve narrow repository/base-checkout exclusion for genuinely conflicting mutations. Do not add a fleet-wide execution lock or hold one through agent work. Keep existing CPU/provider capacity limits; queued work must be visible without waiting for capacity to acknowledge it.
3. Action semantics and observation
Expose typed start, safe resume/restart, review continuation and stop-run actions as appropriate to authoritative state; route existing long-running draft/handoff/integration actions through the same ownership boundary. Restarting a live owner must explicitly stop/settle it before replacement; reject or visibly report pending stop when termination is unconfirmed. A restart request is not permission for two writers. Preserve configured fresh/resume provider-session policy.
Stopping a run is not cancellation/deletion of a mission. Preserve manual review judgement and explicit integration; no automatic merge, gate bypass, arbitrary shell API or new general-purpose terminal UI.
Separate operation phase from lifecycle facts. Activation is committed immediately as specified above. Review eligibility, approval and completion still require their existing evidence; while those gates run, publish attributable checking/waiting work immediately rather than inventing a successful lane transition. Prelaunch failure uses safe compensation where valid; later failures retain evidence and surface a blocked/interrupted outcome. Old cleanup must not roll back a newer operation.
The browser follows server-owned state, not local pending maps: after reload it can observe owners, phases, reasons, history and allowed controls. No optimistic fake lane, tighter polling workaround or premature success toast. Slow test execution or terminal probes must not block snapshots, notifications or independent admissions in the HTTP process. Bound/coalesce observation work without hiding committed transitions.
Decisive acceptance tests
Extend existing production host/controller/store/browser and process-boundary suites. Use small deterministic workloads and gate barriers, not two-minute sleeps or paid agents.
- Start a refined fixture mission and hold its preflight/test boundary unresolved. Before releasing it, prove: the authoritative store contains active and its lane event; HTTP acceptance has returned; the real board notification/snapshot path and mounted browser show active/preparing; another mission can be admitted. A local spinner or mocked optimistic snapshot cannot pass this test. Include a worker blocked in a synchronous subprocess to expose HTTP event-loop coupling.
- Repeat through the CLI admission path. Duplicate delivery, another browser tab and CLI/web races produce one live owner. Invalid requests do not change state; failed startup and gate failures preserve correct compensation/evidence.
- Start ten lightweight fixture workflows; record acknowledgement, persisted-state and visible-state latency. Target acknowledgement and visible activation within one second of request on the isolated local fixture, independent of gate duration. Use causal barrier assertions as the retained regression, not fragile production-CPU timing assumptions. Do not raise verification budgets to hide slow admission.
- Reload the browser and restart the web host during execution. Existing owners continue capture and workflow progression, then are rediscovered without duplicate launch. Inject failure between intent/activation/launch boundaries; no accepted operation disappears or remains falsely running forever.
- Stop/restart one owner while others run. No cross-mission termination, overlapping replacement writer, stale-owner rollback or accidental mission deletion. History links retain both attempts. Exercise a conflicting integration separately without auto-merging real data.
Perform a manual browser observation against isolated fixtures using existing tooling. Record real request/commit/notification/render ordering. No new E2E framework, real operator-database mutations or repeated full repository gates. Run focused regressions and mandatory static analysis; retain red-on-parent evidence for delayed activation.
Completion
Deliver the API, application admission/ownership, process runner and browser consumption together. Update the relevant live contract/ADR narrowly; put test inventories and measurements in the normal checkpoint. Report unsupported paths honestly. Completion requires state visibility while the slow gate is still held, not after it finishes. Follow normal review; do not automatically integrate or push to origin.
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

## Execution investigation

CP-1 is incomplete; no implementation checkpoint or success criterion is claimed complete.

The retained barrier case in test/unit/application/mission-execute-service-contract.test.ts,
activation and preparing work precede held preflight (TASK-2750), is red against the
unchanged production source: npm test -- test/unit/application/mission-execute-service-contract.test.ts
reports 16 passing cases and this one failure, authoritative activation must commit
before preflight. The failing case took 5.807 ms; it uses a causal barrier and releases
and drains execution in finally. This does not measure the reported two-minute pause.

The execution service resolves preflight and prepares the full prompt before activation.
The production web host rebuilds the board before dispatch and awaits its complete
outcome. The Git adapter uses spawnSync. These are separate coupling points; no
SQLite-lock latency or browser-render latency has yet been measured.

An architectural decision is requested before dependent ownership implementation.
src/application/consumer-domain-requirements.ts records that no consumer requires
durable per-launch identity or lifecycle. The owning architecture guard in
test/unit/domain/domain-architecture-guards.test.ts permits only the existing stats
deduplication consumer and explicitly requires re-deciding that branch for a new
durable consumer. All 25 architecture cases currently pass. ADR 0064 supplies
terminal/run-capture identity, but does not decide durable workflow ownership.

Proposed decision: recognize a checked workflow-operation coordination contract,
separate from provider attempts, with persisted admission, owner fencing, recovery
and outcomes; revise the consumer decision narrowly while retaining Mission lifecycle
authority, OS liveness authority and the existing terminal/history mechanism.
Alternatives are to classify the same bounded operation state as technical metadata
under ADR 0053 with an explicit clarified guard, or retain ephemeral coordination,
which cannot satisfy this mission's restart-survival and queryable-status criteria.
Risks requiring the contract are duplicate external launches, stale-owner writes,
unsafe replacement and lifecycle compensation; naming a record differently does not
resolve those invariants. Repository instructions require an explicit subsequent
operator decision for architectural-principle changes. No production source or
architecture guard has been changed pending that decision.


## Dependency adoption and operator decision (2026-10-15)

Operator approved durable workflow ownership when required by the behavioral
contract and modeled with explicit domain identity, lifecycle and invariants.
The instruction is to reuse TASK-2749 and avoid parallel objects for the same
responsibility. Operator subsequently authorized adaptation against TASK-2749
before its integration defences finish. The Mission scope records this decision
at version 9; its dependency on task-2749 was recorded at version 8.

Merged mission/task-2749 at ab0ae96d2c into this worktree as the development
baseline. Reconcile with its eventual integrated main revision before final
validation. Its published MissionTerminalCapability owns terminal resolution
and retained history; AgentRunIdentity remains the provider-run evidence
identity. Its coordinator captures already correlate to application operation
IDs through composition. Reuse these contracts rather than introducing a
terminal identity, capture store, or logger here.

TASK-2749 deliberately excludes the async command runner and does not implement
persisted request admission, exclusive fenced ownership or restart recovery.
Those remain TASK-2750 responsibilities under the operator decision. The old
CP-7 report predates that decision; it must not be treated as a request for
another approval, nor cleared with fabricated completion evidence.

Dependency-focused contracts pass (30 cases). The retained held-preflight
regression remains red (16 pass, 1 fail), confirming that adopting terminal/history
alone does not fix activation ordering. No implementation completion is claimed.


## Delivery evidence (2026-10-15)

Reconciled TASK-2749 through its ready-for-integration revision 9ba33796c.
One WorkflowOperation coordinates commands; terminal identity, provider invocation
identity and retained history continue to use TASK-2749's published capability.
The operator's architectural approval is recorded in the Mission brief at version 9.

Implementation commits real activation, lane evidence and preparing work with
admission; independent supervisors/executors preserve workflow and capture across
web-host lifetime. CLI children inherit the fencing generation. Uncertain process
or provider execution retains ownership and refuses replacement. Stop confirmation
uses Linux process-tree observation; other platforms report pending termination
when that proof is unavailable. No exactly-once external-effect claim is made.

The retained preflight reproduction is green after its recorded parent failure.
The isolated ten-workflow Chromium check observed all acknowledgements, persisted
activation and visible preparing state below one second, including reload, host
restart, stop/replacement and retained review output. Measurements, event ordering
and focused check results are recorded in the Mission's CP-6 checkpoint evidence.
No operator database or paid/model-backed agent was used for these fixture checks.
Normal workflow automatic full gates remain required and are not claimed passed.
