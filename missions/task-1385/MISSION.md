# Mission: Enforce pre-review exact-tree verification and auto-bounce on failure (task-1385)

## Goal

Implement ADR 0048 Control C1 by enforcing mechanical verification gate execution before each review round, with automatic bounce-back to the implementer on gate failure using captured gate output as the fix prompt. The gate exit code on the pinned tree must become the sole trusted signal for verification success — agent textual claims must never be trusted. No reviewer cycle is consumed when the gate fails and auto-bounce occurs.

## Why Now

The current harness has a fail-open path where an agent can hand off with a green gate claim, receive review feedback, "fix" the code, and re-submit without the verification gate re-running. ADR 0048 identifies this as the highest-priority gap to close: pre-review-round gate enforcement (C1) is the single control that prevents incomplete or failing work from consuming reviewer time. TASK-1389 (error classifier) provides the foundational dispatch table that this mission depends on. The machinery already exists in `lib/core/verification.js` (`captureVerifiedTreeProof` / `runVerificationGate`) and is invoked at handoff and integrate time, but enforcement before each review round is missing. Closing this gap eliminates the most common human-intervention scenario identified in ADR 0048's failure class analysis.

## Refinement Signals
- Predicted NEL bucket: Medium (81–235)
- Confidence: High
- Selection note: activate as-is
- Main drivers: ADR 0048 Control C1 is highest-ROI fail-closed control; depends on TASK-1389 error classifier; closes fail-open path identified in TASK-1268 and TASK-1335

## Scope
- Add pre-review-round verification gate enforcement in `lib/review/review-loop.ts` or `lib/review/review-commands.ts` that runs `runVerificationGate` with the mission area (diff-scoped from `{{area}}` template) before each autonomous review round begins
- Integrate with TASK-1389 error classifier to dispatch gate failures as "genuine gate failure — code issue" (Class 6) for auto-send-back
- Capture gate stdout/stderr output and construct a fix prompt that includes the exact failure output, the mission slug, and the area that failed
- Auto-bounce to implementer by relaunching the implementer agent with the fix prompt when gate fails, without transitioning the task out of `review` status or consuming a reviewer cycle
- Limit auto-bounce retry count to max 2 relaunches to prevent infinite loops (aligned with TASK-1387 specification)
- Select gate scope from the mission area (diff-scoped) rather than defaulting to 'all', using the existing `{{area}}` template substitution in `workflow.config.json`
- Preserve the existing reviewer gate check at `lib/review/review-commands.ts:474-481` as a secondary guard; the new enforcement is the primary, pre-review guard

## Out of Scope
- Implementing the error classifier (TASK-1389) — this is a dependency, not part of this mission's implementation
- Implementing gate-failure auto-send-back at handoff time (TASK-1387) — separate but related mission
- Changing the default verification command in `workflow.config.json` away from `./scripts/verify-local.sh {{area}}`
- Modifying the integration-time gates in `lib/commands/integrate.ts`
- Rewriting the verification machinery in `lib/core/verification.ts`; reuse existing `runVerificationGate` and `captureVerifiedTreeProof` functions
- Changing Forgejo PR creation, branch management, or external CI infrastructure
- Adding new gate commands or modifying the gate selection logic beyond area-scoped dispatch

## Success Criteria
> **Falsifiability rule (ADR 0039 Part 2):** Each criterion must be falsifiable. Forbidden: subjective adjectives ("easy, fast, simple, intuitive, user-friendly, responsive, quick, efficient" without an attached metric) and vague quantifiers ("multiple, several, some, many, few, various"). For refactor / condense / migration missions, the criterion must enumerate the specific elements (rules, files, behaviours) that must survive — generic phrases like "preserve critical content" are not sufficient.

