# Mission: Web board can start drafting from any worktree (task-2454)

## Goal
Make the web-board Draft action reliably create a mission when Parallix is launched from either the main checkout or a mission worktree, by ensuring the web request reaches the drafting workflow with the correct repository and working-directory context.

## Why Now
The board currently reports that mission authority cannot find the mission after a user presses Draft. This blocks turning backlog work into executable missions and leaves the board state misleadingly unchanged. The failure depends on how Parallix was launched, so it affects both the main checkout and worktree-based development flows.

## Refinement Signals
- Predicted NEL bucket: Medium (81–235)
- Confidence: High
- Selection note: The reported error identifies a bounded handoff between the web-board Draft action and mission-authority execution; scope includes directory resolution for the command and its subcommands.
- Main drivers: reproduce the board-triggered draft failure; trace request-to-command working-directory propagation; preserve direct CLI drafting behavior; lock the regression before changing runtime behavior.

## Scope
- Reproduce the web-board Draft failure from a mission worktree and define a regression test under `test/` before implementing the repair.
- Trace the web-board Draft request through the backend invocation of the mission-authority/drafting command.
- Correct repository-root and working-directory resolution so the Draft workflow can locate its mission and execute required subcommands whether the server starts in the main checkout or a mission worktree.
- Preserve the expected board response and state transition when drafting succeeds.
- Add focused automated coverage for both supported launch locations and run the required verification gate.

## Out of Scope
- Redesigning the web board, its cards, or Draft button UX.
- Changing mission lifecycle semantics, task ownership, or board-stage policy.
- Broad refactoring of unrelated CLI command execution or worktree management.
- Repairing unrelated board actions unless the same shared directory-resolution defect demonstrably blocks Draft.

## Success Criteria
> **Falsifiability rule (ADR 0039 Part 2):** Each criterion must be falsifiable. Forbidden: subjective adjectives ("easy, fast, simple, intuitive, user-friendly, responsive, quick, efficient" without an attached metric) and vague quantifiers ("multiple, several, some, many, few, various"). For refactor / condense / migration missions, the criterion must enumerate the specific elements (rules, files, behaviours) that must survive — generic phrases like "preserve critical content" are not sufficient.

- A regression test at `test/task-2454-web-board-draft-repro.test.js` reproduces a board-initiated Draft request from a mission worktree and fails against the mission parent commit because mission authority cannot locate the target mission.
- The same regression test passes after the repair and verifies that the Draft request resolves the target repository/mission context rather than relying on the server process's current directory.
- Automated coverage verifies successful board-initiated drafting when the backend is launched from both the main checkout and a mission worktree.
- The command path used by the board and every required drafting subcommand receive a resolved repository-root/working-directory context sufficient to locate mission metadata.
- The board reports a successful Draft result for the supported launch locations and does not emit the prior "mission authority could not find the mission" failure for the reproduced scenario.
- `./scripts/verify-local.sh all` completes successfully on the final tree.

## Risks and Assumptions
- Assumption: the failure is caused by process working-directory or repository-root propagation, as indicated by the launch-location-dependent report; investigation may narrow the exact boundary without expanding scope.
- Risk: command wrappers may intentionally inherit the caller directory for other workflows. Preserve explicit caller-provided context and alter only the default/context derived for web-board drafting.
- Risk: worktree and main checkout paths can share repository metadata while having different filesystem roots. Tests must assert the resolved context rather than merely asserting command invocation.
- Risk: the reproduction scenario may require mocked external command boundaries to keep unit tests within the repository's time budget.

## Checkpoints
- CP 1: Author a failing reproduction test at `test/task-2454-web-board-draft-repro.test.js` before any production fix. Simulate a user pressing Draft while the web backend is started from a mission worktree; assert that the target mission is resolved and the draft command is invoked with the repository/working-directory context. At the mission parent commit this test must fail (red) because the workflow reports or causes "mission authority could not find the mission"; after the repair it must pass (green).
- CP 2: Trace the board request, backend handler, drafting command, and subcommand boundaries to identify where launch-directory context is lost. Implement the smallest context-resolution repair and add coverage for main-checkout and mission-worktree server launch locations.
- CP 3: Run the required verification gate, record durable evidence for every success criterion, and prepare the execution handoff.

Reproduction-Test: test/task-2454-web-board-draft-repro.test.ts

### Checkpoint Documentation Requirements
Every checkpoint document (CP-N.md) MUST include:
- A summary of work done.
- The exact heading `## Goal Check`.
- The exact 3-column pipe-delimited table header `| Criterion | Evidence | Status |`.
- At least one evidence row for every success criterion. Lead with durable, verifiable evidence Parallix recognizes today: exact test names, ADR references, test file paths, and recognized repository commands or paths such as `npm ...`, `node ...`, `git ...`, `px ...`, or `./...`. File:line references are accepted when needed but discouraged because line numbers rot.
- For the red-to-green handoff, cite `test/task-2454-web-board-draft-repro.test.js`, its exact test name, and the command that demonstrates its expected state; also cite coverage for both launch locations.
- Raw `stat`/`ls` output or generic prose alone is not enough. If included, pair shell output with an accepted command, test name, test path, or ADR reference above.
- A concrete `Next action:` line at the bottom naming the next investigation, implementation, verification, or handoff action.

Example Goal Check table:

| Criterion | Evidence | Status |
|---|---|---|
| Worktree Draft regression is locked | `test/task-2454-web-board-draft-repro.test.js`, exact reproduction test name | PASS |
| Both supported launch locations are covered | exact launch-context test name and `test/task-2454-web-board-draft-repro.test.js` | PASS |
| Verification gate ran | `./scripts/verify-local.sh all` | PASS |

## Gates
- [ ] ./scripts/verify-local.sh all

## Restricted Areas
- Do not change web-board visual design, backlog task assignment, or mission lifecycle policy.
- Do not modify worktree contents outside the minimum backend/command/test surfaces required to preserve drafting context.
- Do not add real Forgejo, external-agent, or network access to unit tests; mock external command boundaries.
- Do not broaden directory-resolution changes to unrelated commands without a reproduced shared failure and explicit mission-scope justification.

## Stop Rules
- Stop and request direction if reproducing the failure requires changing the board's product behavior rather than repairing repository/working-directory context.
- Stop and request direction if the smallest verified repair would alter mission lifecycle authority, task ownership, or worktree policy.
- Stop and request direction if supporting either launch location requires an external service, credentials, or a non-mockable Forgejo dependency.
- Stop after the regression is green, both launch contexts are covered, and the required gate has passed; do not start review or integration from this mission.
