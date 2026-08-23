# Mission: Reviewer fallback escape hatch selects the PR author (task-2384)

## Goal
Make a pool-exhaustion self-review a first-class, actionable review outcome. When the only runnable reviewer family authored the PR, the workflow must still run and retain that local review verdict, but it must announce before launch that formal external approval will be required and leave the mission visibly marked as approval owed instead of silently stalling after Forgejo rejects self-approval.

## Why Now
On task-2377.05 review round 2, the reviewer pool was exhausted after a stale Claude session and review-sandbox launch failures for other families. The `custom` implementer then completed a self-review and its artifacts and comment were recorded, but Forgejo could not accept its approval. The existing warning says that another agent or a human must approve, yet no durable workflow state or operator-facing escalation carries that requirement forward. The mission can appear reviewed while remaining unable to integrate.

## Refinement Signals
- Predicted NEL bucket: Medium (81–235)
- Confidence: High
- Selection note: activate as-is
- Main drivers: reproduced self-review cannot produce provider approval; the required approval is currently neither represented in mission state nor surfaced by status; fallback diagnostics need to distinguish genuine pool exhaustion from launcher failures.

## Scope
- Preserve the review launcher's single-family escape hatch for a genuinely exhausted reviewer pool, including when it selects the PR-author family.
- Add reviewer-selection handling that detects and reports, before review work starts, that the selected reviewer authored the PR and that an external formal approval will remain required.
- Persist and surface an explicit approval-owed review state through `px status <slug>` after a self-review verdict cannot be posted to Forgejo.
- Retain the locally recorded self-review verdict and its current meaning for integration gating.
- Include per-family unavailability reasons in the exhausted-pool fallback diagnostic.
- Add focused, dependency-mocked tests under `test/` for the red-to-green regression, the pre-launch notice, approval-owed visibility, local-verdict retention, and fallback diagnostics.
- Update authored documentation only if the new approval-owed state is a supported user-facing workflow behavior.

## Out of Scope
- Removing, disabling, or making the PR author ineligible for the single-family reviewer fallback.
- Altering Forgejo's self-approval rule, provider authentication, or network behavior.
- Resolving the separate stale-session and review-sandbox launch failures that helped exhaust the pool on task-2377.05.
- Changing the semantics of a locally recorded self-review verdict for integration gating.
- Adding agent families, launcher configuration, dependencies, or a new test framework.

## Success Criteria
> **Falsifiability rule (ADR 0039 Part 2):** Each criterion is falsifiable; no subjective adjectives or vague quantifiers.

- SC1 When every non-author family is unavailable, the single-family escape hatch still launches the PR-author family as reviewer. Falsify: a mocked exhausted-pool test observes the author-family launch.
- SC2 Before that self-review launches, the operator output identifies the selected reviewer as the PR author and states that external formal approval will be required. Falsify: the selection test lacks either the author relationship or approval-required notice before the launch event.
- SC3 A self-review whose provider approval is skipped retains its local verdict and creates an explicit approval-owed state. Falsify: the review aggregate lacks the local verdict or lacks the approval-owed indicator after the simulated provider self-approval rejection/skip.
- SC4 `px status <slug>` visibly reports the pending formal approval for a mission in the approval-owed state. Falsify: a status rendering test for that state does not contain an approval-owed/external-approval requirement.
- SC5 The exhausted-pool diagnostic names each unavailable candidate family and its recorded unavailability reason. Falsify: a mixed blocked/failed-to-launch pool test omits a candidate family or reason.
- SC6 The regression reproduction fails on the mission parent commit and passes after the implementation. Falsify: `test/task-2384-reviewer-self-review-approval-owed.test.ts` is green before the fix or remains red after it.
- SC7 Static analysis and the complete local verifier pass without focused or unannotated skipped tests. Falsify: `./scripts/verify-local.sh all` exits nonzero or reports `.only`/bare `.skip` violations.

## Risks and Assumptions
- Risk: treating self-review as an error would regress the deliberately supported escape hatch. Mitigation: tests must assert that the author-family review still launches after all alternatives are unavailable.
- Risk: a new state can be written but not visible to operators. Mitigation: test the status presentation separately from aggregate persistence.
- Risk: pool exhaustion may hide operational failures. Mitigation: preserve the reason recorded for every excluded, blocked, or failed-to-launch family in the fallback diagnostic.
- Assumption: existing review aggregate and status seams can represent a pending external approval without changing Forgejo provider behavior.
- Assumption: unit tests can inject provider and launcher doubles; they must not access real Forgejo or invoke expensive agent commands.

## Checkpoints
Reproduction-Test: test/task-2384-reviewer-self-review-approval-owed.test.ts

- CP 1: Author `test/task-2384-reviewer-self-review-approval-owed.test.ts` before any production fix. It must mock an exhausted review pool where `custom` is the PR author and only runnable family, exercise the self-review/provider-skip outcome, and assert the missing approval-owed state or status visibility. It must fail on this mission's parent commit (red) and pass after the fix (green).
- CP 2: Implement the workflow-state, selection notice, fallback-reason, and status behavior while preserving the self-review launch and local verdict.
- CP 3: Verify the reproduction and focused mocked unit coverage, run the repository gate, and record the final goal check.

### Checkpoint Documentation Requirements
Every checkpoint document (CP-N.md) MUST include:
- At least one evidence row for every success criterion, led by durable evidence Parallix verifies today: exact test names, ADR references, test file paths, and recognized repository commands or paths such as `npm ...`, `node ...`, `git ...`, `px ...`, or `./...`. File:line references are accepted parenthetically when necessary but discouraged because line numbers rot.
- A concise summary of work done.
- The exact heading `## Goal Check`.
- The exact 3-column table header `| Criterion | Evidence | Status |`.
- Raw `stat`/`ls` output or generic prose alone is not enough: pair any shell output with an accepted command, exact test name, ADR reference, or test file path above.
- A concrete `Next action:` line at the bottom.

Example Goal Check table:

| Criterion | Evidence | Status |
|---|---|---|
| Approval owed survives self-review | `test/task-2384-reviewer-self-review-approval-owed.test.ts`, exact reproduction test title | PASS |
| Complete verifier is clean | `./scripts/verify-local.sh all` | PASS |

## Gates
- [ ] ./scripts/verify-local.sh all

## Restricted Areas
- Do not remove or gate the single-family reviewer fallback, or make PR authors ineligible reviewers.
- Do not change Forgejo provider POST behavior, authentication, or `config/agents.json`.
- Do not alter local self-review verdict semantics for integration gating.
- Do not introduce dependencies, invoke real Forgejo in tests, or run real agent launchers from unit tests.
- Do not modify files belonging to other missions.

## Stop Rules
- Stop and request direction if representing approval owed would require changing the meaning of local review verdicts for integration gating.
- Stop and request direction if status cannot expose the state without a new externally visible workflow contract not described here.
- Do not fold TASK-2380 or TASK-2383 fixes into this mission; only report their availability reasons.
- Do not push this mission branch to `origin`; any review push belongs only on the `review` remote.
