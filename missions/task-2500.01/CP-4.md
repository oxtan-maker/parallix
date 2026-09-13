# CP-4: Docs + full verification gate

## Summary

Completed the mission. Added durable user-facing documentation and passed the
single mission gate.

Round-1 finding F1 (`px integrate` never dispatched the configured integration
mode) is resolved: `src/adapters/cli/commands/integrate.ts` now resolves the
repository's integration mode via `resolveIntegrationMode` and builds the
`IntegrationStrategyPort` once, then routes the real operations through
`strategy.run` — `run-required-local-gates` for the gate block and `publish`
for the local squash/merge/closeout block. `local` behaviour is unchanged; a
non-local mode fails closed before any `git merge` is issued. New entrypoint
coverage in `test/task-2500-integrate-mode-dispatch.test.ts` drives the
production `integrate` entry end to end and asserts `local` reaches the local
merge while `github-pr` fails closed on `publish` without issuing a merge.

- `docs/config.md` (updated): documents `integration.mode` and the three modes
  (`local`, `github-publish`, `github-pr`) with the "review approved ≠
  integrated into primary" authority separation. It points at `px config` /
  `px status` for the active value and at ADR 0045 / ADR 0041 for the related
  boundary decisions, rather than restating config fields or source paths
  (which own the executable facts).
- `docs/adr/0045-parallax-branch-model.md` (updated): records the decision to
  model the merge authority as repository configuration, folding the prior
  trunk-based/feature-branch paths into the `local` mode.
- All prior checkpoints are committed:
  - CP-1: `integration.mode` config schema + defaults + validation
    (`config/workflow.config.schema.json`, `src/adapters/config/product-config.ts`,
    `src/domain/integration.ts`).
  - CP-2: application-layer capability port + dispatcher + domain evidence model.
  - CP-3: mode-specific fail-closed behaviour + CLI status surface.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC1: absent mode parses as `local`; `integrate.test.ts` / `integrate-guard.test.ts` pass unchanged | `test/integration-mode-config.test.ts`, `test/integrate.test.ts`, `test/integrate-guard.test.ts` | PASS |
| SC2: three modes parse/validate; schema enum accepts exactly these three | `test/integration-mode-config.test.ts`, `` `npm test -- test/integration-mode-config.test.ts` `` | PASS |
| SC3: invalid mode fails closed naming value + allowed set; non-zero exit | `test/integration-mode-config.test.ts`, `test/config-command.test.ts` | PASS |
| SC4: dispatch behind capability port + dispatcher; no domain→GitHub dep | `test/application-contracts.test.ts`, `test/dependency-graph.test.ts`, `test/domain-import-boundary.test.ts`, `test/forgejo-independence.test.ts`, `test/task-2500-integrate-mode-dispatch.test.ts` | PASS |
| SC5: `local` retains current merge path + lane transition | `test/integrate.test.ts`, `test/mission-integration-service.test.ts`, `test/task-2500-integrate-mode-dispatch.test.ts` | PASS |
| SC6: other modes fail closed on unimplemented operations | `test/integration-dispatch.test.ts`, `test/task-2500-integrate-mode-dispatch.test.ts` | PASS |
| SC7: `px config` / `px status` print the active mode | `test/integration-mode-cli.test.ts` | PASS |
| SC8: docs explain the three modes + authority separation; docs gate passes | `docs/config.md`, `docs/adr/0045-parallax-branch-model.md`, `` `./scripts/verify-local.sh docs` `` | PASS |
| Mission gate | `` `./scripts/verify-local.sh all` `` — 2539 pass / 0 fail | PASS |

Next action: none — all four checkpoints are committed and the mission gate
passes. Hand off for review (harness performs lifecycle transitions).
