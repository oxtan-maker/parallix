# Mission: Authoritative live mission work in the board (task-2370)

## Goal
Make the shared board projection accurately distinguish mission work in progress from work requiring an operator by completing the existing mission-scoped `LiveMissionWork` / `MissionOperationalFacts.currentWork` authority path, publishing it at long-running operation boundaries, and making the interactive board react to externally caused state changes without restart.

## Why Now
The current board hard-codes `currentWork` to `null` and then relies primarily on broad OS-process inference. As a result it can omit live work, misidentify its phase or agent, show autonomous failover as human attention, retain stale running work after a process dies, and become stale while another `px` process changes operational state. The repository already has the intended operational-facts and progress foundations; completing that design prevents the local TUI and future web board from inventing competing liveness models.

## Refinement Signals
- Predicted NEL bucket: Large (235+)
- Confidence: High
- Selection note: Cross-cutting application/projection/reactivity work; begin with authority tracing and regression characterization.
- Main drivers: authoritative mission-scoped current work; autonomous agent-family failover; stale-work reconciliation; shared reactive board projection; truthful attention-command dispatch.

## Scope
- Trace and retain one authority for mission lifecycle, review state, `AgentBlock`, operation progress, agent/session resume metadata, gate state, and liveness reconciliation; document that authority allocation in implementation-facing tests or code where it prevents duplication.
- Complete `LiveMissionWork` / `MissionOperationalFacts.currentWork` as an ephemeral, mission-scoped shared projection containing the active operation or phase, summary, applicable agent family, and freshness needed by UI consumers.
- Publish and clear/update current work at board-relevant long-running operation boundaries: active execution, agent-family handoff, review and applicable review response, and integration.
- Make `BoardProjectionBuilder` consume authoritative current work and derive attention policy in shared application/projection code rather than Ink components or primary OS-process heuristics.
- Preserve automatic agent-family failover: a usage-blocked family followed by another eligible family remains one mission's WORKING state; no eligible family remaining produces a truthful actionable attention item.
- Add bounded freshness/reconciliation so abnormal process termination cannot leave current work permanently running, while preserving an explicit unverified/observation-failure state where needed.
- Add interactive-board invalidation/re-query for board-relevant externally caused changes, including mission lifecycle/current-work and `AgentBlock` changes plus time-driven expiry; retain finite one-shot behavior for piped/non-interactive board output.
- Update the operator rail/menu to show running work separately from NEEDS YOU and dispatch the exact typed application command advertised by each attention item.
- Review TASK-2368 against the delivered behavior and close or supersede it when this mission fully covers its defect.

## Out of Scope
- Changing agent selection order, usage-limit detection, or the autonomous no-permission execution model.
- Adding a `MissionRun`, `AgentAttempt`, attempt aggregate, durable per-launch analytics identity, daemon, network service, event-sourcing subsystem, or generic job scheduler.
- Changing mission lifecycle vocabulary, repurposing `Mission.assignee`, or persisting volatile progress through ordinary mission lifecycle CAS writes.
- Reworking unrelated review-domain semantics, implementing the full TASK-2283 browser UI, or performing a general visual redesign beyond a clear WORKING versus NEEDS YOU distinction.
- Using `ps`, `/proc`, worktree names, or session-marker history as the normal authority for mission ownership or active agent; they may only support bounded reconciliation/recovery.

## Success Criteria
> **Falsifiability rule (ADR 0039 Part 2):** Each criterion must be falsifiable. Forbidden: subjective adjectives ("easy, fast, simple, intuitive, user-friendly, responsive, quick, efficient" without an attached metric) and vague quantifiers ("multiple, several, some, many, few, various"). For refactor / condense / migration missions, the criterion must enumerate the specific elements (rules, files, behaviours) that must survive — generic phrases like "preserve critical content" are not sufficient.

- SC1: A red-first test at `test/task-2370-repro.test.ts` demonstrates at the parent commit that a live operation has no projected `currentWork`, a non-active live phase can be misidentified by process inference, and an already-open interactive board does not reflect an externally caused board-relevant change; it passes after the implementation.
- SC2: Shared operational facts project one mission-scoped `currentWork` with operation/phase, summary, applicable active agent family, and freshness; `BoardProjectionBuilder` consumes that fact rather than setting `currentWork` to `null` or primarily reconstructing ownership from process scans.
- SC3: Current-work publication covers active execution, automatic family handoff, review, applicable review response, and integration; UI adapters do not independently reconstruct these semantics.
- SC4: A `claude` active operation that receives a usage block and automatically continues with `qwen` remains WORKING for the same mission, updates its projected active family, and creates no NEEDS YOU item; `AgentBlock` remains the availability authority.
- SC5: When no eligible agent family can continue, the mission becomes one actionable attention item with a truthful reason; a blocked family alone does not create operator attention.
- SC6: Freshness/reconciliation clears or marks stale current work after abnormal process disappearance without inventing a durable run/attempt entity; where verification fails, consumers can distinguish unknown/unverified from known idle/stopped.
- SC7: An already-open interactive `px board` rebuilds through the shared application projection within a bounded, tested delay after external mission lifecycle/current-work or `AgentBlock` changes and after relevant time-driven expiry; piped/non-interactive `px board` remains a finite one-shot render.
- SC8: The operator rail/menu separately displays current work (mission, operation/phase, agent family) and human attention; NEEDS YOU counts only action-required missions, and Enter dispatches the exact typed command shown by every attention item.
- SC9: Regression coverage includes live active work, live review work, automatic usage-block failover, exhausted eligible agents, abnormal process disappearance or stale work, external change while the TUI is open, exact attention-action dispatch, and source-warning scoping.
- SC10: TASK-2368 is reviewed and closed or superseded if fully covered; any architecture documentation changes describe only the changed authority boundary.
- SC11: `./scripts/verify-local.sh all` completes successfully on the final tree.

