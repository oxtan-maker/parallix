# Mission: Retire ineffective product target-user configuration (task-2455.01)

## Goal
Remove the unsupported `product.targetUser` setting from Parallix's public
configuration contract so generated configuration, built-in defaults, the
schema, and the configuration reference no longer imply that it affects runtime
behavior.

## Why Now
The setting is accepted and displayed by `px config` but has no runtime
consumer. Leaving it documented and generated makes a configuration promise
that Parallix cannot keep.

## Refinement Signals
- Predicted NEL bucket: Small (0–80)
- Confidence: High
- Selection note: retire the field rather than inventing a user-facing behavior
  without a defined runtime need
- Main drivers: unused default and schema property, setup-generated config,
  configuration-reference gap, regression coverage

## Scope
- Add `test/task-2455.01-target-user-repro.test.ts` before the production
  change. It must show that `product.targetUser` is currently exposed by the
  default configuration, public schema, and setup-generated configuration, then
  assert its absence after the change.
- Remove `product.targetUser` from `src/adapters/config/product-config.ts`,
  `config/workflow.config.schema.json`, and setup-generated workflow
  configuration in `src/adapters/review/setup-review-config.ts`.
- Remove the field from the repository's `workflow.config.json` sample and
  revise `docs/config.md` to describe the settled public contract rather than
  list this field as a known gap.
- Preserve partial configuration merging and all remaining `product` and
  `adapters` settings.

## Out of Scope
- Creating a new runtime behavior for a target-user persona.
- Rejecting unknown configuration properties or adding field-level JSON Schema
  validation; TASK-2455.03 owns that validation contract.
- Changing unrelated configuration fields, task-provider behavior, or `px
  config` exit-status handling.

## Success Criteria
> **Falsifiability rule (ADR 0039 Part 2):** Each criterion must be falsifiable. Forbidden: subjective adjectives ("easy, fast, simple, intuitive, user-friendly, responsive, quick, efficient" without an attached metric) and vague quantifiers ("multiple, several, some, many, few, various"). For refactor / condense / migration missions, the criterion must enumerate the specific elements (rules, files, behaviours) that must survive — generic phrases like "preserve critical content" are not sufficient.

- The first implementation checkpoint records a failing reproduction in
  `test/task-2455.01-target-user-repro.test.ts`: at the mission parent commit it
  proves the field is exposed by defaults, schema, and setup output; it turns
  green only when all three exposures are removed.
- `defaultConfig()` and setup-generated `workflow.config.json` omit
  `product.targetUser`, while preserving `product.name` and the existing adapter
  configuration supplied by those paths.
- `config/workflow.config.schema.json` no longer declares
  `product.targetUser`, and the checked-in `workflow.config.json` does not
  contain that property.
- `docs/config.md` no longer presents `product.targetUser` as a known
  configuration gap or a supported setting; its remaining configuration
  guidance stays accurate.
- `npm test -- --unit-test-headroom --test-name-pattern "TASK-2455.01"` and
  `./scripts/verify-local.sh all` complete successfully on the final tree.

## Risks and Assumptions
- Existing repositories may retain the now-unknown property; because the schema
  intentionally permits additional properties and TASK-2455.03 owns validation,
  this mission does not reject it at runtime.
- Removing the field is the intended product decision because no concrete
  user-facing behavior has been defined for it.
- Setup and default configuration are the supported generation surfaces to
  verify; fixture-only uses may remain when they are unrelated to generated
  output.

## Checkpoints
- CP 1: Write `test/task-2455.01-target-user-repro.test.ts` before any fix. In
  a temporary repository, exercise default loading and setup configuration, and
  inspect the public schema; assert that `product.targetUser` is absent. The
  assertion must fail at the mission parent commit because defaults, schema, and
  setup output currently expose it, then pass after the retirement change.
- CP 2: Remove the field from the public/default/setup configuration surfaces
  and update the checked-in configuration sample.
- CP 3: Update the configuration reference, run the targeted regression and
  required repository gate, and record the criterion evidence.

Reproduction-Test: test/task-2455.01-target-user-repro.test.ts

### Checkpoint Documentation Requirements
Every checkpoint document (CP-N.md) MUST include:
- At least one evidence row per criterion using durable, verifiable references:
  exact test names, ADR references, test file paths, or recognized repository
  commands/paths such as `npm test -- --unit-test-headroom --test-name-pattern
  "TASK-2455.01"`, `node ...`, `git ...`, `px ...`, and
  `./scripts/verify-local.sh all`. File:line references are accepted when
  needed but discouraged because line numbers rot.
- Raw `stat`/`ls` output or generic prose alone is not evidence; pair shell
  output with an accepted reference above.
- A summary of work done
- A `## Goal Check` section using this exact 3-column table header:

  | Criterion | Evidence | Status |

- A non-generic `Next action:` line at the bottom

## Gates
- [ ] ./scripts/verify-local.sh all

## Restricted Areas
- Do not add a new configuration setting, prompt surface, or persona-driven
  runtime behavior.
- Do not change `additionalProperties` or configuration-validation semantics;
  TASK-2455.03 owns those boundaries.
- Do not modify lifecycle, task-provider, or process-exit-status code unrelated
  to removing this field.

## Stop Rules
- Stop and seek product direction if a concrete runtime behavior for
  `product.targetUser` is identified that must be preserved; this contract
  deliberately retires the field instead.
- Stop if removing the property breaks a supported configuration consumer beyond
  the documented default, schema, setup, sample, and reference surfaces; record
  the consumer and revise scope before changing it.
