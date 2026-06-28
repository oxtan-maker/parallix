# CP-3: Aggregator `agents.ts` converted — full migration complete

## Summary

Converted the aggregator `lib/agents/agents.js` → `agents.ts` (last in the wave,
widest import footprint), resolving all 11 sibling/core imports as ESM `import`s
and completing the 12-module CJS→ESM/TypeScript migration of `lib/agents/`.

Work done:
- `require()` → `import` for node builtins (`node:fs`/`node:path`/`node:child_process`), converted core deps (`../core/fmt.js`, `../core/storage.js`, `../core/product-config.js`, `../core/persistent-data-migration.js`), and the 5 converted agent modules (`./codex.js`, `./claude.js`, `./mistral.js`, `./opencode.js`, `./limit-hit.js`).
- `tools/sessions` kept as `require()` (still CJS, not in this wave) — same pattern as the launcher modules.
- Added TS types: `LauncherStatus` interface (unifies the 4 status return shapes), `AgentConfig`/`ReadAgentConfigOptions` aliases, `StartAgentOptions` interface; typed every function signature; converted all inline JSDoc `@type`/`@param` casts to TS (`(x as any)`, `as [string, LauncherStatus]`, real annotations on `let`/`const` decls); `module.exports = {…}` → named `export {…}` with `setCommandPathProbe` promoted to a `const`.
- **No circular dependency** materialized (none of claude/codex/mistral/opencode/stage-telemetry import `agents`), so no lazy `require()` workaround was needed (Risk in MISSION.md did not trigger).

**One out-of-`lib/agents/` edit (Stop-Rule note):** `lib/core/runtime-matrix.ts:3`
carried a wave-2 forward-compat shim `// @ts-expect-error agents.js is CJS without
type declarations` on its `import … from '../agents/agents.js'`. Once `agents.ts`
exports real types, that directive became *unused*, producing `error TS2578` and
failing the `tsc --noEmit` Gate. Removing the single obsolete comment line (the
import itself is unchanged and is now properly type-checked) is the minimal,
intended completion of this exact migration — the shim was placed in anticipation
of this wave. This was the only file outside `lib/agents/` touched, and only to
delete one obsolete suppression directive, not to alter logic.

## Goal Check

| Goal / Success Criterion | Evidence | Status |
|--------------------------|----------|--------|
| SC1 — all 12 modules ESM, no `module.exports` | `grep -c 'module.exports' lib/agents/*.ts` → 0 for all 12 files | PASS |
| SC2 — `npm test` identical to baseline | baseline 1751/1729 pass/0 fail/22 skip → post-conversion **1751 / 1729 pass / 0 fail / 22 skip** (no new failures) | PASS |
| SC3 — `npm run typecheck` zero errors | `tsc --noEmit` exits 0 (no `error TS` lines) | PASS |
| SC4 — exported symbols importable, no ERR_REQUIRE_ESM/MODULE_NOT_FOUND | `node -e "require('./lib/agents/agents')"` → 17 exports, `startAgent=function`; `lib/core/runtime-matrix.ts:4` imports `eligibleAgentsForStep`/`workflowLauncherStatus` and typechecks clean | PASS |
| SC5 — no public-API regression | `agents.ts:910` `export {…}` lists same 17 symbols; launcher/telemetry tests pass unchanged (`test/agents.test.js`, `test/claude.test.js`, `test/codex.test.js`, `test/opencode.test.js`, `test/limit-hit.test.js`) | PASS |
| SC6 / Gate — `git ls-files lib/agents/*.js` empty | command returns no output | PASS |
| SC7 — faithful rename ≤50% change | `git diff -M --summary` similarity: agents 80%, claude 75%, codex 76%, mistral 80%, opencode 76%, stage-telemetry 80%, 6 leaves 83–98%; agents combined 260 ≤ 466 budget; every file within its 50% budget | PASS |
| SC8 / Gate — `verify-local.sh static-analysis` green | "ALL STAGES PASSED" (ESLint clean, tsc clean, test-hygiene clean) | PASS |
| SC9 / Gate — `prepublishOnly` + `npm pack` ships 12 compiled `.js` | `npm pack --dry-run` lists all 12 `lib/agents/*.js` (count = 12) | PASS |
| SC10 / Gate — compiled CJS wrapper loads | `node -e "require('./lib/agents/agents')"` loads with exports intact | PASS |
| Gate — `grep module.exports lib/agents/*.ts` zero each | 0 for all 12 | PASS |
| CP-3 — circular-dep risk | none observed; no lazy `require()` needed for agent siblings | PASS |

## Migration complete

All 12 modules converted (CP-1 leaves, CP-2 launchers, CP-3 aggregator). All 7
declared Gates pass.

## Next action

Hand off to review: commit `MISSION.md`, `CP-1.md`, `CP-2.md`, `CP-3.md`, the 12
renamed `lib/agents/*.ts` sources, the `.gitignore`/`.eslintignore` updates, and
the single obsolete-directive deletion in `lib/core/runtime-matrix.ts`; then
transition the backlog task to review.
