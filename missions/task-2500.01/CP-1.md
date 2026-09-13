# CP-1: `integration.mode` as first-class repository configuration

## Summary

Added an explicit repository-level integration mode to the optional override config,
following the existing configuration conventions.

- `src/domain/integration.ts` (new): the mode vocabulary (`local`, `github-publish`,
  `github-pr`), `DEFAULT_INTEGRATION_MODE`, `isIntegrationMode`, `parseIntegrationMode`,
  and the actionable configuration-error text. Pure domain: no GitHub/Forgejo imports,
  no adapter imports.
- `config/workflow.config.schema.json`: new top-level `integration` section with a
  `mode` enum of exactly the three supported values.
- `src/adapters/config/product-config.ts`: `integration: { mode: 'local' }` in the
  code-owned `DEFAULT_CONFIG`, validation of the `integration` section inside
  `validateWorkflowConfig`, and `resolveIntegrationMode(rootDir)`, which returns
  `local` when the section or key is absent and throws the actionable error for any
  unknown value.

Absent section, absent key, and `null` all resolve to `local`, so no existing
repository changes behaviour. An unknown value fails closed in two places: the
resolver throws, and `px config` reports the issue and exits non-zero (the existing
structural-validation path).

### Scope note (recorded, not acted on unilaterally)

The locked mission document (`missions/task-2500.01/MISSION.md`) specifies an
implementation mission: config key, capability boundary, CLI surfaces, docs. The
Backlog task body still describes the earlier *audit-only* framing, including
AC #7 "No runtime code, configuration, tests, or live documentation is changed by
this audit mission". Those cannot both hold. Execution follows the locked MISSION.md
(the refinement artifact the harness locked for this run); the Backlog task's
acceptance criteria are stale relative to it and its lifecycle metadata was left
untouched.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC1: absent `integration.mode` parses and behaves as `local`; no fixture edits needed | `"integration mode defaults to local when no repository config is present"`, `"integration mode defaults to local when the config omits the integration section"` in `test/integration-mode-config.test.ts` | PASS |
| SC2: all three modes parse and validate; schema enum accepts exactly these three | `"every supported integration mode resolves from repository configuration"`, `"the public schema enum accepts exactly the three supported integration modes"` (`test/integration-mode-config.test.ts`) | PASS |
| SC3: unknown mode fails closed with the invalid value and the allowed set | `"an unknown integration mode fails closed with the invalid value and the allowed set"` (`test/integration-mode-config.test.ts`) | PASS |
| SC3: unknown mode exits non-zero on the config surface | `"config prints the active integration mode and rejects an unknown one with a non-zero exit"` (`test/config-command.test.ts`) | PASS |
| SC7 (partial): `px config` prints the active integration mode | same test as above asserts `"mode": "github-pr"` in `px config` output; `` `px config` `` renders `loadEffectiveConfig` | PASS |
| State model carries no GitHub dependency | `src/domain/integration.ts` has no imports; layer rules enforced by `test/dependency-graph.test.ts` and `test/domain-import-boundary.test.ts` (both green) | PASS |
| Default-config path still loads for every config-dependent command | `` `node --import tsx --experimental-test-module-mocks --test test/product-config.test.ts test/config-command.test.ts test/repository-gates.test.ts test/task-2455.01-target-user-repro.test.ts` `` — 120 pass / 0 fail | PASS |
| Types clean | `` `npx tsc -p tsconfig.json --noEmit` `` and `` `npx tsc -p tsconfig.test.json --noEmit` `` — no output | PASS |

Next action: CP-2 — add the application-layer integration capability port and dispatcher
for the seven operations (`prepare integration`, `run required local gates`, `produce
integration candidate`, `submit for external verification`, `publish`, `observe external
integration`, `close mission`) with a per-mode capability table, and route `px integrate`
through a single dispatcher authorization for the publish operation so the `local` merge
path stays unchanged.
