# CP-1: Route source-checkout runtime and tests through dist

Updated the source-checkout runtime cutover: `pretest` builds `dist/`, package coverage and publish guards load built modules, integration and mutation verification load `dist/` modules, and all repository test imports now target the built runtime. The mutation scoper now maps changed TypeScript source paths to `dist/lib/**` runtime targets, with focused regression coverage.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Tests build and load the distribution runtime | `package.json:58`, `test/index.test.js:15`, `npm test` | PASS |
| Coverage, publish, integration, and mutation entry points load `dist/` modules | `package.json:55`, `package.json:61`, `scripts/verify-local.sh:135`, `scripts/verify-local.sh:259` | PASS |
| TypeScript diffs resolve to mutation targets under `dist/lib/**` | `lib/core/mutation-scoper.ts:43`, `lib/core/mutation-scoper.ts:53`, `"getChangedFiles maps tracked .ts sources to their dist runtime .js path"` | PASS |
| Coverage gate runs correctly from its built location | `lib/commands/coverage-gate.ts:71`, `"coverage-gate dry-run exits 0 and lists files"` | PASS |

Next action: Remove the final tracked sibling runtime file and obsolete sibling-output ignore globs while preserving `build:cjs` and its freshness guard.
