# CP-1: tsconfig.json Rewritten

## Summary

Rewrote `tsconfig.json` to switch from type-check-only mode to full TypeScript emission mode:
- Changed `allowJs` from `true` to `false`
- Changed `checkJs` from `true` to `false`
- Changed `noEmit` from `true` to `false`
- Added `outDir: "."`
- Removed `include` array (was restricting to only `lib/core/**/*.js` and `lib/commands/**/*.js`)
- Added `exclude` array: `["test/", "graphify-out/", ".forgejo-local/"]`
- Preserved: `strict: true`, `module: "NodeNext"`, `moduleResolution: "NodeNext"`, `target: "ES2024"`

## Goal Check

| Criterion | Evidence |
|-----------|----------|
| `allowJs: false` | `tsconfig.json:3` — `"allowJs": false` |
| `checkJs: false` | `tsconfig.json:4` — `"checkJs": false` |
| `noEmit: false` | `tsconfig.json:5` — `"noEmit": false` |
| `outDir: "."` | `tsconfig.json:6` — `"outDir": "."` |
| `module: "NodeNext"` | `tsconfig.json:7` — `"module": "NodeNext"` |
| `moduleResolution: "NodeNext"` | `tsconfig.json:8` — `"moduleResolution": "NodeNext"` |
| `strict: true` | `tsconfig.json:9` — `"strict": true` |
| `target: "ES2024"` | `tsconfig.json:10` — `"target": "ES2024"` |
| `exclude` contains `test/` | `tsconfig.json:12` — `"test/"` |
| `exclude` contains `graphify-out/` | `tsconfig.json:13` — `"graphify-out/"` |
| `exclude` contains `.forgejo-local/` | `tsconfig.json:14` — `".forgejo-local/"` |
| `npm run typecheck` runs without type errors on current source tree | `npx tsc --noEmit` exits with TS18003 (expected — no .ts files exist yet per mission assumption at `MISSION.md:56`) |

## Next action
Proceed to CP-2: Add package.json scripts and devDependencies, then run `npm install` and `npm run build`.
