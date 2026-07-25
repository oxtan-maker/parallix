# CP-1: React/Ink production dependencies and JSX/TSX build configuration

## Summary

Promoted React, Ink, and @types/react from the TASK-2277 spike into production dependencies. Added JSX build configuration to tsconfig.json and a .tsx lint rule to eslint.config.mjs.

### Changes

1. **package.json** — Added `react@^19.2.3`, `ink@^6.8.0`, and `@types/react@^19.2.14` as production dependencies (matching TASK-2277 spike versions).
2. **tsconfig.json** — Added `"jsx": "react-jsx"` to compilerOptions, enabling JSX transformation for `.tsx` files.
3. **eslint.config.mjs** — Added a new lint configuration block for `**/*.tsx` files with the TypeScript parser, JSX ecmaFeatures, the same globals as the `.ts` block, and matching rules including `@typescript-eslint/no-require-imports: off` for JSX compatibility.

### Verification

- `./scripts/verify-local.sh all` passes: 1211 tests, 0 failures
- `./scripts/verify-local.sh static-analysis` — ESLint clean, test-hygiene clean, test typecheck clean. TypeScript typecheck has one pre-existing error in `src/platform/runtime/lib/commands/status.ts:203` (TS7006, implicit any) unrelated to this change.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| React in production dependencies | `package.json:58` lists `"react": "^19.2.3"` under dependencies | PASS |
| Ink in production dependencies | `package.json:57` lists `"ink": "^6.8.0"` under dependencies | PASS |
| @types/react in production dependencies | `package.json:56` lists `"@types/react": "^19.2.14"` under dependencies | PASS |
| JSX build config added | `tsconfig.json:13` contains `"jsx": "react-jsx"` | PASS |
| .tsx lint rule added | `eslint.config.mjs` new block for `**/*.tsx` with `parserOptions.ecmaFeatures.jsx: true` | PASS |
| `./scripts/verify-local.sh all` passes | 1211 tests pass, 0 failures | PASS |

Next action: CP-2 — Create `src/interfaces/tui/` with the static shell component and wire `px ui` entry through the composition root.
