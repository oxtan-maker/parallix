# CP-1: ESLint Configuration

## Work Done

1. Created `.eslintrc.cjs` in repo root with:
   - `env: { node: true, es2024: true }` to suppress false positives on Node.js globals
   - `parserOptions: { ecmaVersion: 2024, sourceType: "module" }` to prevent silent mismatches with ES2024 features
   - 8 rules set to `error`: `no-undef`, `no-unused-vars`, `valid-typeof`, `no-unreachable`, `no-async-promise-executor`, `eqeqeq`, `curly`, `no-var`
2. Added `eslint@^8.57.0` and `typescript@^5.4.0` to `devDependencies` in `package.json`
3. Ran `npm install` to install dependencies
4. Verified with `npx --yes eslint --ext .js --max-warnings 0 lib/` — exits 1 with 603 errors (pre-existing violations, expected)

## Goal Check

| Criterion | Evidence |
|-----------|----------|
| `.eslintrc.cjs` contains 8 required rules | `.eslintrc.cjs:8-15` — all 8 rules (`no-undef`, `no-unused-vars`, `valid-typeof`, `no-unreachable`, `no-async-promise-executor`, `eqeqeq`, `curly`, `no-var`) set to `"error"` |
| Node.js env enabled | `.eslintrc.cjs:3-4` — `env: { node: true, es2024: true }` |
| parserOptions configured | `.eslintrc.cjs:6-8` — `parserOptions: { ecmaVersion: 2024, sourceType: "module" }` |
| `--max-warnings 0` flag | `verify-local.sh:19` — `npx --yes eslint --ext .js --max-warnings 0 lib/` |
| ESLint runs against `lib/**/*.js` | Verified: `npx --yes eslint --ext .js --max-warnings 0 lib/` scans all JS files in lib/ |
| Command exits non-zero on violations | Verified: exit code 1, 603 errors reported |
| eslint added as devDependency | `package.json:54` — `"eslint": "^8.57.0"` |

## Next action
CP-2: Create `tsconfig.json` with `allowJs`, `checkJs`, `noEmit`, `include` covering `lib/core/**/*.js` and `lib/commands/**/*.js`
