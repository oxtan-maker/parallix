# CP 2 — Fix: working-tree config/agents.json governs per-step eligibility

## Summary

Implemented the minimal root-cause fix and added red-to-green regression tests.

**Fix.** `src/adapters/agents/agent-config.ts` `parseAgentConfigFile`. The
default `CONFIG_PATH` now reads the working-tree file at
`path.resolve(process.cwd(), CONFIG_PATH)` when it exists, and falls back to
the bundled `runtimeAssetStore.readText(CONFIG_PATH)` (ADR 0044) otherwise.
Non-default caller-supplied paths still use `fs.readFileSync` unchanged. The
bundled-asset boundary (`runtime-assets.ts`, `package-root.ts`) is untouched.

**Regression tests** (`test/agents.test.ts`):
- `eligibleAgentsForStep reads a changed eligible list from the working-tree config/agents.json` — chdir into a temp project, write a distinct `eligible` list, assert `eligibleAgentsForStep('draft')` returns it (default path, no injected config).
- `selectAgent honors a changed eligible list from the working-tree config/agents.json` — same, asserts `selectAgent` picks the changed agent.

**Red-to-green proven.** Reverted the source fix to `HEAD`: both new tests
fail (`✖ ... working-tree ...`). Restored the fix: both pass. The tests are
red before the fix and green after (DOD #6). They are meaningful in the dev
checkout because `runtimeAssetStore` is anchored to `packageRoot` (repo root)
while the tests `chdir` to an isolated cwd, so the pre-fix path reads the
bundled/repo-root config and the distinct list is ignored.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC1 working-tree edit governs eligible pool | `src/adapters/agents/agent-config.ts` L49–L67 (working-tree-preferred read) | PASS |
| SC2 regression test writes distinct list, asserts pool | `test/agents.test.ts` `eligibleAgentsForStep reads a changed eligible list from the working-tree config/agents.json`; `selectAgent honors a changed eligible list from the working-tree config/agents.json` | PASS |
| SC3 existing behaviour preserved | `test/agents.test.ts` (102 pass), `test/runtime-matrix.test.ts` (10 pass) — `isAgentBlocked`, `agents.local.json` blocklist merge, launcher health, custom runner unchanged | PASS |
| SC4 runtime-matrix reads working tree | `src/adapters/agents/runtime-matrix.ts` L36 `eligibleAgentsForStepFn(step)` composes fixed `eligibleAgentsForStep` | PASS |
| ADR 0044 bundle boundary intact | `src/adapters/assets/runtime-assets.ts` L12, `src/adapters/filesystem/package-root.ts` unchanged; fallback read keeps bundle | PASS |
| Red-to-green reproduction | pre-fix `HEAD` → both new tests `✖`; fixed → `✔` | PASS |

## Next action
Run the full `./scripts/verify-local.sh all` gate (CP 3), then update `config/agents.json` `_comment` if the override contract wording needs to reflect working-tree authority, and finalize the Goal Check.
