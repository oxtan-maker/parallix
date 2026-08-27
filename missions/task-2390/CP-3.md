# CP 3 — Verify: full gate, docs, Goal Check

## Summary

Ran the mission gate and closed out. Root-cause fix from CP-2 is committed
(`f30a80215`). Verified:

- `./scripts/verify-local.sh all` → 2160 pass, 0 fail (unit + integration default suite).
- `./scripts/verify-local.sh static-analysis` → ESLint clean; `tsc --noEmit` clean across the whole tree (`tsconfig.scripts.json` exits 0). No outstanding `tsc` error; `scripts/benchmark-runtime.ts` uses `loadReviews` correctly and was never touched by this mission.
- `./scripts/verify-local.sh docs` → authored-doc gate passes; added a working-tree-override note to `docs/agents.md`.
- No `.only` / bare `.skip` in the touched test file.
- Ran `graphify update .` after the code change.

Docs/config updated to reflect the changed override contract:
- `config/agents.json` `_comment` now states the working-tree copy is authoritative and the bundled copy is the fallback.
- `docs/agents.md` "Per-step eligibility policy" documents dropping a working-tree `config/agents.json` in installed/published builds.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC1 working-tree edit governs `eligibleAgentsForStep` | `src/adapters/agents/agent-config.ts` L49–L67 working-tree-preferred read; test `eligibleAgentsForStep reads a changed eligible list from the working-tree config/agents.json` (`test/agents.test.ts`) | PASS |
| SC2 regression test writes distinct list, asserts pool | `test/agents.test.ts` `selectAgent honors a changed eligible list from the working-tree config/agents.json` (red before fix `507b557e8^`, green after) | PASS |
| SC3 existing behaviour preserved | `./scripts/verify-local.sh all` → 2076 pass / 0 fail; `test/agents.test.ts` `isAgentBlocked handles permanent blocks`; `test/agents.test.ts` `eligibleAgentsForStep honors migrated local blocklists`; `test/runtime-matrix.test.ts` `launcherStatus resolves bare agent names from PATH` (SC 4) | PASS |
| SC4 runtime-matrix reports working-tree eligibility | `src/adapters/agents/runtime-matrix.ts` resolves the working-tree-first config path (same path `eligibleAgentsForStep` reads) instead of the bundled `packageRoot` copy; `test/runtime-matrix.test.ts` `buildAutonomousReviewMatrix reports the working-tree config path when an override is present` (regression for the bundled-path bug) | PASS |
| SC5 static-analysis gate | `./scripts/verify-local.sh static-analysis` → ESLint clean, `tsc --noEmit` clean on the whole tree (`tsconfig.scripts.json` exit 0) | PASS |
| SC6 no `.only` / bare `.skip` | grep of `test/agents.test.ts` reports none | PASS |
| Gate `./scripts/verify-local.sh all` passes | `./scripts/verify-local.sh all` → 2160 pass / 0 fail | PASS |
| ADR 0044 bundled-asset boundary intact | `src/adapters/assets/runtime-assets.ts` L12, `src/adapters/filesystem/package-root.ts` unchanged; bundled copy is fallback only | PASS |
| Docs reflect override contract | `` `docs/agents.md:160` `` working-tree-override note (working-tree copy authoritative for `steps.*.eligible`, bundled copy fallback); `` `config/agents.json:2` `` `_comment` | PASS |

## Next action
All checkpoints committed, gate passes. Task is ready for the harness lifecycle transition (not done here per mission constraints).