1. The verification gate runs mechanically before each autonomous review round starts, and the gate's exit code is the sole trusted signal that verification passed for the pinned tree — no agent textual claim satisfies this requirement
2. On gate failure before a review round, the workflow auto-bounces to the implementer with a fix prompt containing the captured gate stdout/stderr, the mission slug, and the failing area, without consuming a reviewer cycle or transitioning the task out of `review` status
3. Auto-bounce retry is capped at 2 relaunches per gate failure; after 2 failed attempts, the mission strands with a clear message requiring human intervention
4. The gate scope for pre-review enforcement uses the mission area (diff-scoped via `findMissionAreaFn`) rather than defaulting to 'all', using the `{{area}}` template substitution configured in `workflow.config.json`
5. The existing reviewer gate check in `lib/review/review-commands.ts:474-481` remains in place and functional as a secondary verification point
6. The implementation integrates with TASK-1389 error classifier to dispatch gate failures to the auto-send-back path rather than the generic "not automatically repairable" strand

## Risks and Assumptions
- Assumption: TASK-1389 error classifier will be implemented before or in parallel with this mission, providing the dispatch table that maps gate failures to auto-send-back actions
- Assumption: The existing `runVerificationGate` function in `lib/core/verification.ts` captures stdout/stderr; if it does not, this mission must extend it to do so
- Assumption: The mission area can be reliably determined via `findMissionAreaFn` for the purpose of diff-scoped gate selection
- Risk: Gate execution before each review round adds wall-time to the review loop; bounded by the configured gate command duration
- Risk: Capturing stdout/stderr for failed gates may produce large output that exceeds prompt context limits; the fix prompt must be truncated or summarized if needed
- Risk: If the error classifier (TASK-1389) is not available, this mission may need to implement a minimal classification for gate failures specifically to avoid blocking
- Assumption: The implementer agent can be relaunched with a fix prompt without manual intervention, using the existing agent-launch machinery

## Checkpoints
- CP 1: Pre-review gate hook implemented. The verification gate runs via `runVerificationGate` with mission area before each autonomous review round begins in `lib/review/review-loop.ts`
- CP 2: Gate failure dispatch integrated. Gate failures are dispatched through TASK-1389 error classifier as Class 6 (genuine gate failure) with auto-send-back action
- CP 3: Auto-bounce mechanism implemented. On Class 6 dispatch, the implementer is relaunched with captured gate output as fix prompt, without consuming reviewer cycle, with retry counter tracking
- CP 4: Retry limit enforced. After 2 failed gate attempts, the mission strands with a clear "max retries exceeded" message and human-intervention requirement
- CP 5: Area-scoped gate selection working. The gate uses mission area (diff-scoped) rather than 'all', verified by logging the resolved area and command before execution

## Gates
- [ ] ./scripts/verify-local.sh docs

## Restricted Areas
- Do not edit the backlog task `assignee` field
- Do not delete, rename, or move `backlog/tasks/task-1385 - Enforce-pre-review-exact-tree-verification-and-auto-bounce-on-failure.md`
- Do not modify `lib/core/verification.ts` functions `runVerificationGate` or `captureVerifiedTreeProof` except to add stdout/stderr capture if not already present
- Do not change the default verification command in `workflow.config.json`
- Do not remove or weaken the existing reviewer gate check in `lib/review/review-commands.ts:474-481`
- Do not introduce new external dependencies for gate execution or classification

## Stop Rules
- Stop if TASK-1389 error classifier is not implemented and cannot be stubbed minimally for gate failure classification — this mission depends on that dispatch mechanism
- Stop if the verification gate cannot capture stdout/stderr output for failed runs — the auto-bounce requires the gate output as fix prompt material
- Stop if there is no reliable way to determine the mission area for diff-scoped gate selection — the mission must not default to 'all' as a fallback
- Stop if the implementer agent cannot be relaunched programmatically with a fix prompt — the auto-bounce mechanism requires this capability
- Stop if the retry counter cannot be persisted across review rounds — without this, the max-retry limit cannot be enforced
