# Mission: Rework how to choose an agent (task-2216)

## Goal
Remove the GPU-capacity blocker for custom agents by making the maximum number of concurrently running custom-agent instances configurable, enforcing that limit with a semaphore, recovering semaphore capacity after failures or hangs, and selecting another eligible agent when custom capacity is exhausted.

## Why Now
Custom-agent launches can consume scarce GPU compute without a coordinated concurrency limit. When launches accumulate or a custom instance hangs, subsequent missions can remain blocked instead of using an available non-custom agent. This directly reduces mission throughput.

## Refinement Signals
- Predicted NEL bucket: Medium (81–235)
- Confidence: Medium
- Selection note: activate after confirming the current custom-agent launch, completion, and selector entry points named by the repository.
- Main drivers: configurable capacity policy; semaphore ownership across launch and cleanup paths; recovery from errors and hangs; selector fallback; targeted automated coverage and workflow documentation.

## Scope
- Add a documented configuration setting that defines the maximum number of simultaneously running custom-agent instances, including its default and validation behavior.
- Route every custom-agent launch through a shared semaphore or equivalent single capacity guard that prevents active custom instances from exceeding that configured maximum.
- Release or reset capacity on normal completion, launch failure, agent error, cancellation, and the repository’s existing hang/timeout recovery path, so stale reservations do not block later work.
- Change agent selection so a saturated custom-agent pool is treated as unavailable and the selector chooses another eligible agent according to existing selection rules.
- Add focused tests for configuration, saturation, release/reset behavior, and fallback selection; update workflow-facing documentation for the setting and saturation behavior.

## Out of Scope
- Changing GPU allocation, model selection, or resource limits for non-custom agents.
- Introducing a queue, priority scheduler, fair-share policy, or cross-process/distributed capacity coordinator.
- Replacing the existing custom-agent runtime, hang detector, or agent-selection policy beyond recognizing saturated custom capacity as unavailable.
- Retrying, terminating, or repairing arbitrary custom-agent work solely because the new capacity limit was reached.

## Success Criteria
> **Falsifiability rule (ADR 0039 Part 2):** Each criterion must be falsifiable. Forbidden: subjective adjectives ("easy, fast, simple, intuitive, user-friendly, responsive, quick, efficient" without an attached metric) and vague quantifiers ("multiple, several, some, many, few, various"). For refactor / condense / migration missions, the criterion must enumerate the specific elements (rules, files, behaviours) that must survive — generic phrases like "preserve critical content" are not sufficient.

- A documented configuration key sets the maximum concurrently running custom-agent instances; an omitted setting uses a documented default, and invalid values are rejected or normalized by explicitly tested behavior.
- A custom-agent launch cannot start while the number of active custom instances equals the configured maximum; releasing one completed or failed instance permits exactly one subsequent custom launch.
- The capacity guard is cleared or reset by every existing terminal/recovery path for a custom instance: successful completion, launch error, runtime error, cancellation, and hang/timeout recovery; automated tests cover each applicable path present in the implementation.
- When custom capacity is saturated and at least one non-custom agent is eligible, agent selection returns an eligible non-custom agent; when no eligible alternative exists, the existing no-agent outcome remains explicit and is covered by a test.
- The changed configuration and selection behavior are documented, and all changed production code and tests pass the repository verification gates without introducing focused or bare skipped tests.

## Risks and Assumptions
- Assumption: the repository has a single logical custom-agent launch lifecycle or a small, discoverable set of entry points that can share one guard.
- Risk: a cleanup path may bypass the normal completion handler, leaving a semaphore permit held. Mitigation: map terminal and hang-recovery paths before implementation and test each discovered path.
- Risk: concurrent selector calls may observe stale availability. Mitigation: make the capacity decision and reservation atomic at the custom launch boundary.
- Risk: fallback selection could unintentionally change existing eligibility or preference rules. Mitigation: preserve those rules and only exclude custom agents while their capacity is exhausted.

## Checkpoints
- CP 1: Trace the current configuration, custom-agent selection, launch, terminal cleanup, cancellation, and hang/timeout recovery paths. Record the capacity-guard ownership model, the configuration key/default, the affected test files, and the selected fallback behavior before changing production code.
- CP 2: Implement the configuration-backed shared capacity guard and wire its acquire, release, and reset behavior into every lifecycle path identified in CP 1. Add focused automated coverage proving the configured limit and recovery behavior.
- CP 3: Implement and test selector fallback when custom capacity is saturated, update the applicable workflow/configuration documentation, run required verification, and complete the final Goal Check with evidence for every success criterion.

### Checkpoint Documentation Requirements
Every checkpoint document (CP-N.md) MUST include:
- A summary of work done
- The exact heading `## Goal Check`
- The exact 3-column pipe-delimited markdown table header `| Criterion | Evidence | Status |`
- At least one evidence row per criterion using verifiable references. Parallix already accepts:
  1. **File:line references** — e.g., `lib/commands/handoff.ts:292` (must point to an existing file and line)
  2. **Test names** — e.g., `"real custom-agent launcher smoke: full lifecycle with hello-world task (SC3/SC4/SC5/SC6/SC7)"` (must match a test name in the repo)
  3. **Test file paths** — e.g., `test/e2e-real-agent-smoke.test.js` (must be an existing test file)
  4. **ADR references** — e.g., `ADR 0048` (must correspond to an existing file under `docs/adr/`)
  5. **Recognized repo commands or paths** — e.g., `` `npm test -- test/repair-handoff.test.js` ``, `` `px review task-2216 --verify` ``, or `` `./scripts/verify-local.sh all` ``
- Raw `stat`/`ls` output or generic prose alone is not enough; it may appear as supplemental context only when paired with one of the accepted references above.
- A non-generic `Next action:` line at the bottom

Example Goal Check table:

| Criterion | Evidence | Status |
|---|---|---|
| Draft prompt defines checkpoint evidence rules | `prompts/draft.md:28` | PASS |
| Repair loop has targeted incomplete-evidence coverage | `test/repair-handoff.test.js`, `"buildRelaunchPrompt returns string containing Goal Check table and mission slug"` | PASS |
| Verification gate ran | `./scripts/verify-local.sh docs` | PASS |

## Gates
- [ ] `./scripts/verify-local.sh all`

## Restricted Areas
- Do not change the backlog task assignee, mission workflow state, or integration/review state as part of implementation.
- Do not weaken or bypass existing agent eligibility, authorization, cancellation, timeout, or error-handling rules to make fallback succeed.
- Do not introduce a global GPU scheduler, cross-process lock, queue, or changes to non-custom agent resource limits without a follow-up mission.
- Preserve the existing no-eligible-agent behavior when custom capacity is saturated and no alternative agent is eligible.

## Stop Rules
- Stop and request direction if custom-agent launches occur in more than one independent process or host and the requested in-process semaphore cannot enforce the stated maximum.
- Stop and request direction if fallback requires choosing an agent that existing eligibility, policy, or user configuration excludes.
- Stop and request direction if no existing hang/timeout recovery path can be identified and defining a new timeout policy would be required.
- Stop and request direction if the required capacity behavior conflicts with an existing documented configuration contract or ADR.
