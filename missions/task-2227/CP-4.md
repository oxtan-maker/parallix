# CP-4: Prevent sibling JavaScript during review

Corrected the post-cutover compatibility path that still allowed
`npm run build:cjs` to emit untracked JavaScript beside TypeScript sources.
The command now performs a no-emit CommonJS compatibility check, while build
freshness, integration refresh, package preparation, and the integration build
gate all use the canonical `dist/` output. The freshness guard also normalizes
the compiled CLI's `dist/` runtime directory back to the checkout root before
comparing source and output mtimes.

The generated sibling files found during diagnosis were moved out of the
worktree to recoverable temporary directories. The full test suite and required
static-analysis gate pass, and the only untracked repository file before this
checkpoint is this new regression test.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| `build:cjs` cannot emit sibling runtime files | `package.json:54`; `test/task-2227-build-cjs-clean.test.js`, `"build:cjs is a no-emit compatibility check and cannot create source siblings"` | PASS |
| Build and package paths use canonical `dist/` output | `package.json:55-56`; `config/integration-pipelines.json`; `scripts/refresh-global-px.sh` | PASS |
| Build freshness compares TypeScript sources to `dist/` from the compiled CLI | `lib/core/build-freshness.ts`; `test/task-1413-stale-build.test.js` | PASS |
| Integration refresh uses the distribution build | `lib/commands/integrate.ts`; `test/integrate.test.js`; `test/task-2203-publish-proof-refresh-order.test.js` | PASS |
| Runtime and static-analysis verification pass | `npm test` (886 passed, 0 failed); `./scripts/verify-local.sh static-analysis` (all four stages passed); `node test/e2e-mission-lifecycle.test.js` (6 passed, 0 failed) | PASS |
| Review checkout contains no generated sibling JavaScript | `git ls-files --others --exclude-standard`; `test/task-2227-build-cjs-clean.test.js` | PASS |
| ADR 0049 describes the active no-emit compatibility path and rollback behavior | ADR 0049 | PASS |

Next action: Commit the CP-4 correction and resume review with `node dist/px.js review` (or the installed `px` command).
