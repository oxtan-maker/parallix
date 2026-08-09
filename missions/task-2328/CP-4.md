# CP-4 — Ports-and-adapters conformance certification (task-2328)

## Summary

Certified that the ESM migration leaves no retired `src/platform/` path and that the test seam targets canonical modules beneath the six declared layer roots. Added a repository-level assertion, not only a temporary-fixture assertion, for `findPlatformPaths(process.cwd())`.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC1 — no authored CommonJS syntax/output/boundary/globals | `scripts/esm-only-guard.ts:7`; `"ESM-only guard accepts the repository and rejects module syntax, configuration, output, and retired-runtime references"` | PASS |
| SC2 — `.test-runtime` generator, tree, and consumers removed | `test/run-default-tests.ts:33`; `test/lib/module-mock.ts:3`; `scripts/build-test-runtime.ts` is absent | PASS |
| SC3 — writable-export tests use an ESM-native seam without real services | `test/lib/module-mock.ts:125`; `test/handoff.test.ts`; `"active() success path: preflight, launch, and handoff run in order"` | PASS |
| SC4 — build, package, SEA, release, verification, audit, and tests are ESM-only | `scripts/build-canonical-bundle.ts:118`; `scripts/verify-local.sh:180`; `scripts/package-content-audit.ts:147` | PASS |
| SC5 — repository guard has focused compliant/failing coverage | `test/esm-only-guard.test.ts`; `"ESM-only guard accepts the repository and rejects module syntax, configuration, output, and retired-runtime references"` | PASS |
| SC6 — active docs state ESM-only module and seam strategy | `docs/npm-package-major-migration.md:145`; `docs/adr/0049-diff-scoped-mutation-testing-with-ratchet-enforcement.md:347` | PASS |
| SC7 — final verifier passes | `npm test` — 1,702 passing tests, 0 failures | PARTIAL — required final verifier runs in CP-5 |
| SC8 — no retired platform root; imports resolve inside canonical roots | `src/adapters/architecture/boundary-guards.ts:8`; `src/adapters/architecture/boundary-guards.ts:51`; `"repository has no retired src/platform paths"` in `test/dependency-graph.test.ts` | PASS |

Next action: run `./scripts/verify-local.sh all` on the committed tree and record final evidence in CP-5.
