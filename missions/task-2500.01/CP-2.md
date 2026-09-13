# CP-2: Application-layer integration capability boundary + dispatcher

## Summary

Added the application-layer strategy/capability boundary and the dispatcher for
the seven integration operations. `local` routes to the existing merge path
unchanged — the 1915-line `src/adapters/cli/commands/integrate.ts` squash-merge
command was not touched, so the `local` behaviour stays byte-identical.

- `src/application/ports/integration-strategy.ts` (already present): the capability
  port. Seven named operations (`prepare-integration`, `run-required-local-gates`,
  `produce-integration-candidate`, `submit-for-external-verification`, `publish`,
  `observe-external-integration`, `close-mission`), a per-operation support
  classification (`local` | `external-pending` | `unsupported`), and a `run`
  method that executes the supplied local implementation only when the mode owns
  the operation and fails closed otherwise. Pure port: no adapter, no GitHub
  import.
- `src/application/services/integration-dispatch.ts` (new): the dispatcher. The
  single place the per-mode capability table lives, so callers never branch on
  the mode. `local` owns its five local authorities and refuses the two external
  operations; `github-publish` owns the local preparation steps and declares the
  merge/publish/observe steps `external-pending`; `github-pr` owns the branch-push
  verification step and refuses the local primary merge (`publish` = `unsupported`).
  `closureBlocker` delegates to the domain `integrationClosureBlocker`.
- `src/domain/integration.ts` (added): `IntegrationEvidence` (observed data, never
  a local boolean), `NO_INTEGRATION_EVIDENCE`, and `integrationClosureBlocker`
  — the state/evidence model each mode closes on. Review approval is never
  sufficient on its own.

No GitHub/Forgejo callers, no network, no credential plumbing anywhere. The
`local` merge path is untouched.

### Scope note

The locked mission document specifies the implementation mission; the Backlog
task body still describes the earlier audit-only framing (AC #7: no runtime
changes). The Backlog task's acceptance criteria are stale relative to the locked
MISSION.md; its lifecycle metadata was left untouched, per the harness
instructions.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC2: three modes resolve + validate through repo config; schema enum accepts exactly these three | `test/integration-mode-config.test.ts`, `` `node --import tsx --experimental-test-module-mocks --test test/integration-mode-config.test.ts` `` | PASS |
| SC4: dispatch behind capability port + dispatcher, not scattered `if (mode)` in `integrate.ts`; no domain→GitHub dep | `test/integration-dispatch.test.ts`, `test/dependency-graph.test.ts`, `test/domain-import-boundary.test.ts`, `test/application-contracts.test.ts` | PASS |
| SC4: domain carries no GitHub dependency | `src/domain/integration.ts` imports only within itself; enforced by `test/domain-import-boundary.test.ts` (green) | PASS |
| SC6: every mode other than under test fails closed on an unimplemented operation | `test/integration-dispatch.test.ts` — `"local run fails closed on an operation it does not own"`, `"github-pr run fails closed on publish"`, `"github-publish ... fails closed on the provider steps"` | PASS |
| SC6: `github-pr` refuses the local primary merge; `local` refuses submit-for-external-verification | `test/integration-dispatch.test.ts`, `"github-pr owns the branch-push verification step and refuses the local primary merge"` | PASS |
| SC5: `local` retains current integration semantics (merge path + lane transition) | `test/integrate.test.ts`, `test/mission-integration-service.test.ts` (unchanged; `integrate.ts` merge path not modified this checkpoint) | PASS |
| No GitHub/Forgejo import in the new application/domain modules | `test/forgejo-independence.test.ts`, `test/application-boundaries.test.ts` (green) | PASS |
| Types clean | `` `npx tsc -p tsconfig.json --noEmit` `` and `` `npx tsc -p tsconfig.test.json --noEmit` `` — no output | PASS |

Next action: CP-3 — wire the active mode into the board lane transition
(`review → integration → done`) and the `MissionIntegrationService` closure check,
and surface the active mode in `px config` / `px status`; then add a test proving
the `local` board lane transition and the mode-specific fail-closed closure.
