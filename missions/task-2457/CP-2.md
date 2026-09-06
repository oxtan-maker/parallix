# Checkpoint 2 — Gate configuration, validation, `px config`, and docs

## Summary
Added the schema-declared, disabled-by-default gate configuration surface and
wired it through validation and `px config`.

- `config/workflow.config.schema.json`: declared `adapters.gates` with ordered
  `preHandoff` / `preReview` / `preIntegration` arrays of `{key, command,
  order?}` objects. `additionalProperties: false` per gate object.
- `src/adapters/config/product-config.ts`: `validateWorkflowConfig` now runs
  `validateRepositoryGates`, so a malformed `adapters.gates` block makes
  `px config` fall back to defaults instead of silently running no gate.
  `loadEffectiveConfig` deep-merges configured gates over defaults, so
  `px config` displays the effective gates for all three phases.
- `src/adapters/config/repository-gates.ts`: generic runner exposes
  `loadPhaseGates`, `loadRepositoryGates`, `validateRepositoryGates`,
  `buildGateEnv`, `runPhaseGates`. Selection policy lives in repository
  configuration; the runner owns no Node/npm/tsx/`scripts/verify-local.sh`/
  Parallix-directory logic.
- `docs/config.md`: new "## Lifecycle gates" section documenting the fields,
  the disabled-by-default behavior, the checkout execution, and the
  `PARALLIX_MISSION_SLUG` / `PARALLIX_CHECKOUT_PATH` / `PARALLIX_PHASE`
  environment contract.

Verified omission runs no gate: `loadPhaseGates` returns `[]` for an
unconfigured checkout, and `runPhaseGates` with an empty list never invokes
the command runner (asserted in `test/task-2457-repro.test.ts`).

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Schema declares ordered pre-handoff/review/integration gates | `config/workflow.config.schema.json`, `adapters.gates.{preHandoff,preReview,preIntegration}` | PASS |
| Validation rejects malformed gates block | `test/task-2457-repro.test.ts`, `"validateWorkflowConfig rejects a malformed gates block"` | PASS |
| `px config` surfaces effective gates for all three phases | `test/task-2457-repro.test.ts`, `"workflow config surfaces configured gates through the effective config"` | PASS |
| Omitted configuration runs no gate | `test/task-2457-repro.test.ts`, `"unconfigured repository runs no gate for the handoff phase"` | PASS |
| Config reference documents the surface | `docs/config.md`, "## Lifecycle gates" | PASS |
| Documentation verification gate | `./scripts/verify-local.sh docs` → PASS | PASS |

## Next action
CP 3: wire `runPhaseGates` into handoff, review, and integration before each
phase's transition/merge boundary, passing the checkout and mission
environment; remove generic Node/Parallix-layout gate selection from
integration gate code.
