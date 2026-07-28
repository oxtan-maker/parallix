# CP-3: Reconcile ADR Addenda and Authority/Release Documentation

## Summary

Added dated reconciliation addenda to ADRs 0037, 0042, 0046, and 0049 preserving their original decision records. Updated `docs/authority-reference.md` entry points and public distribution section to reference the canonical ESM bundle (`build/px.mjs`) instead of the retired CommonJS `dist/` tree. Updated `docs/npm-package-major-migration.md` rollback section to reflect the retired transitional architecture. Updated `README.md` development section to name `build/px.mjs` instead of `dist/index.js`.

### ADR addenda (preserving original decisions)

- **ADR 0037** — notes that the `workflow/index.js` entry point and `workflow/lib/` module structure are superseded by the TypeScript runtime under `src/platform/runtime/` with esbuild canonical bundle; the lightweight harness principle is preserved.
- **ADR 0042** — confirms `util.styleText` for batch CLI color and Ink for interactive TUI remain in effect; the CLI entry is now `build/px.mjs`; the single-stack Ink direction is unchanged.
- **ADR 0046** — updates the published package description to the canonical ESM bundle (`build/px.mjs`), no `dist/` tree, no runtime `node_modules`, `bin.px: build/px.mjs`, no `main`/`exports`; zero-runtime-dependencies claim maintained.
- **ADR 0049** — supersedes the 2026-07-18 correction: `dist/` tree retired, mutation scoper targets TypeScript source under `src/platform/runtime/lib/` via `tsx`; diff-scoped + ratchet design unchanged.

### Authority and release documentation

- `docs/authority-reference.md` — entry points updated from `index.js`/`px.js` to `src/platform/runtime/index.ts`, `src/platform/runtime/px.ts`, and `build/px.mjs`; post-integrate hook section updated from `dist/` to `build/`; public distribution section updated with `build/px.mjs` executable, new tarball contents, and `npm run test:reproducible-output` verification.
- `docs/npm-package-major-migration.md` — rollback section updated: CommonJS `dist/` tree retired, rollback scripts removed, coherent rollback phase described.
- `README.md` — development section updated from `node dist/index.js` to `node build/px.mjs`.

### Test fixes (P1 finding: dist/ runtime still executed)

Three integration tests still referenced the retired `dist/` runtime:

- `test/external-target-resolution.test.ts` — `dist/index.js` → `build/px.mjs` (spawn target)
- `test/task-2231-unit-tests-hang-repro.test.ts` — `dist/lib/agents/opencode.js` → `.test-runtime/lib/agents/opencode.js` (module require)
- `test/package-persistent-data.test.ts` — `dist/lib/commands/stats.js` and `dist/lib/agents/agents.js` → TypeScript source via `tsx` loader (`src/platform/runtime/lib/commands/stats.ts`, `src/platform/runtime/lib/agents/agents.ts`); the `.test-runtime/` tree preserves `import.meta` from `transpileModule` which is incompatible with `node -e` CommonJS execution

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC4: ADR 0037 reconciliation addendum | `docs/adr/0037-ai-workflow-coordination-architecture.md` — "Reconciliation addendum (2026-07-27, task-2288)" section added | PASS |
| SC4: ADR 0042 reconciliation addendum | `docs/adr/0042-workflow-cli-color-rendering-approach.md` — "Reconciliation addendum (2026-07-27, task-2288)" section added | PASS |
| SC4: ADR 0046 reconciliation addendum | `docs/adr/0046-npm-publish-process-and-security.md` — "Reconciliation addendum (2026-07-27, task-2288)" section added | PASS |
| SC4: ADR 0049 reconciliation addendum | `docs/adr/0049-diff-scoped-mutation-testing-with-ratchet-enforcement.md` — "Reconciliation addendum (2026-07-27, task-2288)" section added | PASS |
| SC4: Authority documentation updated | `docs/authority-reference.md` — Entrypoints, post-integrate hook, and Public distribution sections reference `build/px.mjs` | PASS |
| SC4: Release/migration documentation updated | `docs/npm-package-major-migration.md` — Rollback section reflects retired `dist/` tree | PASS |
| SC4: README updated | `README.md:209` — `node build/px.mjs <command>` | PASS |
| P1 finding: dist/ test paths fixed | `test/external-target-resolution.test.ts:193` → `build/px.mjs`; `test/task-2231-unit-tests-hang-repro.test.ts:26` → `.test-runtime/lib/agents/opencode.js`; `test/package-persistent-data.test.ts` → TypeScript source via tsx | PASS |
| Gate: all tests pass | `./scripts/verify-local.sh all` — 1398 pass, 0 fail | PASS |
| Gate: static analysis passes | `./scripts/verify-local.sh static-analysis` — ALL STAGES PASSED | PASS |

Next action: Begin CP-4 — execute clean-checkout/release and compatibility verification, capture deterministic-artifact and post-verification-cleanliness evidence, and record the coherent rollback phase.
