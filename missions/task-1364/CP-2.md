# CP-2: Convert lib/core/subagent-limit.js

## Goal

Convert `lib/core/subagent-limit.js` (28 lines) to TypeScript with faithful rename, ESM import/export, and zero `require`/`module.exports`.

## Work Done

1. **`lib/core/subagent-limit.ts`** (29 lines) — Converted `require('./product-config')` → `import { loadEffectiveConfig } from './product-config.js'`. Converted `module.exports = { buildSubagentLimitPrefix }` → `export function buildSubagentLimitPrefix(...)`. Added native TypeScript type `maxParallel: number | null | undefined` alongside JSDoc. Added type assertions (`as { [key: string]: unknown }` / `as { maxParallel?: number }`) for `cfg.adapters?.agents?.subagents` access to satisfy strict mode.
2. Deleted old `lib/core/subagent-limit.js` and ran `git rm --cached`.

## Goal Check

| Goal Check | Evidence | Status |
|---|---|---|
| Faithful rename ≥50% | `git diff --numstat <merge-base>:lib/core/subagent-limit.js lib/core/subagent-limit.ts` → `4 7 lib/core/{subagent-limit.js => subagent-limit.ts}` | PASS |
| No `require`/`module.exports` | `grep -n 'require\|module\.exports' lib/core/subagent-limit.ts` → zero matches | PASS |
| `tsc --noEmit` clean | `npx tsc --noEmit` → exit 0, zero diagnostics | PASS |
| All tests pass at baseline | `npm test` → 1731 pass, 0 fail (baseline ≥107) | PASS |
| Module loads via `require()` | `node -e "require('./lib/core/subagent-limit')"` → `buildSubagentLimitPrefix: function` | PASS |
| `build:cjs` produces compiled `.js` | `ls -la lib/core/subagent-limit.js` → 1276 bytes, compiled by `npm run build:cjs` | PASS |

## Next action

Execute CP-3: Convert `lib/core/nels.js` (199 lines, largest core file, complex glob matching logic).
