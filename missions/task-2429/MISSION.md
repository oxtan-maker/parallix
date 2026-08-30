# Mission: Integrate merge through the guarded board command boundary (task-2429)

## Goal
Enable a board request for `integrate:merge` to invoke the existing integration application workflow through the typed board controller, while accepting only the mission/action identity and preserving every authoritative lifecycle, review, stale-state, and gate decision.

## Why Now
TASK-2428 provides the prerequisite board-command work. Without this boundary, the board cannot offer the approved merge action; implementing it outside the existing workflow would duplicate destructive Git behavior and create a bypass path.

## Refinement Signals
- Predicted NEL bucket: Medium (81–235)
- Confidence: High
- Selection note: activate after TASK-2428 is available
- Main drivers: typed board-command dispatch, reuse of the integration use case, fail-closed stale and lifecycle guards, mocked destructive-effect tests

## Scope
- Add typed board-controller handling for a request whose action is exactly `integrate:merge` and whose identity identifies the mission.
- Route an accepted request to the existing integration application workflow; retain that workflow as the sole owner of merge, gates, cleanup, and external effects.
- Apply the authoritative stale/precondition guard from TASK-2425 before the request is accepted for integration.
- Preserve the lifecycle and reviewed-revision/approval policy decisions made by the integration workflow.
- Add isolated unit coverage for allowed, stale, gate-failed, and unavailable integration outcomes, including effect ordering and non-transition after failure.
- Preserve existing CLI `px integrate` behavior through characterization coverage.

## Out of Scope
- New Git merge, branch deletion, worktree cleanup, Forgejo, or subprocess behavior in the board controller/interface.
- Board request fields or options for force, skipped gates, branch, ref, remote, repository path, shell fragments, or cleanup policy.
- Changes to integration policy, review approval requirements, stale-state semantics, lifecycle state definitions, or the CLI command contract.
- UI redesign, board rendering changes, and changes to unrelated board actions.

## Success Criteria
> **Falsifiability rule (ADR 0039 Part 2):** Each criterion must be falsifiable. Forbidden: subjective adjectives ("easy, fast, simple, intuitive, user-friendly, responsive, quick, efficient" without an attached metric) and vague quantifiers ("multiple, several, some, many, few, various"). For refactor / condense / migration missions, the criterion must enumerate the specific elements (rules, files, behaviours) that must survive — generic phrases like "preserve critical content" are not sufficient.

- A typed board request with action `integrate:merge` and a valid mission identity invokes the pre-existing integration application workflow exactly once; the board controller does not invoke Git, Forgejo, branch/worktree cleanup, or `px integrate` itself.
- The authoritative stale/precondition guard from TASK-2425 rejects stale or invalid current mission/review state before the integration workflow is invoked.
- The accepted path remains subject to the existing lifecycle and reviewed-revision/approval checks; a request cannot provide its own current status or approval to satisfy them.
- The board command input type exposes no field or option that can select force behavior, skipped gates, branch, target ref, remote, repository path, shell fragment, or cleanup behavior.
- Unit tests covering allowed, stale, gate-failed, and unavailable outcomes assert effect ordering and assert that every rejected or failed outcome performs no completed-state board transition.
- A successful integration does not directly mark the board completed; completion appears only after the next authoritative board projection reports the completed state.
- Existing `px integrate` characterization tests retain their current behavior, and the required repository gates pass.

## Risks and Assumptions
- TASK-2428 supplies the typed board-command boundary needed to add this action; stop if its public contract differs from the assumptions here.
- TASK-2425 exposes a reusable authoritative guard; do not copy or weaken its logic if it is unavailable.
- Integration has destructive external effects, so tests must mock ports and must not access real Forgejo, Git repositories, worktrees, or agents.
- The existing integration workflow owns legal-state decisions. Any need to change that ownership or lifecycle policy requires a new mission decision.

## Checkpoints
- CP 1: Trace the board request from typed controller to its allowed application boundary, identify the existing integration use case and the TASK-2425 guard, and write the isolated allowed/stale dispatch tests before changing the controller.
- CP 2: Implement the smallest typed `integrate:merge` dispatch that delegates only to the existing integration workflow, then add gate-failed and unavailable tests proving no fallback completed-state transition or destructive controller effect.
- CP 3: Verify completion projection behavior and CLI `px integrate` characterization behavior; review the final diff specifically for absent bypass/force input and destructive-effect containment.

### Checkpoint Documentation Requirements
Every checkpoint document (CP-N.md) MUST include durable evidence first: exact test names, ADR references, test file paths, and recognized repository commands or paths such as `npm test -- --unit-test-headroom`, `node ...`, `git ...`, `px ...`, or `./scripts/verify-local.sh all`. File:line references are accepted when needed but discouraged because line numbers rot.

Every checkpoint document (CP-N.md) MUST also include:
- A summary of work done
- The exact heading `## Goal Check`
- A 3-column pipe-delimited markdown table with columns `| Criterion | Evidence | Status |`
- At least one evidence row for every success criterion, using the durable evidence forms above
- A non-generic `Next action:` line at the bottom

Raw `stat`/`ls` output or generic prose alone is not enough: use it only as supplemental context and pair it with an accepted command, test name, test path, or ADR reference above.

Example Goal Check table:

| Criterion | Evidence | Status |
|---|---|---|
| Stale requests are rejected before integration | `test/board-controller.test.ts`, exact stale-case test name | PASS |
| Required verification completed | `./scripts/verify-local.sh all` | PASS |

## Gates
- [ ] npm test -- --unit-test-headroom
- [ ] ./scripts/verify-local.sh static-analysis
- [ ] ./scripts/verify-local.sh all
- [ ] ./scripts/verify-local.sh integrate

## Restricted Areas
- Do not add direct Git, Forgejo, subprocess, branch deletion, or worktree deletion calls to any board controller, board interface, or board command adapter.
- Do not accept or derive force, gate-bypass, branch, ref, remote, repository-path, shell-fragment, cleanup, client current-status, or client approval input from board callers.
- Do not alter lifecycle/review policy or CLI behavior while wiring this action.
- Do not use real external services in unit tests.

## Stop Rules
- Stop and seek a new mission decision if `integrate:merge` cannot delegate to the existing integration workflow without duplicating its effects or policy.
- Stop if TASK-2425 or TASK-2428 does not provide the required authoritative guard or typed boundary; do not recreate either contract locally.
- Stop if satisfying the board request requires a force/bypass input, client-supplied authority, direct destructive effect, or a fallback completed-state transition.
- Stop if CLI characterization coverage shows a behavior change outside the board command boundary.
