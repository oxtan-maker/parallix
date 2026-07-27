# Mission: Ink TUI wave 7 — default no-command TTY launch (task-2309)

## Goal
Make `px` launch the Ink board when invoked without a command from an interactive TTY, while preserving the exact existing no-command behavior for every non-TTY invocation and retaining explicit `px ui` support. Provide a documented, tested opt-out that restores the prior TTY no-command behavior.

## Why Now
This is the final, deliberately isolated policy flip in the seven-wave Ink TUI rollout. ADR 0051 and TASK-2282 require `px ui` to remain explicit until the non-TTY and compatibility gates are green; waves 1–6 must therefore be complete before this change is attempted. Keeping this flip separate makes it safe to revert if compatibility evidence is insufficient.

## Refinement Signals
- Predicted NEL bucket: Small (0–80)
- Confidence: High
- Selection note: Activate only after TASK-2308 and waves 1–6 are done with their compatibility gates green.
- Main drivers: no-command invocation routing, TTY detection, opt-out policy, non-TTY isolation, help and user documentation, and focused regression coverage.

## Scope
- Change the no-command `px` invocation policy so an interactive TTY launches the existing board UI.
- Preserve explicit `px ui` invocation and its existing board-launch behavior.
- Preserve the current byte-for-byte stdout/stderr behavior and exit code for no-command non-TTY paths, including piped, CI, and redirected-output execution.
- Add one documented opt-out through an environment variable or configuration setting that restores the prior TTY no-command behavior.
- Add focused tests covering TTY default launch, explicit `px ui`, non-TTY output/exit-code compatibility, opt-out behavior, and absence of Ink import or initialization on non-TTY paths.
- Update help text and user documentation to state the new interactive default and the opt-out.
- Keep the implementation as one reversible commit after its tests and documentation are included.

## Out of Scope
- Changes to the Ink board’s features, layout, navigation, rendering, or workflow behavior.
- Changing the behavior, output, or exit codes of `px` with an explicit non-UI command.
- Enabling Ink for non-TTY, piped, CI, or redirected-output invocation.
- Redesigning global CLI configuration or adding unrelated configuration options.
- Bundling feature work from any other Ink TUI wave into this policy flip.

## Success Criteria
> **Falsifiability rule (ADR 0039 Part 2):** Each criterion must be falsifiable. Forbidden: subjective adjectives ("easy, fast, simple, intuitive, user-friendly, responsive, quick, efficient" without an attached metric) and vague quantifiers ("multiple, several, some, many, few, various"). For refactor / condense / migration missions, the criterion must enumerate the specific elements (rules, files, behaviours) that must survive — generic phrases like "preserve critical content" are not sufficient.

- SC1: A no-command `px` invocation detected as interactive TTY launches the same board entry point used by explicit `px ui`; a focused automated test proves both invocations remain supported.
- SC2: For no-command invocations without a TTY, automated tests compare the pre-flip-compatible stdout/stderr bytes and exit code for pipe, CI, and redirected-output scenarios; each matches the prior behavior exactly.
- SC3: A documented opt-out environment variable or configuration setting makes a no-command interactive-TTY invocation follow the prior non-board behavior, and a focused test proves that result.
- SC4: Focused non-TTY tests prove no Ink module import and no Ink initialization occur on the non-TTY paths covered by SC2.
- SC5: CLI help text and the relevant user-facing documentation state that no-command interactive TTY use opens the board, that `px ui` remains available, and how to use the opt-out.
- SC6: The implementation, tests, and documentation are delivered as a single reversible commit whose revert restores explicit-only `px ui` behavior.
- SC7: `./scripts/verify-local.sh all` and `./scripts/verify-local.sh static-analysis` complete successfully on the final tree.

