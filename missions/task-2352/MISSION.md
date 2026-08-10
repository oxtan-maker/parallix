# Mission: Keep execute agents running until the full mission is complete (task-2352)

## Goal
Stop execute agents from exiting after committing any single checkpoint. Agent must run one continuous invocation across all declared checkpoints and only terminate when every declared checkpoint is committed, every mission gate passes, or a stated stop rule / genuine external blocker applies.

## Why Now
On TASK-2332.07, Codex committed CP-1, returned a final response, was resumed, and returned again during CP-2 — no stop rule or blocker triggered. This wastes agent invocations, breaks session continuity, and produces partial missions that slip into review with incomplete implementation. Pre-handoff validation currently only checks "at least one CP-N.md exists" and does not compare against the `## Checkpoints` section declared in MISSION.md.

## Refinement Signals
- Predicted NEL bucket: Medium (81–235)
- Confidence: High
- Selection note: activate as-is
- Main drivers: prompt text change, pre-handoff validation logic, relaunch prompt logic, focused unit tests

## Scope
- `prompts/execute.md` — add explicit non-terminal checkpoint language and enumerate valid terminal conditions
- `src/adapters/cli/commands/active.ts` — `validateCheckpointsBeforeHandoff` must derive declared checkpoint names from MISSION.md `## Checkpoints` section and reject handoff when any declared CP-N.md is missing, invalid (but not uncommitted, that the harness should just help the agent with or other determistic easliry fixed errors)
- `src/adapters/cli/commands/active.ts` — `attemptAgentRelaunch` / relaunch path must emit a continuation instruction naming the next missing checkpoint and preserving the no-final-until-complete contract
- `test/active.test.ts` — fast hermetic unit tests for: single-checkpoint mission, multi-checkpoint with only CP-1, complete checkpoint coverage, malformed checkpoint declarations, and continuation prompt content

## Out of Scope
- Agent-side changes (Codex, Claude, custom agent launchers) — this mission modifies only the Parallix harness prompt and validation
- Review-loop or gatekeeper changes
- Backlog task lifecycle transitions
- Performance benchmarks or integration tests that start real agent processes

## Success Criteria
> **Falsifiability rule (ADR 0039 Part 2):** Each criterion must be falsifiable. Forbidden: subjective adjectives ("easy, fast, simple, intuitive, user-friendly, responsive, quick, efficient" without an attached metric) and vague quantifiers ("multiple, several, some, many, few, various"). For refactor / condense / migration missions, the criterion must enumerate the specific elements (rules, files, behaviours) that must survive — generic phrases like "preserve critical content" are not sufficient.

- SC1: `prompts/execute.md` contains the phrase "non-terminal" or "must not exit" in the checkpoint completion paragraph, and lists exactly three valid terminal conditions: (a) all declared checkpoints committed, (b) mission stop rule applies, (c) genuine external dependency blocks progress
- SC2: `validateCheckpointsBeforeHandoff` reads MISSION.md `## Checkpoints` section, extracts declared CP-N names (e.g., CP-1, CP-2), and returns `{ok: false}` with a diagnostic listing each missing checkpoint name when any declared CP-N.md is absent from the mission directory
- SC3: A multi-checkpoint mission with only CP-1 committed returns `{ok: false}` from `validateCheckpointsBeforeHandoff` and does not reach `performHandoff` or `startReviewLoop`
- SC4: The relaunch/continuation prompt for incomplete missions contains the name of the next missing checkpoint (e.g., "CP-2") and the phrase "do not exit" or "must not send a final response"
- SC5: Five focused unit tests exist under `test/` covering: single-checkpoint mission passes validation, multi-checkpoint with only CP-1 fails validation, complete checkpoint coverage passes, malformed checkpoint declarations fail, and continuation prompt contains next checkpoint name. All tests mock dependencies and do not start real agent CLI, Forgejo process, or recursive workflow commands

## Risks and Assumptions
- Parsing MISSION.md `## Checkpoints` section assumes the format `- CP N: <name>` or `- CP-N: <name>`; non-standard formats may miss declarations. Mitigation: use the same regex pattern already used by `findCheckpoints` for file matching
- Agent relaunch path assumes the agent respects the continuation prompt; if agent ignores instructions, the bug persists at the agent level. This mission fixes the harness contract; agent compliance is a separate concern
- Existing `validateCheckpointsBeforeHandoff` callers (e.g., `runHandoffAndReview`) pass `slug` and `worktree`; new MISSION.md parsing adds a file read but no new parameters

## Checkpoints
- CP 1: Update `prompts/execute.md` with explicit non-terminal checkpoint language and enumerated terminal conditions
- CP 2: Implement pre-handoff checkpoint completeness validation in `validateCheckpointsBeforeHandoff` (derive declared names from MISSION.md, reject missing CP-N.md, emit diagnostic)
- CP 3: Update relaunch/continuation prompt to name next missing checkpoint and preserve no-final-until-complete contract
- CP 4: Author focused unit tests and verify with `./scripts/verify-local.sh all`

### Checkpoint Documentation Requirements
Every checkpoint document (CP-N.md) MUST include:
- A summary of work done
- A `## Goal Check` section
- A 3-column pipe-delimited markdown table with columns: Criterion | Evidence | Status
- At least one evidence row per criterion using verifiable references. Parallix already accepts:
  1. **File:line references** — e.g., `lib/commands/handoff.ts:292` (must point to an existing file and line)
  2. **Test names** — e.g., `"real custom-agent launcher smoke: full lifecycle with hello-world task (SC3/SC4/SC5/SC6/SC7)"` (must match a test name in the repo)
  3. **Test file paths** — e.g., `test/e2e-real-agent-smoke.test.ts` (must be an existing test file)
  4. **ADR references** — e.g., `ADR 0048` (must correspond to an existing file under `docs/adr/`)
  5. **Recognized repo commands or paths** — e.g., `` `npm test -- test/repair-handoff.test.ts` ``, `` `px review <slug> --verify` ``, or `` `./scripts/verify-local.sh all` ``
- Raw `stat`/`ls` output or generic prose may appear as supplemental context, but pair them with one of the accepted references above
- A non-generic `Next action:` line at the bottom

Example Goal Check table:

| Criterion | Evidence | Status |
|---|---|---|
| Draft prompt defines checkpoint evidence rules | `prompts/draft.md:28` | PASS |
| Repair loop has targeted incomplete-evidence coverage | `test/repair-handoff.test.ts`, `"buildRelaunchPrompt returns string containing Goal Check table and mission slug"` | PASS |
| Verification gate ran | `./scripts/verify-local.sh docs` | PASS |

## Gates
- [ ] `./scripts/verify-local.sh all`

## Restricted Areas
- `src/adapters/agents/codex.ts` and other agent launcher files — no changes to agent-side logic
- `src/adapters/cli/commands/handoff.ts` — no changes to `performHandoff` internals; validation happens before handoff is called
- `src/application/execute-mission-service.ts` — no changes to the service orchestration; validation is in the CLI adapter layer
- Review-loop (`src/adapters/review/review-loop.ts`) and gatekeeper — out of scope for this mission

## Stop Rules
- Stop if parsing MISSION.md `## Checkpoints` reveals a format incompatible with the existing `- CP N:` / `- CP-N:` pattern and the backlog task needs re-scoping
- Stop if pre-handoff validation requires a new port or dependency injection that exceeds the Medium NEL bucket (would need architecture migration task)
- Stop if unit tests cannot mock `findCheckpoints` or MISSION.md file reads without introducing recursion into the CLI command layer
