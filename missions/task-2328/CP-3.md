# CP-3 — ESM-only production, release, and guard cleanup (task-2328)

## Summary

Removed authored CommonJS compatibility exports and fallback globals from CLI commands, verification gates, bundle generation, package/release tooling, and ESLint configuration. The bundle no longer injects module-loader globals. Active package and architecture documentation now describes the ESM-only payload and native module-mocking seam. Added a focused guard for reintroduced module syntax, configuration, emitted output, and retired runtime references.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC1 — no authored CommonJS syntax/output/boundary/globals | `src/composition/create-cli.ts:33`; `scripts/build-canonical-bundle.ts:118`; `scripts/esm-only-guard.ts:7` | PASS |
| SC2 — `.test-runtime` generator, tree, and consumers removed | `scripts/build-test-runtime.ts` is absent; `test/run-default-tests.ts:33`; `scripts/esm-only-guard.ts:11` | PASS |
| SC3 — writable-export tests use an ESM-native seam without real services | `test/lib/module-mock.ts:125`; `"active() success path: preflight, launch, and handoff run in order"` | PASS |
| SC4 — bundle, package, SEA, release, verification, audit, and test paths have no compatibility branch | `scripts/build-canonical-bundle.ts:118`; `scripts/package-content-audit.ts:147`; `scripts/sea-surfaces.ts:110`; `scripts/verify-local.sh:180` | PASS |
| SC5 — guard rejects reintroduced syntax, config/output, and retired runtime reference | `scripts/esm-only-guard.ts:7`; `test/esm-only-guard.test.ts`; `"ESM-only guard accepts the repository and rejects module syntax, configuration, output, and retired-runtime references"` | PASS |
| SC6 — active developer and architecture docs explain ESM-only modules and seams | `docs/npm-package-major-migration.md:52`; `docs/adr/0049-diff-scoped-mutation-testing-with-ratchet-enforcement.md:347` | PASS |
| SC7 — final verifier passes | `npm test` — 1,702 passing tests, 0 failures | PARTIAL — final mission gate is CP-5 |
| SC8 — TASK-2332.06 layout survives | `src/adapters/architecture/boundary-guards.ts:8`; `test/dependency-graph.test.ts` | PENDING — repository-level assertion is recorded in CP-4 |

Next action: certify the final dependency graph and retired-root scan with the repository-level `findPlatformPaths(process.cwd())` assertion.
