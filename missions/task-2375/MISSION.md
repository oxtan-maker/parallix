# Mission: Finish live-board operation correctness and shutdown semantics (task-2375)

## Goal
Close the remaining live-board composition defects without redesigning its architecture: preserve the newest still-running operation through late historical events, correlate each top-level invocation uniquely, prove real board shutdown during in-flight work, avoid volatile metrics-cache invalidation, and age out unverifiable PID-only liveness safely.

## Why Now
TASK-2373 established the live-board architecture, but production composition can still show stale or missing work, permit an older invocation to clear newer work, repeatedly recompute slow metrics during an AgentBlock, or leave an interactive board client alive when quit during board-owned work. These defects undermine the board's operational authority and must be locked with production-path and real-process evidence before further live-board changes.

## Refinement Signals
- Predicted NEL bucket: Large (235+)
- Confidence: High
- Selection note: activate as-is
- Main drivers: bounded current-work reconciliation, per-invocation operation correlation, PTY shutdown ownership, cache-key separation, and cross-platform liveness semantics

## Scope
- Replace the arbitrary bounded historical-event assumption in the production current-work read/reconciliation path so the newest standing operation survives any number of later terminal or blocking events from older operations, while preserving operational history.
- Assign a unique correlation `operationId` to every top-level review, execute, or integrate invocation that publishes current work; preserve it through nested phases and handoffs.
- Add production-wiring coverage for late events from older operations and overlapping same-type invocations on one mission.
- Extend the real PTY/spawned `px board` shutdown coverage to quit (`q`) and Ctrl+C while an intentionally long-running board-dispatched action is demonstrably in flight; implement and verify the applicable existing child-operation ownership rule.
- Separate volatile AgentBlock countdown/presentation data from the historical slow-metrics cache identity, retaining accurate countdown refresh and non-overlapping rebuilds.
- Change non-Linux/unverifiable process-start behavior so PID existence is `unverified` (or equivalent) and subject to existing freshness/TTL aging; retain authoritative Linux start-identity liveness.
- Align TASK-2373.01 wording with the implemented fallback semantics if that task's wording is updated as part of the change.

## Out of Scope
- Redesigning `currentWork`, the board projection boundary, Mission lifecycle states, review-loop behavior, agent failover, or agent usage-limit selection.
- Introducing MissionRun, AgentAttempt, Attempt, a durable execution aggregate, scheduler, daemon, event bus, or new runtime domain entity.
- Redesigning the board UI or pursuing performance work outside live-board hot paths.
- Adding new macOS or Windows process-start identity implementations beyond the fallback semantics already scoped by TASK-2373.01.
- Treating a larger fixed event-history window, timestamp-only ordering, mocked exit callbacks, or unconditional early `process.exit()` as a solution.

## Success Criteria
> **Falsifiability rule (ADR 0039 Part 2):** Each criterion must be falsifiable. Forbidden: subjective adjectives ("easy, fast, simple, intuitive, user-friendly, responsive, quick, efficient" without an attached metric) and vague quantifiers ("multiple, several, some, many, few, various"). For refactor / condense / migration missions, the criterion must enumerate the specific elements (rules, files, behaviours) that must survive — generic phrases like "preserve critical content" are not sufficient.

- SC1: The production repository/read-adapter/reconciler path used by `px board` keeps operation B as WORKING after `A running -> B running -> A ended -> A blocked`, and after any additional terminal/blocking events from A; board reads remain bounded by current operational state rather than a fixed count of historical `mission.current-work` events.
- SC2: Every top-level invocation that publishes current work has a distinct `operationId`; all of its nested phases and agent-family handoffs retain that ID, and a late `ended` or `blocked` event from older same-type invocation A cannot clear or replace newer invocation B on the same mission.
- SC3: A real interactive `px board` client with a recorded OS PID exits within the test's bounded timeout when `q` and when Ctrl+C are sent after a board-dispatched long-running action has been proven started; the test proves whether that action is cancelled as board-owned or detached under the existing ownership rule, and repeated start-dispatch-quit cycles leave no board client or board-owned resource behind.
- SC4: During an unchanged active timed AgentBlock, refreshes update the displayed countdown and board projection without rerunning historical cycle-time/throughput metrics solely because `blockedForMs` changes; existing non-overlapping rebuild behavior remains intact.
- SC5: Where process-start identity is unavailable, PID existence is non-authoritative `unverified` (or an equivalent state) and ages out through the existing freshness/TTL policy; Linux start-identity checks remain authoritative.
- SC6: Existing nested `active -> handoff -> review -> act-on-review` publication and autonomous eligible-agent-family failover remain correct, including no NEEDS YOU while an eligible family can continue.
- SC7: No prohibited execution/domain abstraction, lifecycle redesign, arbitrary larger event-history window, or volatile countdown cache key is introduced.
- SC8: `./scripts/verify-local.sh static-analysis` and `./scripts/verify-local.sh all` each reach terminal PASS on the final tree.

