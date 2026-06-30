# CP 1: Convert lib/index.js → lib/index.ts

## Work Done

Converted `lib/index.js` (77-line barrel re-export) to `lib/index.ts` with ES module imports/exports.

### Key decisions:
- Used `import * as X from './path.js'` for modules with named exports (most `.ts` modules: agents, core/fmt, core/git, review/*, tools/*, commands/stats)
- Used `import X = require('./path.js')` for modules with `export =` pattern (commands/active, config, coverage-gate, diff, draft, handoff, integrate, rebase, resolve-conflict, stats-backfill, stats, status, core/gitignore, review/review)
- Used `import X = require('./path.js')` for still-CJS `.js` modules (mission-start, repair-handoff, setup, verify) with `@ts-expect-error` suppression since they are out of scope for conversion
- Used `import X from './path.js'` for `export default` modules (commands/checkpoint)
- All namespace imports are re-exported as `export const X = X` to preserve the original `module.exports.X = require('./path')` semantics

### Evidence:
- `lib/index.ts` created (134 lines), `lib/index.js` removed
- `npx tsc --noEmit` reports **zero errors** on the full codebase including the new file
- Import paths use `.js` extensions consistent with `module: NodeNext` / `moduleResolution: NodeNext`

## Goal Check

| Criterion | Evidence |
|-----------|----------|
| lib/index.ts compiles independently | `npx tsc --noEmit` — zero errors (confirmed) |
| All original exports preserved | 44 namespace re-exports in lib/index.ts match 44 `module.exports.*` in original lib/index.js |
| No new TypeScript errors introduced | `npx tsc --noEmit` before vs after: same zero errors (existing codebase had none) |

## Next action
Convert root `index.js` → `index.ts` (CP 2).
