# CP-3: Mode-specific fail-closed + board/lane semantics + CLI status surface

## Summary

Completed the mission's three remaining surfaces.

- `src/adapters/cli/commands/status.ts`: prints `Integration mode: <mode>` right
  after the worktree line, resolving the active mode from the current working
  directory via `resolveIntegrationMode`. An unresolvable mode reports itself and
  points at `px config` rather than crashing `px status`.
- `src/adapters/cli/commands/config.ts`: prints an explicit `Integration mode:
  <mode>` line on the read-only and `--write` paths (in addition to the effective
  config JSON that already carries `integration.mode`), so the active mode is
  visible without parsing the blob.
- Board lane semantics: unchanged. `local` still routes through the existing
  `decideMission(loaded.mission, { type: 'integrate' })` path, so the
  `review → integration → done` transition is byte-identical to the pre-mission
  baseline. The capability boundary added in CP-2 sits alongside this path; it
  does not reroute it.
- Mode-specific fail-closed behaviour (CP-2 dispatcher): every mode other than
  the one under test fails closed on an operation it does not own — `local`
  refuses `submit-for-external-verification`/`observe-external-integration`,
  `github-publish` declares the provider steps `external-pending`, and
  `github-pr` refuses the local primary merge (`publish` = `unsupported`).

No GitHub/Forgejo callers, no network, no credential plumbing. `local` behaviour
is unchanged.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC5: `local` retains current merge path + board lane transition `review → integration → done` | `test/mission-integration-service.test.ts` (`integration → done`, trigger `integrate`); `test/integrate.test.ts` — `integrate.ts` merge path unmodified | PASS |
| SC6: every mode other than under test fails closed on an unimplemented operation | `test/integration-dispatch.test.ts`, `"github-pr run fails closed on publish"`, `"local run fails closed on an operation it does not own"`, `"github-publish ... fails closed on the provider steps"` | PASS |
| SC7: `px config` prints the active integration mode | `test/integration-mode-cli.test.ts`, `"config prints an explicit active integration mode line"`, `` `npm test -- test/integration-mode-cli.test.ts` `` | PASS |
| SC7: `px status` prints the active integration mode | `test/integration-mode-cli.test.ts`, `"status prints the active integration mode for the configured mode"` | PASS |
| SC4: dispatch behind capability boundary, no domain→GitHub dep | `test/application-contracts.test.ts`, `test/dependency-graph.test.ts`, `test/domain-import-boundary.test.ts`, `test/forgejo-independence.test.ts` | PASS |
| Types clean | `` `npx tsc -p tsconfig.json --noEmit` `` and `` `npx tsc -p tsconfig.test.json --noEmit` `` — no output | PASS |

Next action: CP-4 — write the docs (three modes, use cases, review≠merge authority
separation) and run the single mission gate `./scripts/verify-local.sh all`; then
commit CP-4.md.
