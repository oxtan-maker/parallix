# Mission: Make task provider configuration effective (task-2455.02)

## Goal
Make `adapters.tasks.provider` an effective, supported configuration contract:
the configured task provider must determine the task adapter used by task
storage and lifecycle operations, and unsupported provider values must be
rejected before they can be reported as effective configuration.

## Why Now
The public schema and setup flow currently let an operator persist and inspect a
provider such as `other`, while the runtime continues to use backlog-Markdown
task behavior. That mismatch makes `px config` misleading and creates a false
expectation of provider extensibility.

## Refinement Signals
- Predicted NEL bucket: Small (0–80)
- Confidence: High
- Selection note: The observable defect, intended provider, and acceptance
  boundary are explicit; no product-choice discovery is required.
- Main drivers: provider schema validation, adapter composition, task lifecycle
  coverage, and configuration-reference alignment.

## Scope
- Define `backlog-md` as the supported task-provider value for this release and
  validate `adapters.tasks.provider` against that contract.
- Route task storage and lifecycle composition through the validated provider
  selection rather than relying on an unconditional backlog-Markdown adapter.
- Add a regression test for an `other` override that is red at the mission
  parent commit and green after invalid values are rejected.
- Update `px config`, setup-generated configuration, and the configuration
  reference so they expose only the supported provider contract.

## Out of Scope
- Adding a second task-provider implementation or a plugin/discovery mechanism.
- Migrating existing task storage away from backlog Markdown.
- Changing agent, review, mission, or repository-provider configuration.
- Broad documentation restructuring unrelated to the task-provider contract.

## Success Criteria
> **Falsifiability rule (ADR 0039 Part 2):** Each criterion must be falsifiable. Forbidden: subjective adjectives ("easy, fast, simple, intuitive, user-friendly, responsive, quick, efficient" without an attached metric) and vague quantifiers ("multiple, several, some, many, few, various"). For refactor / condense / migration missions, the criterion must enumerate the specific elements (rules, files, behaviours) that must survive — generic phrases like "preserve critical content" are not sufficient.

- With `{ "adapters": { "tasks": { "provider": "other" } } }` in effective
  workflow configuration, configuration validation fails and task lifecycle
  composition does not proceed using the backlog-Markdown adapter.
- With `adapters.tasks.provider` set to `backlog-md`, task storage and lifecycle
  operations select the backlog-Markdown task adapter through the provider
  selection path.
- A named regression test at
  `test/task-2455.02-task-provider-config-repro.test.ts` proves the `other`
  override is rejected; it fails against the mission parent commit and passes
  after the contract is implemented.
- `px config`, setup output, `config/workflow.config.schema.json`, and the
  configuration reference consistently describe `backlog-md` as the only
  supported task-provider value.
- `./scripts/verify-local.sh all` succeeds on the completed implementation.

## Risks and Assumptions
- Assumption: backlog Markdown remains the only task-provider implementation in
  this release; therefore rejecting unknown values is preferable to accepting a
  value that cannot affect runtime behavior.
- Risk: provider selection may be assembled in more than one command path,
  leaving one lifecycle command on an unconditional adapter. Trace every task
  composition entry point and cover the shared selection boundary.
- Risk: setup defaults, schema validation, and `px config` can drift. Treat the
  validated provider contract as the single behavior to exercise in tests and
  reflect in user-facing configuration material.

## Checkpoints
- CP 1: Add `test/task-2455.02-task-provider-config-repro.test.ts` before any
  production change. It must load configuration containing
  `adapters.tasks.provider: "other"` and assert that validation rejects the
  override rather than permitting task lifecycle composition. Record that the
  test is red at the mission parent commit.

Reproduction-Test: test/task-2455.02-task-provider-config-repro.test.ts

- CP 2: Implement the validated `backlog-md` provider selection at the shared
  task-adapter composition boundary, then make the reproduction test green and
  add coverage that the supported value selects the backlog-Markdown adapter.
- CP 3: Align schema, setup output, `px config`, and the configuration reference
  with the supported-value contract; run the repository verification gate and
  document the final goal check.

### Checkpoint Documentation Requirements
Every checkpoint document (CP-N.md) MUST include:
- Durable evidence first: use exact test names, ADR references, test file paths,
  and recognized repository commands or paths such as `npm ...`, `node ...`,
  `git ...`, `px ...`, or `./...`. For this mission, cite
  `test/task-2455.02-task-provider-config-repro.test.ts`, its exact test name,
  `config/workflow.config.schema.json`, the configuration reference, and
  `./scripts/verify-local.sh all` as applicable. File:line references are
  accepted parenthetically when needed, but discouraged because line numbers rot.
- A summary of work done.
- The exact heading `## Goal Check`.
- A 3-column pipe-delimited table with the exact header:

| Criterion | Evidence | Status |
|---|---|---|

- At least one durable evidence row for every success criterion.
- Raw `stat`/`ls` output or generic prose alone is not enough; when included,
  pair shell output with one of the accepted references above.
- A non-generic `Next action:` line at the bottom.

## Gates
- [ ] ./scripts/verify-local.sh all

## Restricted Areas
- Do not introduce a second provider, provider plugin interface, or provider
  auto-discovery as part of this mission.
- Do not change task storage formats or migrate backlog task files.
- Do not alter unrelated workflow configuration contracts.

## Stop Rules
- Stop and seek a product decision if making `backlog-md` effective requires
  supporting a second provider, changing the persisted task format, or choosing
  between incompatible task-provider semantics.
- Stop and seek direction if an existing configuration migration is required to
  preserve compatibility with already persisted non-`backlog-md` values.
- Stop before integration if the regression test cannot demonstrate a red parent
  state and a green fixed state, or if the repository gate fails for a cause that
  is not attributable to this mission.
