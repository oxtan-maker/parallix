# CP 8: Run tsc --noEmit on full tree and fix all remaining type errors

## Work Done

Verified `tsc --noEmit` reports **zero errors** on the complete source tree.

### Previous tsc errors fixed during conversions:
- `lib/index.ts`: Mixed import patterns (`import X = require` for `export =` modules, `import * as X` for named exports, `import X from` for `export default` modules)
- `index.ts`: Added TypeScript types for STATE_COMMAND_MAP, loadStateMap, function parameters; fixed `actual` type narrowing; used `require.main === module` instead of `import.meta.url`
- `px.ts`: Added TypeScript interfaces (ParsedArgs, VersionInfo, ReviewEventParsed, RunOptions); fixed null→string narrowing for event args; handled `result.path` null check; used type assertion for exitFn
- `tsconfig.json`: Enabled `resolveJsonModule` for package.json import; updated `rootDir` to `.`; extended `include` to root files

### Evidence:
- `npx tsc --noEmit` reports **zero errors** on the full tree (root `.ts` + all `lib/**/*.ts`)
- `npm run typecheck` passes

## Goal Check

| Criterion | Evidence |
|-----------|----------|
| tsc --noEmit zero errors | `npx tsc --noEmit` — no output (confirmed) |
| Full tree compiled | `tsconfig.json:13-16` includes `index.ts`, `px.ts`, `lib/**/*.ts` |
| resolveJsonModule enabled | `tsconfig.json:12` — `"resolveJsonModule": true` |
| No new TS errors introduced | Same zero-error state as before adding lib/index.ts |

## Next action
Full integration verification — npm test, npm run build:cjs, npm run prepublishOnly, npm pack --dry-run (CP 9).
