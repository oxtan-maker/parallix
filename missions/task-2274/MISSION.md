# Mission: Route role-owned review artifact failures to their producing agent (task-2274)

## Goal
Make autonomous review-artifact recovery route each missing or malformed artifact back to the agent role that produced it, with persisted, bounded retry state and ADR 0048 HumanOnly handling preserved for infrastructure and task-state failures.

## Why Now
The review loop has recovery paths for reviewer outcomes and implementer dispositions but no single role-aware dispatcher for artifact failures. This gap can send a reviewer-owned failure to the implementer during an implementation cycle, wasting a recovery attempt and leaving ownership ambiguous.

## Refinement Signals
- Predicted NEL bucket: Medium (81–235)
- Confidence: High
- Selection note: activate as-is
- Main drivers: shared artifact-consumer inventory; ADR 0048 classification integration; persisted per-role retry bounds; focused regression coverage for reviewer and implementer recovery paths

## Scope
- Inventory review-loop artifact consumers and map each reviewed artifact category to its producing role.
- Add one role-owned recovery dispatcher that consumes the existing ADR 0048 classification and persisted review state.
- Route missing or malformed reviewer findings, outcome, and verdict artifacts to reviewer relaunch handling with a captured diagnostic.
- Route missing or malformed implementation code or checkpoint, round-resolution, and PR-disposition artifacts to implementer relaunch handling with a captured diagnostic.
- Persist and bound retry counts independently for reviewer and implementer artifact recovery; expose an actionable stranded state when the producing role exhausts its bound.
- Add focused regression coverage for absent and malformed artifacts, both producing roles, retry exhaustion, and resulting task-state transitions.

## Out of Scope
- Changing ADR 0048 policy decisions or retry limits outside the role-owned artifact dispatcher.
- Automatically relaunching agents for Forgejo, authentication, infrastructure, or task-state failures.
- Altering normal successful reviewer or implementer handoff behavior.
- Redesigning the review-loop CLI, mission lifecycle, or Forgejo integration.

## Success Criteria
> **Falsifiability rule (ADR 0039 Part 2):** Each criterion must be falsifiable. Forbidden: subjective adjectives ("easy, fast, simple, intuitive, user-friendly, responsive, quick, efficient" without an attached metric) and vague quantifiers ("multiple, several, some, many, few, various"). For refactor / condense / migration missions, the criterion must enumerate the specific elements (rules, files, behaviours) that must survive — generic phrases like "preserve critical content" are not sufficient.

- Missing and malformed reviewer findings, outcome, and verdict artifacts each produce a captured diagnostic and select reviewer relaunch rather than implementer relaunch.
- Missing and malformed implementation code or checkpoint, round-resolution, and PR-disposition artifacts each produce a captured diagnostic and select implementer relaunch rather than reviewer relaunch.
- Reviewer and implementer artifact-recovery attempts use separately persisted counters; each counter stops automatic relaunch at its configured bound and records an actionable stranded task state.
- Forgejo, authentication, infrastructure, and task-state failures remain classified HumanOnly and do not enqueue either reviewer or implementer relaunch.
- Regression tests exercise absent and malformed artifacts for both roles, retry-bound exhaustion, and the corresponding task-state transitions.
- `./scripts/verify-local.sh static-analysis` completes successfully on the final mission tree.

## Risks and Assumptions
- Assumes ADR 0048 and the existing classifier remain the authority for AutoSendBack versus HumanOnly decisions; the dispatcher must not duplicate or reinterpret that policy.
- Artifact consumers may share error paths, so the inventory must distinguish the producer of the failed artifact from the agent currently active in the mission cycle.
- Persisted review state may be read by lifecycle recovery paths outside the immediate dispatcher; counter changes must preserve existing state compatibility and terminal-state semantics.
- Tests must mock external Forgejo and agent-launch dependencies so unit coverage does not contact a real Forgejo instance or start costly agents.

## Checkpoints
- CP 1: Inventory the review-loop artifact consumers, identify the producing role for reviewer findings/outcome/verdict and implementer code/checkpoint/round-resolution/PR-disposition artifacts, and record how the existing ADR 0048 classifier and persisted review state are consumed.
- CP 2: Add the role-owned artifact recovery dispatcher and integrate all scoped artifact-failure paths so reviewer and implementer failures select their respective relaunch handling, while HumanOnly classifications remain terminal for automation.
- CP 3: Add focused mocked regression tests covering absent and malformed artifacts for every scoped category, independent persisted retry counts, retry exhaustion to stranded state, and HumanOnly failure categories; run the required verification gate.

### Checkpoint Documentation Requirements
Every checkpoint document (CP-N.md) MUST lead its evidence with durable Parallix-recognized references: exact test names, ADR references such as `ADR 0048`, test file paths under `test/`, and recognized repository commands or paths such as `npm ...`, `node ...`, `git ...`, `px ...`, or `./scripts/verify-local.sh static-analysis`. File:line references are accepted when necessary but discouraged because line numbers rot.

Every checkpoint document (CP-N.md) MUST include:
- A summary of work done.
- An exact heading `## Goal Check`.
- The exact 3-column pipe-delimited table header `| Criterion | Evidence | Status |`.
- At least one evidence row per Success Criterion. Pair raw `stat`/`ls` output or generic prose with one of the accepted references above; shell output or generic prose alone is not enough.
- For CP 1, the artifact-to-producing-role inventory and the ADR 0048 policy reference.
- For CP 2, the dispatcher integration evidence and the reviewer versus implementer routing evidence.
- For CP 3, exact regression-test names or test-file paths, retry-exhaustion and HumanOnly evidence, and the required verification command.
- A non-generic `Next action:` line at the bottom.

Example Goal Check table:

| Criterion | Evidence | Status |
|---|---|---|
| Reviewer artifacts return to reviewer | `ADR 0048`; exact targeted test name | PASS |
| Role retry bounds strand exhausted recovery | target test file under `test/` | PASS |
| Static analysis completed | `./scripts/verify-local.sh static-analysis` | PASS |

## Gates
- [ ] ./scripts/verify-local.sh all

## Restricted Areas
- Do not change the AutoSendBack/HumanOnly decisions defined by ADR 0048.
- Do not add automated recovery for Forgejo, authentication, infrastructure, or task-state failures.
- Do not contact real Forgejo services or launch real coding agents from unit tests.
- Do not modify unrelated mission lifecycle, CLI presentation, or external integration behavior.

## Stop Rules
- Stop and request direction if the required ownership mapping cannot be derived without changing ADR 0048 or adding a new policy decision.
- Stop and request direction if a failure category has no identifiable producing role or must be handled by a third role not named in this mission.
- Stop and request direction if persisted retry-state changes require a migration or break compatibility with existing mission state.
- Stop and request direction if the required regression tests cannot be isolated from real Forgejo access or real agent execution.
