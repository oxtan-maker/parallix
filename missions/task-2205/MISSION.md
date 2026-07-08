# Mission: Optimize e2e test speed with pre-seeded smoke repo (task-2205)

## Goal

Modify `test/e2e-real-agent-smoke.test.js` so that the smoke repo's backlog task instructs the real AI agent to fix a deliberate typo in a pre-seeded `hello.sh` file instead of creating a program from scratch. The test functionally validates the same production launcher path (real `opencode` binary, real local model inference, real telemetry), but with a much narrower agent scope that reduces token consumption and wall-clock time per test run.

## Why Now

The real-agent smoke test (`test/e2e-real-agent-smoke.test.js`) currently instructs the agent via a backlog task with description "Create a .sh hello world program" (line 320 of the test). The agent must generate a complete shell script from scratch, which consumes significant input/output tokens and takes approximately 4 minutes of wall-clock time (observed: killed at 600s mid-recovery during a relaunch). This test runs as a blocking gate in `config/integration-pipelines.json` (order 51, gate key `custom-agent-smoke`). Every CI run and every developer's local integration pays this cost. Reducing it from ~4 min to ~1 min per run compounds across all CI pipelines and developer workflows.

## Refinement Signals

- Predicted NEL bucket: Small (0–80)
- Confidence: High
- Selection note: single-file test modification with well-defined insertion points
- Main drivers: real-agent smoke test wall-clock time (~4 min per run), token budget per gate run, developer iteration latency during `px integrate`

## Scope

- Modify `test/e2e-real-agent-smoke.test.js` `setupRepository()` function to:
  - Write a `hello.sh` file into the smoke repo root containing a deliberate typo (e.g., `echo "Helo, Wrld!"` instead of `echo "Hello, World!"`)
  - Change the backlog task description from "Create a .sh hello world program" to "Fix the typo in hello.sh"
  - Stage and commit `hello.sh` alongside the other initial smoke repo files (before the `git commit -m 'initial smoke repo'` at line 328)
- Preserve all existing test assertions:
  - `missionBody` must still contain "hello-world" (case-insensitive) — line 502-506 assertion
  - Draft stats must still show non-zero input_tokens and non-zero tool_calls — lines 523-530
  - Review state must still show `reviewer: "custom"`, `disposition: "APPROVED"`, `phase: "approved"` — lines 630-648
  - All artifact assertions (MISSION.md headings, CP-1.md, review-state.json, review-events/) — lines 478-661
- No changes to `lib/` source code.
- No changes to `test/e2e-mission-lifecycle.test.js` (stubbed Tier 1 test).
- No changes to CI configuration or integration pipeline definitions.

## Out of Scope