## Risks and Assumptions
- Existing operational-fact storage and progress emission can carry current-work changes without creating a second durable authority; implementation must stop for a design decision if that proves false.
- Reactive refresh must retain a shared application boundary and avoid direct Ink reads of SQLite, Git, process state, Markdown, or subprocess output.
- Process evidence may be incomplete or unavailable; reconciliation must not silently turn failed observation into an idle conclusion.
- Time-based expiry and external invalidation can introduce TUI lifecycle leaks or make non-interactive rendering hang; tests must cover disposal and finite one-shot output.
- TASK-2368 may overlap but is not assumed duplicate until its acceptance behavior is compared with the completed implementation.

## Checkpoints
- CP 1: Add `test/task-2370-repro.test.ts` before implementation. It must reproduce: (a) a live operation yielding absent board `currentWork`, (b) a live review/other phase being misidentified by process-derived liveness, and (c) an open interactive board not updating after an external board-relevant change. Assert these fail against this mission's parent commit (red) and pass after the implementation (green).
- CP 2: Trace and implement the authoritative mission-scoped current-work model and publication lifecycle. Add focused mocked tests for active execution, review/review response, integration, and family handoff, keeping lifecycle, `AgentBlock`, progress, session metadata, gate state, and reconciliation authorities distinct.
- CP 3: Implement shared projection attention policy, bounded stale-work reconciliation, and reactive invalidation/re-query. Add tests for failover versus exhaustion, unverified observations, stale work, external updates, time-driven expiry, source-warning scoping, and finite non-interactive rendering.
- CP 4: Complete the TUI operator rail/menu consumption and typed attention-command dispatch; verify exact displayed/dispatched command parity, perform the TASK-2368 overlap review, update durable architecture documentation only if the authority boundary changes, and run the final gate.

Reproduction-Test: test/task-2370-repro.test.ts

### Checkpoint Documentation Requirements
Every checkpoint document (CP-N.md) MUST include:
- A summary of work done.
- The exact heading `## Goal Check`.
- The exact 3-column pipe-delimited table `| Criterion | Evidence | Status |` with at least one row for every applicable success criterion.
- Lead each evidence entry with durable Parallix-verifiable forms: exact test names, ADR references, test file paths, and recognized repository commands or paths such as `npm ...`, `node ...`, `git ...`, `px ...`, or `./...`. File:line references are accepted parenthetically when needed but discouraged because line numbers rot.
- For CP 1, record the red parent-commit result and the green post-fix result for `test/task-2370-repro.test.ts`, naming the exact failing and passing tests.
- Raw `stat`/`ls` output or generic prose alone is not enough: when included, pair it with an accepted command, path, exact test name, or ADR reference above.
- A non-generic `Next action:` line at the bottom that names the next checkpoint action or final gate.

Example Goal Check table:

| Criterion | Evidence | Status |
|---|---|---|
| Draft prompt defines checkpoint evidence rules | `prompts/draft.md` | PASS |
| Repair loop has targeted incomplete-evidence coverage | `test/repair-handoff.test.ts`, `"buildRelaunchPrompt returns string containing Goal Check table and mission slug"` | PASS |
| Verification gate ran | `./scripts/verify-local.sh docs` | PASS |

## Gates
- [ ] ./scripts/verify-local.sh all

## Restricted Areas
- Do not introduce durable per-launch/run/attempt entities or duplicate current-work data across Mission, session markers, telemetry, operational history, and a new table.
- Do not change agent selection/failover semantics, add permission states, or convert automatic handoff into a mission lifecycle state.
- Do not make process scanning the primary board authority; retain it only when required for bounded reconciliation/recovery.
- Do not have Ink components directly read Git, Markdown, SQLite, `/proc`, or subprocess state, and do not solve refresh through UI-only polling of every backing source.
- Do not change `Mission.assignee` semantics or use lifecycle CAS writes for volatile operational progress.
- Do not implement TASK-2283's browser UI or unrelated review behavior.

## Stop Rules
- Stop and request an architecture decision if authoritative current-work publication cannot be represented by the existing operational-facts/progress architecture without a new durable run/attempt concept.
- Stop and request direction if live refresh requires a daemon, network service, generic scheduler, event-sourcing subsystem, or direct UI ownership of backing stores.
- Stop and investigate before proceeding if failover cannot remain autonomous, if an `AgentBlock` alone produces NEEDS YOU, or if reconciliation cannot distinguish observation failure from known idle state.
- Stop and report if reactive board changes make piped/non-interactive output non-finite, if stale work cannot be bounded after abnormal process termination, or if the displayed attention action cannot be made identical to the dispatched typed command.
