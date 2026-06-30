# CP 2: Convert index.js → index.ts (root entry point)

## Work Done

Converted root `index.js` (257 lines) to `index.ts` (258 lines) with ES module imports/exports.

### Key decisions:
- Converted CommonJS `require`/`module.exports` to ES `import`/`export`
- Used `import * as fmt from './lib/core/fmt.js'` for namespace import
- Used named imports for `ensureStandaloneGitRepo` and `loadStateMap`
- Preserved shebang line (`#!/usr/bin/env node`)
- Preserved all 9 exported members: `KNOWN_COMMANDS`, `main`, `printUsage`, `printAliases`, `suggestCommand`, `buildSuggestionSuffix`, `levenshteinDistance`, `deriveAliases`, `resolveAlias`
- Used CommonJS `require.main === module` check (compatible with `module: NodeNext` treating `.ts` as CJS without `"type": "module"`)
- Added TypeScript types: `Record<string, string>` for STATE_COMMAND_MAP, `Record<string, unknown>` for stateMap, explicit types on function parameters
- Fixed `actual` type narrowing (`typeof actual === 'string'`) to satisfy strict indexing

### Evidence:
- `index.ts` created (258 lines), `index.js` removed
- `npx tsc --noEmit` with extended include reports **zero errors**
- `__filename` and `__dirname` used as globals (from `@types/node`)

## Goal Check

| Criterion | Evidence |
|-----------|----------|
| index.ts compiles with project tsconfig | `npx tsc --noEmit --project tsconfig.test.json` — zero errors |
| All original exports preserved | 9 named exports match 9 entries in original `module.exports` |
| Shebang preserved | Line 1: `#!/usr/bin/env node` |
| No behavior change | Logic identical to original; only type annotations and import syntax changed |

## Next action
Convert root `px.js` → `px.ts` (CP 3).
