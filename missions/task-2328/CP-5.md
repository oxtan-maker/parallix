# CP-5 — Final ESM-only verification (task-2328)

## Summary

Completed the ESM-only cutover: the generated compatibility runtime and its builder are gone, tests use the native module-mocking seam, production and release paths no longer emit or depend on compatibility globals, and the repository has focused regression coverage. The final repository verifier passed on the final mission tree.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC1 — no project-authored CommonJS syntax, output, boundary, or synthetic globals | `scripts/esm-only-guard.ts:7`; `src/composition/create-cli.ts:33`; `scripts/build-canonical-bundle.ts:121` retains only esbuild's `createRequire` interop bridge and no synthetic globals; `"ESM-only guard accepts the repository and rejects module syntax, configuration, output, and retired-runtime references"` | PASS |
| SC2 — builder, `.test-runtime` tree, and consumers removed | `scripts/build-test-runtime.ts` is absent; `test/run-default-tests.ts:33`; `test/lib/module-mock.ts:3` | PASS |
| SC3 — former writable-export tests use deterministic ESM-native isolation and no real services | `test/lib/module-mock.ts:125`; `test/handoff.test.ts`; `"active() success path: preflight, launch, and handoff run in order"` | PASS |
| SC4 — canonical bundle, npm package, SEA, release, verification, package audit, default/integration/static paths contain no compatibility branch | `scripts/build-canonical-bundle.ts:121` supplies only `createRequire` for esbuild-inlined third-party dependencies; `scripts/package-content-audit.ts:147`; `scripts/sea-surfaces.ts:110`; `scripts/verify-local.sh:180`; `npm run bundle && node build/px.mjs ui --help` — exit 0; `npm run test:integration` — 1,518 tests, 1,493 pass, 0 fail, 25 skipped, exit 0; `./scripts/verify-local.sh all` — 1,821 tests, 1,821 pass, 0 failures, exit 0. | PASS |
| SC5 — guard fails for module syntax, configuration/output, and retired-runtime references while accepting the tree | `scripts/esm-only-guard.ts:22` scans `src`, `scripts`, `test`, `config`, `eslint.config.mjs`, `package.json`; `test/esm-only-guard.test.ts`; `"ESM-only guard accepts the repository and rejects module syntax, configuration, output, and retired-runtime references"` | PASS |
| SC6 — active developer and architecture docs describe ESM-only strategy | `docs/npm-package-major-migration.md:145`; `docs/adr/0049-diff-scoped-mutation-testing-with-ratchet-enforcement.md:347` | PASS |
| SC7 — repository verifier completes successfully | `./scripts/verify-local.sh all` — 1,821 tests, 1,821 pass, 0 failures, exit 0 (final mission tree) | PASS |
| SC8 — six canonical roots remain authoritative and no `src/platform/` path remains | `src/adapters/architecture/boundary-guards.ts:8`; `src/adapters/architecture/boundary-guards.ts:51`; `"repository has no retired src/platform paths"` in `test/dependency-graph.test.ts` | PASS |

Next action: hand off the committed mission tree to Parallix lifecycle automation.
