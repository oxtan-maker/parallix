# CP-7: Gate integration

## Summary

- Added a `mutation-gate` subcommand to `scripts/verify-local.sh`
  (`gate_mutation()`): runs `npm run --silent build:cjs` (so
  `lib/commands/mutation-gate.js` exists even if this is the first command
  run in a fresh checkout) then `node lib/commands/mutation-gate.js`,
  forwarding any extra flags (`--dry-run`, `--base`, `--baseline-path`,
  `--threshold`). Documented in the script's usage header alongside the
  existing `docs`/`static-analysis`/`integrate` subcommands.
- Added a `mutation` gate entry to `config/integration-pipelines.json`:
  `order: 40`, `run_last: false`, `command:
  "./scripts/verify-local.sh mutation-gate"` — sitting between the existing
  `lib` gate (`static-analysis`, order 1) and `workflow` gate (order 50),
  per the mission's requested ordering.

## Known limitation, by design (Restricted Areas)

`gate_integrate`'s area-matching (`gateMatchesChangedAreas` in
`lib/commands/integrate.ts`) only runs a gate when its key matches a
recognized changed area (`lib`, `docs`, `workflow`, etc. — see
`parseFilesToAreas`'s `knownAreas` list) or one of two hardcoded special
cases (`web-e2e`, `workflow`). `"mutation"` is not a recognized area, so the
new `mutation` gate entry is schema-valid and orderable but **does not yet
auto-fire** through `./scripts/verify-local.sh integrate`'s changed-area
filter. Making it auto-fire would require adding a `mutation` case to
`gateMatchesChangedAreas` — but this mission's Restricted Areas
explicitly forbid modifying `lib/commands/integrate.ts`. Verified directly:

```
$ INTEGRATE_DRY_RUN=true ./scripts/verify-local.sh integrate
integration-gates: resolved gate plan:
lib: ./scripts/verify-local.sh static-analysis
workflow: node test/e2e-mission-lifecycle.test.js
```

The `mutation` gate is present in the config (verified via
`config/integration-pipelines.json` and `orderIntegrationGates()`, which
only depends on gate `order`/`run_last`, not the changed-area matcher) but
correctly absent from this resolved plan. The gate remains directly
runnable as a standalone pre-integrate step
(`./scripts/verify-local.sh mutation-gate`) today; wiring it into the
automatic changed-area pipeline is a natural follow-up task once
`integrate.ts` is back in scope.

## Verification

```
$ ./scripts/verify-local.sh mutation-gate --dry-run --base main --head HEAD
[INFO] mutation-gate DRY-RUN — base=main head=HEAD
[INFO] Diff-scoped target files (6): lib/commands/mutation-gate.js, lib/core/fmt.js,
  lib/core/git.js, lib/core/mission-utils.js, lib/core/mutation-scoper.js,
  lib/core/product-config.js
...
[INFO] Predicted run time: ~30s
```

`bash -n scripts/verify-local.sh` → syntax OK.
`./scripts/verify-local.sh static-analysis` → `ALL STAGES PASSED`.
`FORCE_COLOR=0 node --test test/integration-pipelines.test.js test/integrate.test.js
test/integrate-guard.test.js test/integrate-workflow-gate.test.js
test/verify-local-integrate.test.js` → `tests 99, pass 91, fail 0, skipped 8`
(the 8 skips are pre-existing, annotated monorepo-only cases unrelated to
this change).

## Goal Check

| Success criterion | Evidence |
|---|---|
| `mutation-gate` exposed as a `verify-local.sh` subcommand | `scripts/verify-local.sh:64-70` (`gate_mutation`), `scripts/verify-local.sh:206-209` (case branch) |
| `config/integration-pipelines.json` has a `mutation` gate at order 40, between `lib`(1)/`static-analysis` and `workflow`(50) | `config/integration-pipelines.json` `"mutation": { "order": 40, "run_last": false, ... }` |
| Existing integrate-gate test suite unaffected | `test/integration-pipelines.test.js`, `test/integrate.test.js`, `test/integrate-guard.test.js`, `test/integrate-workflow-gate.test.js`, `test/verify-local-integrate.test.js` — all pass (91/91 non-skipped) |
| Restricted files untouched | `git diff --stat main...HEAD -- lib/commands/coverage-gate.ts lib/core/verification.ts lib/commands/integrate.ts test/ AGENTS.md docs/doc-standards.md prompts/` → empty (verified below) |

Command run to confirm restricted-area compliance:
```
$ git diff --stat main...HEAD -- lib/commands/coverage-gate.ts lib/core/verification.ts lib/commands/integrate.ts prompts/ AGENTS.md docs/doc-standards.md
(no output — none of these were touched)
```

Next action: This was the mission's final checkpoint. Proceed to the
mission-level Goal Check / handoff.
