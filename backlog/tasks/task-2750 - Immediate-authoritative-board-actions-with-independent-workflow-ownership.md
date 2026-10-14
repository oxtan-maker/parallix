---
id: TASK-2750
title: Immediate authoritative board actions with independent workflow ownership
status: backlog
assignee: []
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
