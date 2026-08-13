# Mission: Split integrate gates and worktree helpers (task-2369.05)

## Goal
Separate integration gate planning, execution, and verification-worktree support from the `integrate` command into a dedicated `integrate-gates` module without changing the integration workflow's observable behaviour.

## Why Now
`integrate.ts` currently combines command orchestration with changed-area detection, gate selection and execution, configuration loading, and worktree handling. Extracting those cohesive responsibilities makes future gate changes safer to reason about and test while keeping the command entry point focused on the lifecycle orchestration.

## Refinement Signals
- Predicted NEL bucket: Medium (81–235)
- Confidence: High
- Selection note: activate as-is
- Main drivers: integration-command separation, explicit gate orchestration boundary, verification-worktree reuse

## Scope
- Create `src/adapters/cli/commands/integrate-gates.ts` as the home for integration gate planning, execution, changed-area parsing, integration configuration access, final-tree capture, and verification-worktree helpers.
- Move `detectChangedAreas()`, `isIntendedPayloadAtHead()`, `parseFilesToAreas()`, `orderIntegrationGates()`, `gateMatchesChangedAreas()`, `loadIntegrationConfig()`, `getIntegrationGatePlan()`, `printIntegrationGatePlan()`, `buildIntegrationGateEnv()`, `captureFinalIntegrationTree()`, `resolveIntegrationVerificationWorktree()`, `buildIntegrationVerificationInvocation()`, `executeIntegrationGates()`, and `getIntegrationConfigPath()` from `integrate.ts` to the new module.
- Update `integrate.ts` to consume or re-export the extracted interfaces as required by existing callers and tests.
- Add or adjust focused unit coverage for the extracted module only where required to preserve the listed behaviours.

## Out of Scope
- Changing which integration gates are selected, their ordering, their changed-area matching rules, or their environment values.
- Changing the integration pipeline schema, `config/integration-pipelines.json`, or the user-facing `px integrate` workflow.
- Refactoring unrelated command modules or changing mission-branch, remote, or review policies.

## Success Criteria
> **Falsifiability rule (ADR 0039 Part 2):** Each criterion must be falsifiable. Forbidden: subjective adjectives ("easy, fast, simple, intuitive, user-friendly, responsive, quick, efficient" without an attached metric) and vague quantifiers ("multiple, several, some, many, few, various"). For refactor / condense / migration missions, the criterion must enumerate the specific elements (rules, files, behaviours) that must survive — generic phrases like "preserve critical content" are not sufficient.

- `src/adapters/cli/commands/integrate-gates.ts` owns all fourteen functions listed in Scope, and `integrate.ts` no longer defines them.
- Existing integration command consumers retain access to every extracted helper they currently import, through the new module or deliberate compatible re-exports from `integrate.ts`.
- The extracted implementation preserves changed-area detection and file-to-area parsing; integration configuration loading and configuration-path resolution; gate filtering, ordering, plan rendering, and environment construction; final integration-tree capture; verification-worktree resolution and invocation construction; and gate execution.
- `integrate.ts` is reduced by approximately 500 lines and `integrate-gates.ts` is approximately 500 lines, with responsibility boundaries reflected by the extraction rather than duplicated implementations.
- Focused tests cover gate-plan selection/order and verification-worktree invocation behaviour affected by the extraction, and `./scripts/verify-local.sh static-analysis` succeeds.

## Risks and Assumptions
- Moving functions can change export visibility or create circular imports; preserve dependency direction from `integrate.ts` into `integrate-gates.ts` and verify existing imports.
- Gate execution depends on process environment, git state, and worktree paths; unit tests must mock command and filesystem dependencies and must not contact Forgejo or launch real agents.
- The line-count target is directional rather than a functional contract; clarity and a single ownership location take priority over an exact count.

## Checkpoints
- CP 1: Map the current helper call graph and exported surface, then create `integrate-gates.ts` with the pure changed-area, configuration, gate-plan, and gate-ordering helpers plus focused mocked tests.
- CP 2: Move gate environment construction, final-tree capture, verification-worktree resolution, invocation construction, and gate execution; reconnect `integrate.ts` through imports or compatible re-exports.
- CP 3: Confirm the extracted boundary has no duplicate helper implementations, run the static-analysis gate, and record the completed goal check.

### Checkpoint Documentation Requirements
Every checkpoint document (CP-N.md) MUST include a work summary followed by the exact heading `## Goal Check` and this 3-column table header: `| Criterion | Evidence | Status |`.

Use at least one durable, verifiable reference for every success criterion: exact test names, ADR references, test file paths, or recognized repository commands and paths such as `npm ...`, `node ...`, `git ...`, `px ...`, or `./...`. File:line references are accepted parenthetically when needed but discouraged because line numbers rot.

Raw `stat`/`ls` output or generic prose alone is insufficient evidence; when included, pair it with an accepted reference above. End each checkpoint with a concrete `Next action:` line describing the next extraction or verification step.

Example Goal Check table:

| Criterion | Evidence | Status |
|---|---|---|
| Extracted helper ownership | `src/adapters/cli/commands/integrate-gates.ts` | PASS |
| Gate behaviour coverage | exact affected test name and test file path | PASS |
| Static analysis | `./scripts/verify-local.sh static-analysis` | PASS |

## Gates
- [ ] ./scripts/verify-local.sh static-analysis

## Restricted Areas
- Do not modify `config/integration-pipelines.json` or alter its gate definitions as part of this extraction.
- Do not change remote-push behaviour, Forgejo interaction, or worktree lifecycle semantics.
- Keep unit tests hermetic: mock CLI, git, filesystem, and agent dependencies rather than invoking real Forgejo, worktrees, or agents.

## Stop Rules
- Stop and escalate if preserving the helper API requires a behavioural change to the `px integrate` command or its public output.
- Stop and escalate if the extraction reveals that gate selection or worktree semantics are shared through an undocumented contract that cannot be covered with hermetic tests.
- Stop and escalate if static analysis identifies unrelated pre-existing failures that cannot be distinguished from this mission's changes.
