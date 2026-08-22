# Mission: Align operator UIs on truthful agent activity semantics (task-2389)

Base-Branch: main

## Goal
Define one interface-neutral mission-activity read model and use it in the operator TUI and `px status`, so each surface states only whether authoritative operation work or recovery-only coordinator-process evidence exists, including its certainty and lifecycle state.

## Why Now
The agent strip currently turns a live px coordinator into an exact “N running” agent claim even when the coordinator is in a non-agent phase or agents launched from `px ui` are not observable. `px status` then omits both facts, leaving operators with contradictory views of the same mission.

## Refinement Signals
- Predicted NEL bucket: Medium (81–235)
- Confidence: High
- Selection note: dependencies TASK-2387 and TASK-2388 establish the mission-operation and coordinator evidence inputs this mission must present consistently.
- Main drivers: shared projection semantics; truthful TUI wording; selected-mission CLI parity; focused rendering coverage.

## Scope
- Define a shared read projection that separately represents authoritative mission operation work and recovery-only live px coordinator-process evidence.
- Preserve `live`, `unknown`, `stale`, and `stopped` evidence semantics in that projection rather than inferring agent counts in a consumer.
- Update `src/interfaces/tui/agent-strip.tsx` to render evidence-qualified activity or authoritative mission work without calling coordinator evidence an exact running-agent count.
- Update `px status` through `src/application/ports/cli-workflows.ts` and `src/interfaces/cli/status.ts` to display the selected mission’s same activity and uncertainty state.
- Specify explicit projection behavior for overlapping operations and unattributed agent families.
- Add focused tests covering the shared projection and both operator renderings for the required activity states.

## Out of Scope
- Creating a durable Attempt aggregate or recording per-launch identity and concurrent agent lifecycle history.
- Deriving exact agent counts from coordinator process liveness without a real launcher lifecycle source.
- Changing unrelated board, backlog, mission lifecycle, or coordinator execution behavior.
- Redesigning the broader TUI or `px status` output beyond mission activity wording and state.

## Success Criteria
> **Falsifiability rule (ADR 0039 Part 2):** Each criterion must be falsifiable. Forbidden: subjective adjectives ("easy, fast, simple, intuitive, user-friendly, responsive, quick, efficient" without an attached metric) and vague quantifiers ("multiple, several, some, many, few, various"). For refactor / condense / migration missions, the criterion must enumerate the specific elements (rules, files, behaviours) that must survive — generic phrases like "preserve critical content" are not sufficient.

- The shared mission-activity projection exposes authoritative operation work separately from coordinator-process recovery evidence, with distinct `live`, `unknown`, `stale`, and `stopped` states.
- `agent-strip.tsx` never renders coordinator-process evidence as an exact running-agent count; its live-coordinator rendering identifies the evidence as an active px command or uses authoritative mission-work wording.
- For a selected mission, `px status` renders the same authoritative-work state and coordinator-evidence lifecycle/uncertainty state consumed by the TUI.
- The projection defines deterministic output for overlapping operations and unattributed families without overwriting or claiming an exact agent count.
- Focused rendering tests cover live authoritative work, recovery-only live coordinator evidence, unknown evidence, stale evidence, blocked work, and idle work in both the TUI and status CLI paths.
- `./scripts/verify-local.sh static-analysis` passes; if any user-facing terminology changes in authored documentation, `./scripts/verify-local.sh docs` also passes.

## Risks and Assumptions
- TASK-2387 and TASK-2388 provide usable operation-work and coordinator-process evidence; this mission must not invent a persistence model when either source lacks per-launch identity.
- A coordinator can remain live while no agent is running, so process liveness is recovery evidence only.
- Concurrent operations and unattributed families may be observable without a reliable mapping to individual agents; the projection must retain uncertainty rather than manufacture precision.
- Existing text-output tests may couple to wording, so intentional output changes require focused assertion updates instead of broad snapshots.

## Checkpoints
- CP 1: Trace the current TUI and status read paths, define the interface-neutral activity projection and its state matrix for authoritative work, recovery evidence, overlapping operations, and unattributed families.
- CP 2: Route the agent strip and selected-mission `px status` through the shared projection, using only wording supported by the available evidence.
- CP 3: Add focused projection and rendering tests for live, recovery-only, unknown, stale, blocked, and idle cases; run required verification and record the Goal Check evidence.

### Checkpoint Documentation Requirements
Every checkpoint document (CP-N.md) MUST include:
- A summary of work done.
- The exact heading `## Goal Check`.
- The exact 3-column table `| Criterion | Evidence | Status |` with at least one row for every Success Criterion.
- Durable evidence first: exact test names in the activity-projection, agent-strip, and status test files; test file paths under `test/`; any applicable ADR reference; and recognized commands or paths such as `npm test -- test/status.test.ts`, `node --test test/status.test.ts`, `git diff --check`, `px status <mission>`, or `./scripts/verify-local.sh static-analysis`. File:line references are accepted parenthetically but discouraged because line numbers rot.
- Raw `stat`/`ls` output or generic prose alone is not enough; pair any shell output with an accepted command, test name, test-file path, or ADR reference above.
- A non-generic `Next action:` line at the bottom that names the next projection, consumer, test, or gate action.


## Gates
- [ ] ./scripts/verify-local.sh all
- [ ] ./scripts/verify-local.sh static-analysis

## Restricted Areas
- Do not add a durable Attempt aggregate, launcher persistence, or per-launch identity model.
- Do not modify coordinator process management, mission execution workflow behavior, or backlog/board lifecycle semantics except where the shared read projection must consume their existing evidence.
- Do not make recovery-only coordinator evidence appear as an exact agent count in any operator surface.

## Stop Rules
- Stop and request direction if truthful parity requires exact concurrent per-launch identity or lifecycle history that existing authoritative sources do not provide.
- Stop and request direction if TASK-2387 or TASK-2388 has not landed with the operation-work or coordinator-evidence contract this mission assumes.
- Stop and request direction if supporting the selected-mission CLI would require changing unrelated `px status` output contracts beyond mission activity semantics.
