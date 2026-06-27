# CP-2: package.json Scripts and devDependencies

## Summary

Added three new scripts to `package.json` `scripts`:
- `"build": "tsc"` — runs TypeScript compiler to emit .js from .ts sources
- `"prepublishOnly": "tsc"` — ensures clean build before npm publish
- `"typecheck": "tsc --noEmit"` — type-check .ts files without emitting

Added two new devDependencies:
- `"@typescript-eslint/parser": "^7.0.0"` — ESLint parser for TypeScript
- `"@typescript-eslint/eslint-plugin": "^7.0.0"` — ESLint plugin for TypeScript rules

All existing `package.json` fields preserved (name, version, main, bin, engines, files, repository, keywords, bugs, homepage, license, private, publishConfig).

`npm install` succeeded. `@typescript-eslint/parser@^7` and `@typescript-eslint/eslint-plugin@^7` resolved and installed alongside existing `eslint@^8.57.0`.

## Goal Check

| Criterion | Evidence |
|-----------|----------|
| `scripts.build` equals `"tsc"` | `package.json:50` — `"build": "tsc"` |
| `scripts.prepublishOnly` equals `"tsc"` | `package.json:51` — `"prepublishOnly": "tsc"` |
| `scripts.typecheck` equals `"tsc --noEmit"` | `package.json:54` — `"typecheck": "tsc --noEmit"` |
| `devDependencies["@typescript-eslint/parser"]` starts with `^7` | `package.json:59` — `"@typescript-eslint/parser": "^7.0.0"` |
| `devDependencies["@typescript-eslint/eslint-plugin"]` starts with `^7` | `package.json:58` — `"@typescript-eslint/eslint-plugin": "^7.0.0"` |
| `npm install` succeeds | Exit code 0; `node_modules/@typescript-eslint/parser/package.json` and `node_modules/@typescript-eslint/eslint-plugin/package.json` present |
| `npm run build` executes `tsc` | `npm run build` invokes `tsc` (TS18003 expected — no .ts files exist yet, per mission assumption at `MISSION.md:56`) |
| Existing fields preserved (name, version, main, bin, engines, files, repository, keywords, bugs, homepage, license, private, publishConfig) | `package.json:2-47` — all original fields present unchanged |

## Next action
Proceed to CP-3: Verify `.npmignore` does not exclude `.ts` files and run `npm pack --dry-run`.
