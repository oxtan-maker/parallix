# Mission: Enforce Workflow Config Schema Validation (task-2455.03)

## Goal
Make `px config` reject every `workflow.config.json` override that violates `config/workflow.config.schema.json`, report the structural-validation failure, exit non-zero, and still print fallback built-in defaults.

## Why Now
The schema advertises field types, enums, ranges, and closed adapter subobjects that the runtime does not consistently enforce. An invalid review provider such as `"unsupported"` currently appears as an effective configuration, making operator mistakes look valid.

## Refinement Signals
- Predicted NEL bucket: Small (0–80)
- Confidence: High
- Selection note: activate as-is
- Main drivers: schema/runtime validation drift; invalid review-provider enum is accepted by `px config`; existing config-command and product-config tests cover the affected boundary.

## Scope
- Add a regression test in `test/config-command.test.ts` that reproduces an unsupported `adapters.review.provider` value through `px config` before the implementation changes.
- Make `validateWorkflowConfig` enforce the constraints expressed by `config/workflow.config.schema.json` for workflow overrides.
- Preserve the current `px config` invalid-file behavior: structural diagnostic to stderr, non-zero exit, and fallback built-in defaults on stdout.
- Add focused validation coverage for schema field types, enum values, numeric bounds, `tasks.storage` alternatives, and the closed `adapters.agents.runners` and `adapters.agents.subagents` objects.

## Out of Scope
- Changing workflow defaults, documented provider values, schema semantics, or merge precedence.
- Rejecting unknown properties where the schema permits `additionalProperties`.
- Changing JSON parse-error handling, `px config` output format for valid files, or unrelated command behavior.
- Adding a new validation dependency when the repository's installed dependencies can enforce the schema.

## Success Criteria
> **Falsifiability rule (ADR 0039 Part 2):** Each criterion must be falsifiable. Forbidden: subjective adjectives ("easy, fast, simple, intuitive, user-friendly, responsive, quick, efficient" without an attached metric) and vague quantifiers ("multiple, several, some, many, few, various"). For refactor / condense / migration missions, the criterion must enumerate the specific elements (rules, files, behaviours) that must survive — generic phrases like "preserve critical content" are not sufficient.

- `test/config-command.test.ts` contains a regression test named for an unsupported review-provider enum value; with `{ "adapters": { "review": { "provider": "unsupported" } } }`, `px config` reports a structural-validation diagnostic, exits with code 1, and writes fallback built-in defaults.
- `validateWorkflowConfig` rejects violations of every constraint in `config/workflow.config.schema.json`: object types for `product` and adapter sections; string fields; `tasks.storage` string-or-object form; nullable review provider restricted to `forgejo`, `none`, or `null`; positive-integer `maxConcurrentCustom`; string-valued agent models; closed and enum-restricted custom runner; and nullable non-negative integer `subagents.maxParallel` in its closed object.
- A partial override satisfying the schema remains valid and `loadEffectiveConfig` merges it over built-in defaults.
- Malformed JSON and schema-invalid JSON continue to use the existing fallback-default output path; valid `px config` output remains the effective configuration path.
- `./scripts/verify-local.sh all` exits 0 on the completed mission tree.

## Risks and Assumptions
- Assumption: `config/workflow.config.schema.json` is the authoritative runtime contract for optional overrides; its `additionalProperties` settings intentionally determine which unknown keys remain allowed.
- Risk: a validator may produce implementation-specific error text; tests should require structural diagnostics and the relevant field/rule, not an unstable full error serialization.
- Risk: validation is shared by config loading and readiness checks, so a schema change can affect callers beyond `px config`; preserve valid partial overrides and fallback behavior.

## Checkpoints
- CP 1: Add the failing reproduction in `test/config-command.test.ts` for `adapters.review.provider: "unsupported"`; assert that the parent commit returns exit code 0 without a structural-validation error (red), then retain the same test to require exit code 1, a structural-validation diagnostic naming the provider rule, and fallback-default output after the fix (green).
- CP 2: Align shared workflow-override validation with `config/workflow.config.schema.json` and add focused unit coverage for each schema constraint while preserving allowed unknown properties.
- CP 3: Verify `px config`, effective-config loading, and repository-readiness callers retain valid-override and invalid-file fallback behavior; run the mission gate and record evidence.

Reproduction-Test: test/config-command.test.ts

### Checkpoint Documentation Requirements
Every checkpoint document (CP-N.md) MUST lead its `## Goal Check` evidence with durable references Parallix verifies today: exact test names, ADR references, test file paths, and recognized repository commands or paths such as `npm ...`, `node ...`, `git ...`, `px ...`, or `./...`. File:line references are accepted when needed but discouraged because line numbers rot.

Every checkpoint document (CP-N.md) MUST include:
- A summary of work done.
- The exact heading `## Goal Check`.
- A 3-column pipe-delimited Markdown table with this exact header: `| Criterion | Evidence | Status |`.
- At least one evidence row for every success criterion, using the durable evidence forms above. Raw `stat`/`ls` output or generic prose alone is not enough; pair shell output with an accepted command, path, test name, or ADR reference.
- A non-generic `Next action:` line at the bottom.

Example Goal Check table:

| Criterion | Evidence | Status |
|---|---|---|
| Unsupported review provider is rejected | `test/config-command.test.ts`, exact regression test name | PASS |
| Shared validation matches the config schema | `config/workflow.config.schema.json`, `test/product-config.test.ts` | PASS |
| Mission gate ran | `./scripts/verify-local.sh all` | PASS |

## Gates
- [ ] ./scripts/verify-local.sh all

## Restricted Areas
- Do not alter `config/workflow.config.schema.json` values or `additionalProperties` policy merely to match incomplete runtime validation.
- Do not change built-in defaults, config merge behavior, JSON parse-error fallback behavior, or valid-config presentation.
- Limit production changes to the workflow-config validation path and tests that directly demonstrate its callers.

## Stop Rules
- Stop and escalate if the schema cannot be enforced with installed dependencies or the repository's existing validation patterns without adding a dependency.
- Stop and escalate if a schema constraint conflicts with a documented supported configuration or a current valid caller.
- Stop and escalate if preserving fallback defaults for invalid files requires changing the public `px config` contract.
