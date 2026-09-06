# Mission: Make lifecycle gates repository-configured and self-hosted (task-2457)

## Goal
Make lifecycle gates generic, repository-configured, and disabled by default.
Parallix must then opt into its own Node-based gates through this repository's
configuration, without imposing Node tooling or Parallix helper scripts on
other repositories.

## Why Now
Parallix currently embeds Parallix/Node gate commands and changed-area
assumptions in lifecycle and integration code. That makes the product's own
toolchain an accidental prerequisite for repositories using other ecosystems.
A C++ repository should be able to select its CMake/CTest gates with no Node
runtime or `scripts/verify-local.sh` compatibility file.

## Refinement Signals
- Predicted NEL bucket: Medium (81–235)
- Confidence: High
- Selection note: activate as-is
- Main drivers: generic gate configuration and execution, removal of product
  toolchain assumptions, Parallix self-hosting configuration, and regression
  coverage at three phases.

## Scope
- Add a schema-declared repository gate configuration for ordered pre-handoff,
  pre-review, and pre-integration commands. Omitted configuration must execute
  no lifecycle gate.
- Validate and present the effective configuration through the workflow schema,
  `px config`, and the configuration reference.
- Execute configured commands in the relevant checkout with environment values
  for mission slug, checkout path, and phase. A non-zero exit must block the
  corresponding state transition or merge.
- Remove Node, npm, tsx, `scripts/verify-local.sh`, and Parallix-specific
  directory/changed-area assumptions from generic gate selection and execution.
- Configure this repository to opt into its build, verification, workflow, and
  agent-smoke gates through the new repository configuration surface.
- Add focused regression coverage for an unconfigured repository, configured
  execution, failure blocking, and Parallix self-hosting selection.

## Out of Scope
- Changing generic lifecycle safety checks that do not select or execute a
  repository gate.
- Configuring post-integration behavior beyond retaining existing `adapters.integrate.postIntegrateCommand` support.
- Adding lifecycle hooks for phases other than handoff, review, and integration.
- Adding a new command runner, plugin system, or shell language beyond the repository's existing command-execution mechanism.

## Success Criteria
> **Falsifiability rule (ADR 0039 Part 2):** Each criterion must be falsifiable. Forbidden: subjective adjectives ("easy, fast, simple, intuitive, user-friendly, responsive, quick, efficient" without an attached metric) and vague quantifiers ("multiple, several, some, many, few, various"). For refactor / condense / migration missions, the criterion must enumerate the specific elements (rules, files, behaviours) that must survive — generic phrases like "preserve critical content" are not sufficient.

- An unconfigured repository completes the affected lifecycle paths without a
  lifecycle gate or a Node/npm/tsx/`scripts/verify-local.sh` dependency.
- A workflow configuration accepts documented, disabled-by-default ordered gate
  commands for pre-handoff, pre-review, and pre-integration, and `px config`
  displays the effective configuration for all three phases.
- A configured guard at each of handoff, review, and integration runs from that mission's checkout and receives the mission slug, checkout path, and exact phase identifier through its environment.
- For each of the three phases, a guard exiting non-zero prevents that phase's state transition or merge; a successful guard permits the normal transition.
- Generic gate planning and execution contain no Node, npm, tsx,
  `scripts/verify-local.sh`, or Parallix-specific directory/area rule.
- Parallix's repository configuration explicitly selects its build,
  verification, workflow, and agent-smoke gates; those gates remain active
  while Parallix develops itself.
- Regression tests cover the unconfigured case and execution/failure for all
  three phases, including `test/task-2457-repro.test.ts`, and the full
  repository verification gate passes.

## Risks and Assumptions
- Assumption: the existing lifecycle command runner can execute configured commands from a supplied checkout without a new dependency.
- Risk: placing a hook after a transition or merge would leave a failed guard unable to protect the phase; tests must assert the observable state/merge boundary.
- Risk: environment names or phase strings could diverge between adapters; define and test one consistent contract.
- Risk: moving Parallix's own gates into configuration can accidentally leave
  them disabled; tests must prove this repository explicitly selects them.
- Risk: removing product-specific assumptions can change selection behavior;
  configuration, rather than inferred repository layout, must own that policy.

## Checkpoints
- CP 1: Create `test/task-2457-repro.test.ts` before changing production code.
  It must prove an unconfigured fixture repository invokes no lifecycle gate and
  a configured pre-handoff command exiting non-zero prevents handoff. It must
  fail against this mission's parent commit (red) because the configuration is
  unsupported, then pass after the implementation (green).

Reproduction-Test: test/task-2457-repro.test.ts

- CP 2: Add gate configuration, validation, `px config` presentation, and
  configuration-reference documentation; verify omission executes no gate.
- CP 3: Wire the generic runner into handoff, review, and integration before
  their transition/merge boundaries, passing the checkout and mission
  environment; remove generic Node and Parallix-layout gate assumptions.
- CP 4: Configure Parallix's own build, verification, workflow, and
  agent-smoke gates through the repository surface. Complete focused execution
  and failure-blocking coverage for all phases, then run the repository gate.

### Checkpoint Documentation Requirements
Every checkpoint document (CP-N.md) MUST include:
- A summary of work done.
- The exact heading `## Goal Check` followed by this exact 3-column table header:

  | Criterion | Evidence | Status |
  |---|---|---|

- At least one evidence row for every success criterion. Lead with durable evidence Parallix verifies today: exact test names, ADR references, test file paths, and recognized repository commands or paths such as `npm test -- ...`, `node ...`, `git ...`, `px ...`, or `./scripts/verify-local.sh all`. File:line references are accepted parenthetically but discouraged because line numbers rot.
- Raw `stat`/`ls` output or generic prose alone is not sufficient. If included, pair it with an accepted command, test name, ADR reference, or test-file path.
- A non-generic `Next action:` line at the bottom.

Example Goal Check table:

| Criterion | Evidence | Status |
|---|---|---|
| Draft prompt defines checkpoint evidence rules | `prompts/draft.md` | PASS |
| Repair loop has targeted incomplete-evidence coverage | `test/repair-handoff.test.ts`, `"buildRelaunchPrompt returns string containing Goal Check table and mission slug"` | PASS |
| Verification gate ran | `./scripts/verify-local.sh docs` | PASS |

## Gates
- [ ] ./scripts/verify-local.sh all

## Restricted Areas
- Do not retain an implicit Node, npm, tsx, `scripts/verify-local.sh`, or
  Parallix-directory requirement in generic gate behavior.
- Do not change post-integration hook semantics or add hooks to unrelated lifecycle phases.
- Do not add dependencies solely to execute lifecycle guard commands.
- Do not push the mission branch to `origin`; use the repository's review remote only when a later phase explicitly authorizes review.

## Stop Rules
- Stop if the current command runner cannot provide checkout-local execution and the three required environment values without introducing a new execution model.
- Stop if a phase cannot be guarded before its state transition or merge boundary; report the boundary and request a scope decision.
- Stop if supporting a configuration shape incompatible with the existing workflow schema or `px config` contract is required; request the desired compatibility policy.
