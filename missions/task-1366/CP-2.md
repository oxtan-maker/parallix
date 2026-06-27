# CP-2: Upstream Dependency (product-config) and state-map Converted

## Summary

Converted `product-config.js` → `product-config.ts` (536 → 512 lines) and `state-map.js` → `state-map.ts` (108 → 109 lines). Both use ESM `import`/`export` syntax. `product-config.ts` imports only Node.js builtins (`node:fs`, `node:path`, `node:child_process`). `state-map.ts` imports `./product-config.js` (already converted), `./fmt.js`, plus builtins `node:fs`, `node:path`. The dynamic `require('./fmt')` inside `transitionVirtual` was converted to a static top-level import `import * as fmtMod from './fmt.js';`.

## Goal Check

| Criterion | Evidence |
|-----------|----------|
| product-config.ts uses ESM syntax | `lib/core/product-config.ts:2` — `import fs from 'node:fs';`; `lib/core/product-config.ts:512` — `export { REQUIRED_ADAPTER_KEYS, DEFAULT_CONFIG };` |
| state-map.ts uses ESM syntax | `lib/core/state-map.ts:4` — `import { loadEffectiveConfig } from './product-config.js';`; `lib/core/state-map.ts:5` — `import * as fmtMod from './fmt.js';` |
| Zero require() in converted files | `grep -rn 'require(' lib/core/{product-config,state-map}.ts` returns zero matches |
| Zero module.exports in converted files | `grep -rn 'module.exports' lib/core/{product-config,state-map}.ts` returns zero matches |
| product-config tests pass | `test/product-config.test.js`: 27 tests — all pass (detectLegacyRepoLayout, isStandaloneWorkflowLayout, hasGitRepository, loadEffectiveConfig, validateWorkflowConfig, evaluateRepositoryReadiness, initializeGitRepository, ensureStandaloneGitRepo, commitWorkflowBaseline, ensureStandaloneMissionBaseline, resolveTaskStorage, loadAdapterConfig, resolveAgentAdapter, resolveAgentModel ×6) |
| state-map tests pass | `test/state-map.test.js`: 3 tests — all pass (toVirtual case-insensitive matching, loadStateMap configured path, loadStateMap fallback to shipped) |
| npm test baseline preserved | 1694 pass, 0 fail, 22 skipped — identical to baseline |
| tsc --noEmit clean | `npm run typecheck` reports zero errors |
| state-map imports product-config via ESM | `lib/core/state-map.ts:4` — `import { loadEffectiveConfig } from './product-config.js';` |

## Next action
Convert `runtime-matrix.ts` which imports `../agents/agents.js`. The agents.js module is out of scope but can be imported from ESM via CJS interop. After runtime-matrix conversion, run full validation.
