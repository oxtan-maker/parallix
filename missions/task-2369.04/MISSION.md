# Mission: Split integrate command orchestration (task-2369.04)

## Goal

Extract the `integrate()` CLI entry flow and its command-level context construction from `integrate.ts` into a self-contained `integrate-command.ts`, while retaining the existing public import route through re-exports from `integrate.ts`.

## Why Now

`integrate.ts` currently combines command entry, gate orchestration, conflict handling, worktree management, and post-integration behavior in one 2,335-line module. Moving the command orchestration boundary into its own module makes the remaining integration lifecycle code easier to navigate and prepares it for focused maintenance without changing supported CLI behavior.

## Refinement Signals
- Predicted NEL bucket: Medium (81–235)
- Confidence: High
- Selection note: The extraction set and destination module are explicitly defined by the backlog task.
- Main drivers: isolate the command entry and context-building boundary; preserve existing callers through re-exports; reduce `integrate.ts` by approximately 350 lines.

## Scope
- Create `src/adapters/cli/commands/integrate-command.ts` as the self-contained home for `integrate()`, `buildIntegrationContext()`, `parseIntegrateArgs()`, `IntegrateFn`, and the listed integrate command options, constants, status helpers, and preflight/recovery output helpers.
- Re-export the extracted command-facing API from `src/adapters/cli/commands/integrate.ts` so current callers retain their import route.
- Update only the imports and references needed to move the named command orchestration responsibilities without changing their observable behavior.

## Out of Scope
- Changing integration policy, gate ordering, task-status promotion rules, conflict-resolution behavior, worktree management, or post-integration behavior.
- Renaming CLI flags, changing option defaults, adding CLI options, or changing command output wording.
- Splitting other parts of the integration lifecycle beyond the named command orchestration extraction.
- Updating user-facing documentation for this internal refactor.

## Success Criteria
> **Falsifiability rule (ADR 0039 Part 2):** Each criterion must be falsifiable. Forbidden: subjective adjectives ("easy, fast, simple, intuitive, user-friendly, responsive, quick, efficient" without an attached metric) and vague quantifiers ("multiple, several, some, many, few, various"). For refactor / condense / migration missions, the criterion must enumerate the specific elements (rules, files, behaviours) that must survive — generic phrases like "preserve critical content" are not sufficient.

- `src/adapters/cli/commands/integrate-command.ts` contains `integrate()`, `buildIntegrationContext()`, `parseIntegrateArgs()`, `IntegrateFn`, `REAL_AGENT_OPTION`, `REAL_AGENT_MODEL_OPTION`, `INTEGRATE_VALUE_OPTIONS`, `CODEX_REAL_AGENT_MODEL`, `evaluateTaskStatusForIntegration()`, `promoteTaskForIntegrationIfNeeded()`, `printMergedPrRecoveryGuidance()`, `printIntegrationPreflight()`, and `VARIANT_B_AUTOMATION_SUMMARY`.
- `src/adapters/cli/commands/integrate.ts` re-exports every extracted symbol that existing callers use, and no caller requires an import-route change solely because of this extraction.
- The extraction does not alter parsing of existing integrate arguments, real-agent option/model selection, integration status evaluation or promotion, preflight output, merged-PR recovery guidance, gate orchestration, conflict resolution, worktree management, or post-integration execution.
- `integrate-command.ts` is approximately 350 lines and `integrate.ts` is reduced by approximately 350 lines relative to the mission parent commit.
- `./scripts/verify-local.sh static-analysis` completes successfully on the final tree.

## Risks and Assumptions
- The named functions and constants may share private dependencies with lifecycle code that remains in `integrate.ts`; move or explicitly export only dependencies needed to retain the existing boundary.
- Circular imports are a risk when retaining compatibility re-exports; the extracted module must not import its re-exporting facade.
- This is assumed to be a behavior-preserving refactor; any discovery that requires a policy, output, option, or lifecycle behavior change requires mission-owner direction.

## Checkpoints
- CP 1: Map the named symbols, their dependencies, and current import routes; define the extraction boundary so `integrate-command.ts` owns command entry and context building without a circular import.
- CP 2: Move the named command orchestration symbols into `integrate-command.ts` and add compatibility re-exports from `integrate.ts`.
- CP 3: Verify caller compatibility, behavior preservation for the enumerated integration flow, approximate line-count movement, and the required static-analysis gate.

### Checkpoint Documentation Requirements
Every checkpoint document (CP-N.md) MUST include durable, verifiable evidence first: exact test names, ADR references, test file paths, and recognized repository commands or paths such as `npm ...`, `node ...`, `git ...`, `px ...`, or `./...`. File:line references are accepted parenthetically when needed but discouraged because line numbers rot.

Every checkpoint document (CP-N.md) MUST include:
- A summary of work done.
- The exact heading `## Goal Check`.
- The exact 3-column pipe-delimited table header `| Criterion | Evidence | Status |`.
- At least one evidence row for every Success Criterion, using the durable evidence forms above; for this mission, cite the extracted module path, compatibility re-export route, relevant exact test names or test file paths, and the applicable verification command.
- Raw `stat`/`ls` output or generic prose alone is not enough; when used as supplemental context, pair it with one of the accepted references above.
- A concrete `Next action:` line at the bottom identifying the next checkpoint activity or final handoff action.

## Gates
- [ ] ./scripts/verify-local.sh all

## Restricted Areas
- Do not modify files outside `src/adapters/cli/commands/integrate.ts`, `src/adapters/cli/commands/integrate-command.ts`, and directly affected tests unless a newly discovered dependency makes that necessary and the mission owner approves the scope expansion.
- Do not change the CLI contract, integration policies, remote behavior, task lifecycle semantics, or user-facing documentation.
- Do not push the mission branch to `origin`; if a review push is requested later, use only the `review` remote.

## Stop Rules
- Stop and request direction if preserving current callers requires a CLI flag rename, option-default change, output wording change, or alteration to integration policy or lifecycle behavior.
- Stop and request direction if the extraction requires changes outside the restricted areas that are not limited to directly affected tests.
- Stop and report the unresolved dependency if compatibility re-exports would create a circular import that cannot be removed without changing the intended command/lifecycle boundary.
