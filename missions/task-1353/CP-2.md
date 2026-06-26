# CP-2: TypeScript Configuration

## Work Done

1. Created `tsconfig.json` in repo root with:
   - `"allowJs": true` — enables checking JavaScript files
   - `"checkJs": true` — performs type checking on JS files
   - `"noEmit": true` — no output files, check-only mode
   - `"strict": true` — all strict type checks enabled
   - `"module": "NodeNext"`, `"moduleResolution": "NodeNext"` — Node.js ESM/CJS resolution
   - `"target": "ES2024"` — modern JS target
   - `"include": ["lib/core/**/*.js", "lib/commands/**/*.js"]` — targets correct directories
2. Added `typescript@^5.4.0` to `devDependencies` in `package.json` (installed in CP-1)
3. Verified with `npx tsc --checkJs --noEmit` — exits 2 with 3045 lines of type errors (pre-existing, expected)

## Goal Check

| Criterion | Evidence |
|-----------|----------|
| `tsconfig.json` has `allowJs: true` | `tsconfig.json:4` — `"allowJs": true` |
| `tsconfig.json` has `checkJs: true` | `tsconfig.json:5` — `"checkJs": true` |
| `tsconfig.json` has `noEmit: true` | `tsconfig.json:6` — `"noEmit": true` |
| `tsconfig.json` has `strict: true` | `tsconfig.json:7` — `"strict": true` |
| `include` covers `lib/core/**/*.js` | `tsconfig.json:14` — `"lib/core/**/*.js"` |
| `include` covers `lib/commands/**/*.js` | `tsconfig.json:15` — `"lib/commands/**/*.js"` |
| `tsc --checkJs --noEmit` runs and exits non-zero | Verified: exit code 2, 3045 lines of pre-existing type errors |
| typescript added as devDependency | `package.json:56` — `"typescript": "^5.4.0"` |

## Next action
CP-3: Create `scripts/test-hygiene.sh` to scan `test/**/*.test.js` for `.only` and unannotated `.skip`/`xit`
