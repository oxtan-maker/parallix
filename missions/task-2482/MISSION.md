# Mission: Remove the unused px checkpoint command and its verification footgun (task-2482)

## Goal
Retire the unused `px checkpoint` CLI command and every command-specific surface while preserving the workflow's checkpoint evidence, resume, execution-commit, and review-transition validation behavior.

## Why Now
The command has no internal workflow caller or execution-prompt instruction, yet it performs repository verification before staging and committing. Keeping it exposed lets agents choose an unnecessary expensive path and has already produced inaccurate guidance that verification runs at every execution checkpoint.

## Refinement Signals
- Predicted NEL bucket: Medium (81–235)
- Confidence: High
- Selection note: activate as-is; the backlog acceptance criteria identify both the command-owned removal surfaces and the workflow behaviors that must remain.
- Main drivers: CLI registration and help, checkpoint command implementation and tests, execution guidance, legacy command copies, checkpoint-evidence recording, resume recovery, and handoff validation.

## Scope
- Remove `px checkpoint` from CLI composition, command dispatch, help, suggestions, and executable command-only adapters/use cases.
- Remove tests and legacy copies that exclusively characterize the retired command.
- Remove live agent guidance and documentation that tells agents to invoke `px checkpoint` or says every execution checkpoint automatically runs verification.
- Retain and characterize the existing execution checkpoint-evidence recording and commit path, resume consumption of checkpoint evidence, and review/handoff checkpoint-evidence validation.
- Update focused tests to prove both absence of the retired command and survival of the required checkpoint lifecycle behavior.

## Out of Scope
- Removing checkpoint evidence, progress commits, resume context, or checkpoint records as workflow concepts.
- Changing the verification gates owned by handoff, review, or integration transitions.
- Rewriting historical mission records, completed mission artifacts, or archived documentation.
- Broad CLI redesigns unrelated to the `checkpoint` subcommand.

## Success Criteria
> **Falsifiability rule (ADR 0039 Part 2):** Each criterion must be falsifiable. Forbidden: subjective adjectives ("easy, fast, simple, intuitive, user-friendly, responsive, quick, efficient" without an attached metric) and vague quantifiers ("multiple, several, some, many, few, various"). For refactor / condense / migration missions, the criterion must enumerate the specific elements (rules, files, behaviours) that must survive — generic phrases like "preserve critical content" are not sufficient.

- SC1: `px checkpoint` is absent from CLI registration, help output, command suggestions, and live execution guidance; invoking that subcommand cannot invoke repository verification, stage files, or create a commit.
- SC2: The retired command's dedicated implementation, adapters/use case, and command-only tests, including obsolete legacy copies, are removed; no remaining production import or test targets the retired command implementation.
- SC3: During execution, the workflow still writes checkpoint evidence, creates the required local progress commit, and can resume using that evidence without the retired CLI command.
- SC4: Starting the review/handoff transition still records and validates required checkpoint evidence, and verification remains owned by its intended lifecycle transition rather than an execution checkpoint command.
- SC5: Live documentation and agent prompts contain neither an instruction to run `px checkpoint` nor a claim that every execution checkpoint runs verification; historical mission records are unchanged.
- SC6: Focused tests for CLI command exposure and checkpoint lifecycle behavior pass, with no `.only`, bare `.skip`, or real Forgejo access introduced; `npm test -- --unit-test-headroom`, `./scripts/verify-local.sh static-analysis`, and `./scripts/verify-local.sh all` pass on the final tree.

## Risks and Assumptions
- Risk: command discovery may have indirect aliases or legacy copies beyond the named files; mitigate by tracing registration, help, suggestions, imports, tests, and prompt references before deletion.
- Risk: deleting command-owned code can accidentally remove the separate checkpoint-recording path; mitigate with focused execution-resume and handoff/review lifecycle tests before and after deletion.
- Risk: live guidance and historical records have different retention rules; update only current prompts and documentation, leaving mission history intact.
- Assumption: the backlog investigation remains correct that no supported internal workflow invokes `px checkpoint`.
- Assumption: intended verification continues at handoff/review and integration lifecycle gates, not per execution checkpoint.

## Checkpoints
- CP 1: Map every `px checkpoint` registration, implementation, help/suggestion, test, prompt, and documentation reference; separately identify the execution evidence/commit, resume, and handoff/review validation paths that must survive.
- CP 2: Remove the command-owned surfaces and update focused tests and live guidance; prove the command is unavailable without relying on its former verification/stage/commit behavior.
- CP 3: Verify surviving checkpoint lifecycle behavior for execution, resume, and review/handoff; run the required focused and repository gates, then record final goal-check evidence.

### Checkpoint Documentation Requirements
Every checkpoint document (CP-N.md) MUST lead its evidence with durable references Parallix verifies today: exact test names, ADR references, test file paths, and recognized repository commands or paths such as `npm ...`, `node ...`, `git ...`, `px ...`, or `./...`. File:line references are accepted when needed but discouraged because line numbers rot.

Every checkpoint document (CP-N.md) MUST include:
- A summary of work done.
- The exact heading `## Goal Check`.
- The exact 3-column pipe-delimited table header `| Criterion | Evidence | Status |` with at least one durable evidence row for every success criterion.
- Evidence for command removal using the relevant CLI/help test name or test path; evidence for retained workflow behavior using the execution/resume and handoff/review test names or paths; and evidence for gates using the exact recognized command run.
- Raw `stat`/`ls` output or generic prose is not enough. If used as supplemental context, pair it with an accepted command, test name, test path, ADR reference, or recognized repository path above.
- A non-generic `Next action:` line at the bottom that identifies the next removal, preservation, or verification action.

Example Goal Check table:

| Criterion | Evidence | Status |
|---|---|---|
| SC1: command is no longer exposed | relevant CLI command test name and test file path | PASS |
| SC3: execution evidence and resume survive | relevant execution/resume lifecycle test name and test file path | PASS |
| SC6: repository verification completed | `./scripts/verify-local.sh all` | PASS |

## Gates
- [ ] npm test -- --unit-test-headroom
- [ ] ./scripts/verify-local.sh static-analysis
- [ ] ./scripts/verify-local.sh all

## Restricted Areas
- Do not alter checkpoint evidence records, progress-commit semantics, resume context, or review/handoff evidence validation except where a command-only dependency must be removed while preserving its behavior.
- Do not modify historical mission records or archived documentation.
- Do not change verification policy, integration-gate configuration, or unrelated CLI subcommands.
- Do not add network-dependent tests or tests that contact real Forgejo.

## Stop Rules
- Stop and request direction if reference tracing shows a supported external caller or documented user workflow that depends on `px checkpoint`.
- Stop and request direction if removing the command requires changing the semantics of execution evidence, local progress commits, resume recovery, or review/handoff validation rather than preserving them.
- Stop and request direction if the only way to satisfy the task changes verification ownership outside the retired command or requires rewriting historical mission records.
