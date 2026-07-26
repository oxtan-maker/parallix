# Mission: Repair missing-checkpoint handoff bounce (task-2261)

## Goal
When an execute phase completes without a required checkpoint document, classify the missing artifact as a repairable handoff failure, relaunch the implementer with a targeted repair instruction, and retry handoff only after valid checkpoint Goal Check evidence is present.

## Why Now
TASK-2225 showed that a successful execute phase can become stranded at automated handoff when no `CP-N.md` exists. The current response reports manual recovery instructions but does not reliably drive the repair-and-retry lifecycle, leaving the mission neither reviewed nor conclusively failed.

## Refinement Signals
- Predicted NEL bucket: Medium (81–235)
- Confidence: High
- Selection note: activate as-is
- Main drivers: handoff checkpoint discovery, missing-artifact error classification, targeted implementer relaunch prompting, bounded retry/exhaustion behavior, and lifecycle regression coverage

## Scope
- Reproduce the missing-checkpoint handoff scenario with a deterministic implementer fixture.
- Trace checkpoint discovery through handoff error classification, repair relaunch prompting, and retry state.
- Treat a missing `CP-N.md` or checkpoint without the required Goal Check table as a repairable incomplete-evidence failure.
- Make the repair prompt name the missing checkpoint artifact, require `## Goal Check` and the table columns `Criterion | Evidence | Status`, and include the exact `px review <slug> --submit` retry command.
- Cover successful repair, valid-checkpoint unblocking, and repeated missing-evidence exhaustion behavior.

## Out of Scope
- Generating or fabricating checkpoint evidence on an implementer’s behalf.
- Changing the semantic requirements for a valid checkpoint beyond the existing Goal Check contract.
- Altering unrelated review, execute, integration, Forgejo, or mission-branch workflows.
- Retrofitting or repairing TASK-2225’s historical mission artifacts.

## Success Criteria
> **Falsifiability rule (ADR 0039 Part 2):** Each criterion must be falsifiable. Forbidden: subjective adjectives ("easy, fast, simple, intuitive, user-friendly, responsive, quick, efficient" without an attached metric) and vague quantifiers ("multiple, several, some, many, few, various"). For refactor / condense / migration missions, the criterion must enumerate the specific elements (rules, files, behaviours) that must survive — generic phrases like "preserve critical content" are not sufficient.

- A deterministic regression test reproduces an execute-complete mission with no checkpoint document, fails at the mission parent commit, and passes after the repair.
- The handoff lifecycle classifies a missing `CP-N.md` and a checkpoint without a valid `## Goal Check` table as repairable incomplete-evidence failures and does not continue to review submission.
- The targeted relaunch instruction identifies the affected mission, names the required `CP-N.md`, requires the exact heading `## Goal Check` and table columns `Criterion | Evidence | Status`, and supplies `px review <slug> --submit` as the retry command.
- After the implementer fixture creates a valid checkpoint with one evidence row for each mission criterion, the retry completes automated handoff without a missing-checkpoint error.
- When the fixture repeatedly leaves checkpoint evidence invalid or absent, the lifecycle reaches its configured retry/exhaustion boundary and does not submit review.
- Focused tests for the reproduction, targeted relaunch, valid repair retry, and exhaustion path pass, and `./scripts/verify-local.sh all` passes.

## Risks and Assumptions
- Assumption: existing checkpoint validation exposes enough failure detail to distinguish missing files from malformed Goal Check content; otherwise the implementation must add that distinction without broadening validation rules.
- Risk: a generic relaunch can loop without changing the missing artifact; mitigate by asserting the repair prompt contains the mission path, artifact name, Goal Check requirements, and retry command.
- Risk: test fixtures could invoke real agents or Forgejo workflows; all coverage must mock external process, agent, and Forgejo dependencies.
- Risk: retry behavior may affect other handoff failures; retain existing behavior for errors not classified as incomplete checkpoint evidence.

## Checkpoints
- CP 1: Author a failing regression test at `test/task-2261-checkpoint-gates-repro.test.ts` before any production fix. The fixture must model a completed execute phase whose mission directory contains no `CP-N.md`; assert that handoff classifies it as a repairable incomplete-evidence failure and launches a targeted repair flow rather than only emitting the stranded manual instruction. This test must be red at the mission parent commit and green after the repair.
- CP 2: Implement and test checkpoint discovery/classification plus the targeted repair relaunch prompt, including a checkpoint missing a valid Goal Check table.
- CP 3: Cover retry lifecycle outcomes: a valid repaired checkpoint unblocks handoff, while repeated absent or invalid evidence reaches the configured exhaustion boundary without review submission.

Reproduction-Test: test/task-2261-checkpoint-gates-repro.test.ts

### Checkpoint Documentation Requirements
Every checkpoint document (CP-N.md) MUST include:
- A summary that identifies the checkpoint’s completed work and the remaining concrete action.
- The exact heading `## Goal Check`.
- This exact 3-column pipe-delimited table header: `| Criterion | Evidence | Status |`.
- At least one evidence row for every Success Criterion. Parallix accepts existing file:line references, exact repository test names, ADR references, existing test file paths, and recognized repository commands or paths such as backticked `npm ...`, `node ...`, `git ...`, `px ...`, or `./...`.
- Evidence concrete to this mission: cite the reproduction test’s exact test name and path in CP 1; cite changed workflow file:line references and targeted-prompt assertions in CP 2; cite retry/exhaustion test names and verification commands in CP 3.
- Raw `stat`/`ls` output or generic prose alone is not enough. It may supplement evidence only when paired with at least one accepted reference above.
- A non-generic `Next action:` line at the bottom, such as authoring the named reproduction test, implementing the classified relaunch, or running the listed verification command.

## Gates
- [ ] ./scripts/verify-local.sh all

## Restricted Areas
- Do not fabricate, auto-create, or backfill `CP-N.md` evidence for an implementer.
- Do not invoke real Forgejo, external agents, review submission, or network-backed workflows from unit tests.
- Do not change mission ownership/assignee recording, branch-push policy, or unrelated handoff error handling.

## Stop Rules
- Stop if the required behavior cannot be distinguished from non-checkpoint handoff failures without changing the checkpoint validation contract; document the ambiguity and request a product decision.
- Stop if reproducing the failure requires a real agent, Forgejo server, or non-deterministic external process rather than a fully mocked test fixture.
- Stop and escalate if the intended retry/exhaustion boundary is not represented in existing lifecycle configuration or tests and changing that policy is required.
- Never allow review submission to continue when the required checkpoint document or its Goal Check evidence is absent or invalid.