## Risks and Assumptions
- Assumption: TASK-2308 and waves 1–6 are complete and their required compatibility gates are green before implementation begins.
- Risk: TTY detection differs across local terminals, pipes, CI environments, and redirected streams; mitigate with explicit test doubles or fixtures for each invocation mode.
- Risk: importing the UI module too early can initialize Ink on non-TTY paths; keep UI loading behind the successful TTY and opt-out decision, with import/init isolation tests.
- Risk: an opt-out can create an ambiguous or undocumented support path; select one narrowly scoped mechanism and document its exact effect and precedence.
- Risk: byte compatibility can regress through incidental help, logging, or stream changes; snapshot or direct byte/exit-code comparisons must use the established no-command baseline.

## Checkpoints
- CP 1: Confirm the wave prerequisites and map the existing no-command, explicit `px ui`, TTY-detection, UI-loading, and documentation paths. Record the selected opt-out mechanism and the non-TTY baseline evidence before editing behavior.
- CP 2: Author focused tests for the TTY default launch, explicit `px ui`, pipe/CI/redirected non-TTY compatibility, opt-out, and Ink import/initialization isolation. Establish the expected non-TTY byte and exit-code assertions before changing routing.
- CP 3: Implement the isolated invocation-policy flip and opt-out, update help and documentation, then make the complete change a single reversible commit.
- CP 4: Run the required gates, verify the one-commit reversible boundary, and record final criterion-by-criterion evidence.

### Checkpoint Documentation Requirements
Every checkpoint document (CP-N.md) MUST include:
- A summary of work done
- The exact heading `## Goal Check`
- The exact 3-column pipe-delimited markdown table header `| Criterion | Evidence | Status |`
- At least one evidence row per success criterion using verifiable references. Parallix already accepts:
  1. **File:line references** — e.g., `lib/commands/handoff.ts:292` (must point to an existing file and line)
  2. **Test names** — e.g., `"real custom-agent launcher smoke: full lifecycle with hello-world task (SC3/SC4/SC5/SC6/SC7)"` (must match a test name in the repo)
  3. **Test file paths** — e.g., `test/e2e-real-agent-smoke.test.ts` (must be an existing test file)
  4. **ADR references** — e.g., `ADR 0048` (must correspond to an existing file under `docs/adr/`)
  5. **Recognized repo commands or paths** — e.g., `` `npm test -- test/repair-handoff.test.ts` ``, `` `px review <slug> --verify` ``, or `` `./scripts/verify-local.sh all` ``
- Raw `stat`/`ls` output or generic prose alone is not enough: it may appear only as supplemental context and must be paired with one of the accepted references above.
- A non-generic `Next action:` line at the bottom, such as identifying the next test, routing change, documentation edit, or gate to run.

Example Goal Check table:

| Criterion | Evidence | Status |
|---|---|---|
| Draft prompt defines checkpoint evidence rules | `prompts/draft.md:28` | PASS |
| Repair loop has targeted incomplete-evidence coverage | `test/repair-handoff.test.ts`, `"buildRelaunchPrompt returns string containing Goal Check table and mission slug"` | PASS |
| Verification gate ran | `./scripts/verify-local.sh docs` | PASS |

## Gates
- [ ] ./scripts/verify-local.sh all
- [ ] ./scripts/verify-local.sh static-analysis

## Restricted Areas
- Do not alter the board’s rendering, interaction model, or feature set while changing invocation policy.
- Do not change explicit non-UI command behavior, their output, or their exit codes.
- Do not import or initialize Ink on any non-TTY execution path.
- Do not combine this mission with unfinished work from earlier Ink TUI waves or unrelated CLI refactors.
- Do not push this mission branch to `origin`; any review push belongs only on the `review` remote.

## Stop Rules
- Stop without changing the default if any wave 1–6 prerequisite or compatibility/isolation gate is red; leave `px ui` explicit-only and record the blocking evidence.
- Stop and revert the policy flip if a no-command non-TTY test detects a changed output byte sequence or exit code.
- Stop and revert the policy flip if Ink is imported or initialized on a non-TTY path.
- Stop if no single, documented opt-out can restore the prior interactive-TTY no-command behavior with passing coverage.
- Stop if the completed change cannot remain one reversible commit with both required gates green.
