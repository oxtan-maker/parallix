# Mission: Remove redundant Claude Bash labels (task-2474)

## Goal
Remove the redundant `Bash` prefix from Claude-agent command transcript entries so terminal output presents the command itself without losing command text, tool output, or status information.

## Why Now
Claude command transcripts currently spend a visible line prefix on the tool name (`Bash`), which adds noise to routine mission output and obscures the command users need to read.

## Refinement Signals
- Predicted NEL bucket: Small (0–80)
- Confidence: High
- Selection note: activate as-is
- Main drivers: Claude transcript readability; isolated presentation behavior; existing Claude adapter and CLI formatting coverage.

## Scope
- Trace the Claude agent event-to-terminal presentation path and remove only the redundant command-tool label from rendered Claude command entries.
- Preserve each rendered command's shell text, captured output, exit/status indication, ordering, and existing color/status conventions.
- Add focused automated coverage for the Claude command rendering contract, including an assertion that a command entry has no `Bash` prefix.
- Retain the current rendering behavior for non-Claude agents and for Claude prose, errors, and non-command events.

## Out of Scope
- Changing the shell used to launch Claude or the command Claude actually executes.
- Altering Claude prompts, agent selection, streaming/event transport, transcript persistence, or historical transcripts.
- Reformatting unrelated CLI output or changing any other agent's command labels.

## Success Criteria
> **Falsifiability rule (ADR 0039 Part 2):** Each criterion must be falsifiable. Forbidden: subjective adjectives ("easy, fast, simple, intuitive, user-friendly, responsive, quick, efficient" without an attached metric) and vague quantifiers ("multiple, several, some, many, few, various"). For refactor / condense / migration missions, the criterion must enumerate the specific elements (rules, files, behaviours) that must survive — generic phrases like "preserve critical content" are not sufficient.

- A Claude command event is rendered without a standalone or prefixed `Bash` tool label while its original command text remains visible.
- Claude command output and command completion/status information remain rendered for the same event sequence.
- Focused tests cover the label removal and preservation of command text/output, and existing non-Claude rendering coverage remains green.
- `./scripts/verify-local.sh all` exits successfully on the completed mission tree.

## Risks and Assumptions
- Assumption: the unwanted text is presentation metadata emitted for Claude command events, not part of the command payload or command output.
- Risk: a broad formatter change could affect other agents; constrain the change to the Claude event path and assert non-Claude behavior remains unchanged.
- Risk: stripping arbitrary `Bash` text could corrupt legitimate command output; remove only structured label metadata, never command/output content.

## Checkpoints
- CP 1: Map the Claude event payload, adapter, and terminal presentation boundary; record the exact event shape that introduces the `Bash` label and identify the focused test file to extend.
- CP 2: Make the smallest presentation-only change and add focused tests showing that Claude command text, output, and completion/status survive while the label is absent; include an unchanged non-Claude case if the shared formatter is touched.
- CP 3: Run the required verification gate, inspect the final diff for scope compliance, and record completed Goal Check evidence.

### Checkpoint Documentation Requirements
Every checkpoint document (CP-N.md) MUST include:
- A summary of work done
- Lead each evidence row with durable evidence Parallix verifies today: exact test names, ADR references, test file paths, and recognized repository commands or paths such as backticked `npm ...`, `node ...`, `git ...`, `px ...`, or `./...`. File:line references are accepted but discouraged because line numbers rot.
- Use the exact heading `## Goal Check`.
- Include the exact 3-column table header `| Criterion | Evidence | Status |` and at least one evidence row for every success criterion.
- Cite the focused Claude-rendering test by its exact test name and test-file path; cite `./scripts/verify-local.sh all` when recording final verification.
- Raw `stat`/`ls` output or generic prose alone is not enough; pair any shell output with one of the accepted references above.
- End with a non-generic `Next action:` line.

Example Goal Check table:

| Criterion | Evidence | Status |
|---|---|---|
| Draft prompt defines checkpoint evidence rules | `prompts/draft.md` | PASS |
| Repair loop has targeted incomplete-evidence coverage | `test/repair-handoff.test.ts`, `"buildRelaunchPrompt returns string containing Goal Check table and mission slug"` | PASS |
| Verification gate ran | `./scripts/verify-local.sh docs` | PASS |

## Gates
- [ ] ./scripts/verify-local.sh all

## Restricted Areas
- Do not modify the Claude process launcher, shell command construction, prompts, or agent-selection configuration.
- Do not change `src/application/presentation/cli-format.ts` behavior for agents other than Claude unless a shared formatter makes it unavoidable and focused regression coverage proves their output unchanged.
- Do not add dependencies, migrate transcript storage, or edit authored documentation for this presentation-only correction.

## Stop Rules
- Stop and request direction if the `Bash` text is emitted by Claude as command/output payload rather than structured presentation metadata; removing it could discard user-visible command data.
- Stop and request direction if removing the label requires changing Claude's launcher, prompt, protocol, transcript schema, or another agent's rendering contract.
- Stop if focused coverage cannot distinguish the label from legitimate `Bash` text in a command or output; establish that boundary before changing production behavior.