## Risks and Assumptions
- Real PTY shutdown tests can be timing-sensitive; the implementation must use explicit started/terminated synchronization and bounded timeouts, not sleeps or dispatch-only assertions.
- The existing operational-history ordering is durable enough to reconcile standing work without using timestamps as the sole source of order.
- The current freshness/TTL policy can safely consume an `unverified` liveness result without inventing a platform-specific process identity mechanism.
- The task assumes the existing board ownership model determines whether in-flight work is cancelled or detached; the mission must prove that chosen existing rule instead of changing policy by accident.
- Slow-metrics instrumentation must distinguish cache reuse from a superficially identical re-render so the cache criterion has meaningful evidence.

## Checkpoints
- CP 1: Author the red regression reproduction at `test/task-2375-current-work-operation-repro.test.ts` before writing a fix. Reproduce the production current-work path with `op-A running -> op-B running -> op-A ended -> op-A blocked`, asserting operation B remains current/WORKING. At the mission parent commit this assertion must fail because the bounded read can discard B; after the fix it must pass. Record the red result and do not alter the scenario to avoid the failure.

Reproduction-Test: test/task-2375-current-work-operation-repro.test.ts

- CP 2: Correct bounded current-work reconciliation and invocation correlation. Add production-path coverage for arbitrarily late older-operation events and two overlapping same-type invocations on the same mission; verify nested publication and eligible-family failover remain unchanged.
- CP 3: Correct metrics-cache identity and unverifiable process liveness. Add focused evidence that countdown refresh does not rerun slow metrics and that PID-only liveness ages out while Linux identity remains authoritative; align TASK-2373.01 wording if needed.
- CP 4: Prove and complete shutdown semantics using the real interactive board PTY. Cover `q`, Ctrl+C, and repeated start-dispatch-quit cycles while long-running board work is confirmed in flight, then run the required integration gates and compile the final goal check.

### Checkpoint Documentation Requirements
Every checkpoint document (CP-N.md) MUST include:
- A summary of work done
- A `## Goal Check` section using the exact 3-column table `| Criterion | Evidence | Status |`.
- At least one evidence row for every success criterion. Lead with durable evidence forms Parallix verifies today: exact test names, ADR references, test file paths, and recognized repository commands or paths such as `npm ...`, `node ...`, `git ...`, `px ...`, or `./...`. File:line references are accepted parenthetically when needed but discouraged because line numbers rot.
- Raw `stat`/`ls` output or generic prose alone is not enough: use it only as supplemental context and pair it with an accepted reference above.
- A non-generic `Next action:` line at the bottom

Example Goal Check table:

| Criterion | Evidence | Status |
|---|---|---|
| Draft prompt defines checkpoint evidence rules | `prompts/draft.md` | PASS |
| Repair loop has targeted incomplete-evidence coverage | `test/repair-handoff.test.ts`, `"buildRelaunchPrompt returns string containing Goal Check table and mission slug"` | PASS |
| Verification gate ran | `./scripts/verify-local.sh docs` | PASS |

## Gates
- [ ] ./scripts/verify-local.sh static-analysis
- [ ] ./scripts/verify-local.sh all

## Restricted Areas
- Do not modify Mission lifecycle states, the board projection boundary, agent fallback/usage-limit algorithm, or the existing `currentWork` mission-scoped model except for the narrowly required reconciliation and correlation behavior.
- Do not add durable execution aggregates or per-agent-launch domain concepts, and do not turn `operationId` into persisted domain identity or lifecycle state.
- Do not move repository, SQLite, or process reads into Ink components.
- Do not use a fixed larger event-history limit (e.g. increasing `findLatestByTypePerMission(..., 2)` to another magic number), timestamp-only ordering, or volatile `blockedForMs` as a slow-metrics cache key.
- Do not claim shutdown completion from component mocks or command dispatch: real `px board` PID disappearance and child-resource ownership evidence are required.
- Do not satisfy shutdown by unconditional early `process.exit()` that bypasses resource cleanup; diagnose and fix ownership first.
- No unresolved Promise, stdin listener, Ink instance, timer, PTY handle, DB handle, or child-process handle may accidentally keep the board client alive.
- `operationId` must be unique per invocation — mission slug alone is not sufficient correlation.
- Overlap tests must use two invocations of the **same operation type** on the same mission, not merely different operation names.
- Existing idle/modal `q`, Ctrl+C, SIGTERM, terminal restoration, and repeated-shutdown tests must remain green after changes.
- A red-to-green reproduction test is required for both current-work reconciliation AND metrics-cache invalidation before their respective fixes.
- Metrics-cache instrumentation must prove repeated idle refreshes during a long AgentBlock reuse the slow-metrics result, not merely re-render identically.

## Stop Rules
- Stop and escalate if preserving current work requires a new durable execution aggregate, a Mission lifecycle change, or a change to agent-family selection/failover policy.
- Stop and escalate if real PTY evidence shows no existing child-operation ownership rule can safely decide cancellation versus detachment.
- Stop and escalate if the operational store lacks durable ordering needed to reconcile standing operations without an arbitrary historical-event window.
- Do not proceed to review, integration, or completion until every success criterion has a durable Goal Check evidence row and both gates have terminal PASS results.
- No `.only` or bare `.skip` tests introduced without annotation.
- Authored docs updated if user-facing behavior or supported semantics change.
