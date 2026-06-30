# CP 4: Update tsconfig.json for root .ts files

## Work Done

Updated `tsconfig.json` to:
1. Extended `include` from `["lib/**/*.ts"]` to `["index.ts", "px.ts", "lib/**/*.ts"]`
2. Changed `rootDir` from `"lib"` to `"."` (required since root files are now included)
3. Added `"resolveJsonModule": true` (required for `import packageJson from './package.json'` in px.ts)

### Evidence:
- `npx tsc --noEmit` reports **zero errors** on the full tree
- `npm run build:cjs` produces `index.js` (11522 bytes) and `px.js` (9585 bytes) in project root
- Both files exist at project root after build

## Goal Check

| Criterion | Evidence |
|-----------|----------|
| tsconfig includes root .ts files | `include: ["index.ts", "px.ts", "lib/**/*.ts"]` (tsconfig.json:13-16) |
| tsc --noEmit zero errors | `npx tsc --noEmit` — no output (confirmed) |
| build:cjs produces root .js | `ls -la index.js px.js` — both exist (index.js: 11522 bytes, px.js: 9585 bytes) |
| resolveJsonModule enabled | `"resolveJsonModule": true` (tsconfig.json:12) |

## Next action
Migrate ESLint from `.eslintrc.cjs` + `.eslintignore` to flat config `eslint.config.mjs` (CP 5).
