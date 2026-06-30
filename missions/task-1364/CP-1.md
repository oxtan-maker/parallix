# CP-1: Convert 3 Smallest Files

## Goal

Convert `lib/commands/setup.js`, `lib/commands/verify.js`, and `lib/commands/setup-review.js` to TypeScript with faithful renames, ESM import/export syntax, and zero `require`/`module.exports` in converted files.

## Work Done

1. **`lib/commands/verify.ts`** (2 lines) — Re-exports all named exports and default from `../core/verification.js`. Replaced `module.exports = require(...)` with `export *` + `export { default }`.
2. **`lib/commands/setup.ts`** (3 lines) — Re-exports `setupWizard` default from `../tools/setup-review.js`. Replaced `require`/`module.exports` with `import`/`export default`.
3. **`lib/commands/setup-review.ts`** (14 lines) — Wraps `setupReview` from `../tools/setup-review.js` in a command entry point. Converted `require` → `import { setupReview }`, `module.exports` → `export default`. Added native TypeScript types (`args: string[]`, `options?: {[key: string]: any}`) alongside existing JSDoc for strict-mode compliance.
4. **`lib/index.ts`** — Updated imports for `setup` and `verify` from `import X = require(...)` (CJS) to `import X from ...` (ESM), removing `@ts-expect-error` directives that were suppressing errors for the old CJS files.
5. Deleted old `.js` files and ran `git rm --cached` on them.

## Goal Check

| Goal Check | Evidence | Status |
|---|---|---|
| Faithful rename ≥50% | `git diff --numstat <merge-base>:lib/commands/setup.js lib/commands/setup.ts` → `2 2 lib/commands/{setup.js => setup.ts}` | PASS |
| Faithful rename ≥50% | `git diff --numstat <merge-base>:lib/commands/verify.js lib/commands/verify.ts` → `1 1 lib/commands/{verify.js => verify.ts}` | PASS |
| Faithful rename ≥50% | `git diff --numstat <merge-base>:lib/commands/setup-review.js lib/commands/setup-review.ts` → `5 5 lib/commands/{setup-review.js => setup-review.ts}` | PASS |
| No `require`/`module.exports` in converted files | `grep -n 'require\|module\.exports' lib/commands/setup.ts lib/commands/verify.ts lib/commands/setup-review.ts` → zero matches | PASS |
| `tsc --noEmit` clean | `npx tsc --noEmit` → exit 0, zero diagnostics | PASS |
| All tests pass at baseline | `npm test` → 1731 pass, 0 fail (baseline ≥107) | PASS |
| Modules load via `require()` | `node -e "require('./lib/commands/verify')"` → object with named exports + default | PASS |
| Modules load via `require()` | `node -e "require('./lib/commands/setup')"` → object with default export | PASS |
| Modules load via `require()` | `node -e "require('./lib/commands/setup-review')"` → object with default export | PASS |
| `lib/index.ts` imports updated | `lib/index.ts:43` `import setup from './commands/setup.js'` (was `@ts-expect-error import setup = require`) | PASS |
| `lib/index.ts` imports updated | `lib/index.ts:47` `import verify from './commands/verify.js'` (was `@ts-expect-error import verify = require`) | PASS |

## Next action

Execute CP-2: Convert `lib/core/subagent-limit.js` (28 lines, core utility with JSDoc type annotations).