- Modifying the stubbed lifecycle test (`test/e2e-mission-lifecycle.test.js`).
- Changing the verification gate command (the test's operator refinement at lines 590-593 pins `./scripts/verify-local.sh all`; this stays unchanged).
- Adjusting timeout constants (`RUN_TIMEOUT_MS`, `ACTIVE_TIMEOUT_MS`).
- Adding new test cases or new assertion branches.
- Modifying telemetry collection, stats.csv format, or Parallix state isolation logic.
- Changes to any `lib/` source files.
- Changes to `test/e2e-real-agent-smoke.test.js` assertions beyond what is strictly necessary to accommodate the new task description (the "hello-world" regex at line 502 must still match).

## Success Criteria

> **Falsifiability rule (ADR 0039 Part 2):** Each criterion must be falsifiable. Forbidden: subjective adjectives ("easy, fast, simple, intuitive, user-friendly, responsive, quick, efficient" without an attached metric) and vague quantifiers ("multiple, several, some, many, few, various"). For refactor / condense / migration missions, the criterion must enumerate the specific elements (rules, files, behaviours) that must survive — generic phrases like "preserve critical content" are not sufficient.

- SC1: `hello.sh` exists at the smoke repo root (`hello.sh`) with a deliberate typo string (e.g., `Helo, Wrld!`), committed as part of the initial smoke repo commit (line 328 of `test/e2e-real-agent-smoke.test.js`).
- SC2: The backlog task description in the smoke repo reads "Fix the typo in hello.sh" (replacing the previous "Create a .sh hello world program" at former line 320).
- SC3: The `hello.sh` file is staged and committed in the same `git add .` / `git commit` sequence that establishes the smoke repo (lines 324-328 of the test), so it is present at the start of the `px draft` phase.
- SC4: All 14 existing assertions in the test pass without modification (lines 435-661): required headings, no placeholder markers, hello-world regex match, draft stats sanity, telemetry isolation, operator refinement of Gates, active phase completion, reviewer forced to "custom", disposition "APPROVED", phase "approved", review-events directory present, CP-1.md present with Goal Check heading.
- SC5: `./scripts/verify-local.sh all` passes (unit tests, static analysis, test hygiene).
- SC6: No files under `lib/` are modified.
- SC7: `test/e2e-mission-lifecycle.test.js` is unmodified.

## Risks and Assumptions

- Risk: The real agent might refuse to fix a typo if it interprets the task as trivial and produces an insufficient MISSION.md. Mitigation: the existing draft assertions (lines 478-530) already catch phantom drafts that lack required headings or non-zero tool calls, so this risk is detectable.
- Risk: The agent might "fix" the typo by deleting `hello.sh` entirely rather than correcting it, causing downstream assertions to fail. Mitigation: the test does not currently assert `hello.sh` content post-active-phase, so a deletion would not cause a false pass — it would only matter if a future assertion is added.
- Assumption: The "hello-world" regex at line 502 (`/hello[\s,_-]*world/i`) will still match the MISSION.md content because the agent's output will reference the hello-world context regardless of whether it creates or fixes the file.
- Assumption: The reduced scope translates to proportionally lower token usage and wall-clock time. This is the hypothesis being tested; the mission does not mandate a specific reduction percentage.
- Assumption: The deliberate typo is obvious enough that the agent recognizes it as a typo rather than an intentional stylistic choice. Using `Helo, Wrld!` (missing 'l' and 'o') targets common misspellings.
- Assumption: The smoke repo's `scripts/verify-local.sh` stub (exits 0) is sufficient for the agent's verification gate; no real linting or testing runs against `hello.sh`.

## Checkpoints

- CP 1: Identify the exact lines in `test/e2e-real-agent-smoke.test.js` to modify: the task description at line 320, and the insertion point for `hello.sh` creation (before line 324 where `git init` runs). Draft the code changes in a local branch.
- CP 2: Write the code changes: add `fs.writeFileSync` for `hello.sh` with the typo, update the task description string, and ensure the file is included in the initial `git add .` commit.
- CP 3: Run `./scripts/verify-local.sh all` locally. Verify all unit tests pass and static analysis is clean. Confirm the real-agent smoke test assertions (lines 435-661) would still logically hold with the new task description.

## Gates

- [ ] ./scripts/verify-local.sh all

## Restricted Areas

- `lib/` directory — no source code modifications.
- `test/e2e-mission-lifecycle.test.js` — stubbed Tier 1 test is out of scope.
- `config/integration-pipelines.json` — gate ordering and commands are unchanged.
- `workflow.config.json` — model configuration is unchanged.
- Any documentation files outside `missions/task-2205/MISSION.md`.

## Stop Rules

- Stop if `./scripts/verify-local.sh all` fails due to changes in `lib/` or `test/e2e-mission-lifecycle.test.js` — this indicates scope creep.
- Stop if the "hello-world" regex at line 502 of the test no longer matches with the new task description — this would require redesigning the approach.
- Stop if the agent's expected behavior changes (e.g., the agent refuses to work on pre-existing files) — this would require escalating to discuss alternative approaches rather than continuing to draft.