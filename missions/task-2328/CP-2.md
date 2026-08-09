# CP-2 — Native ESM test seam and compatibility-runtime removal (task-2328)

## Summary

Removed the generated `.test-runtime` build path and converted the default test runner and affected tests to native ESM imports. `test/lib/module-mock.ts` provides mutable delegating facades through `node:test` module mocking, so test doubles remain in-process and do not invoke real agent or Forgejo paths. The default suite now runs source modules with `tsx` and `--experimental-test-module-mocks`.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC1 — no authored CommonJS syntax/output/boundary/globals | `test/run-default-tests.ts:1`; `test/lib/module-mock.ts:125`; `test/package.json` is absent | PARTIAL — production cleanup continues in CP-3 |
| SC2 — generator, tree, and consumers removed | `scripts/build-test-runtime.ts` is absent; `test/run-default-tests.ts:33`; `test/lib/module-mock.ts:3` | PASS |
| SC3 — writable-export tests use an ESM-native isolation seam without real services | `test/lib/module-mock.ts:125`; `test/handoff.test.ts:1`; `"active() success path: preflight, launch, and handoff run in order"` | PASS |
| SC4 — canonical build/release/test paths have no compatibility runtime branch | `test/lib/test-run-plan.ts:236`; `test/run-default-tests.ts:33`; `"default test runner routes every moved group to integration and excludes it from default"` | PARTIAL — production tooling cleanup continues in CP-3 |
| SC5 — reintroduction guard coverage | `test/default-test-suite.test.ts:1` | PENDING — focused repository guard is added in CP-3 |
| SC6 — active documentation describes ESM-only operation | `docs/npm-package-major-migration.md:1` | PENDING — documentation rewrite is completed in CP-3 |
| SC7 — final verifier passes | `npm test` — 1,702 passing tests, 0 failures | PARTIAL — final `./scripts/verify-local.sh all` runs in CP-5 |
| SC8 — canonical layer roots and no retired platform paths | `src/adapters/architecture/boundary-guards.ts:8`; `test/dependency-graph.test.ts` | PENDING — final conformance scan in CP-4 |

Next action: remove the remaining production compatibility exports, generated-output assumptions, and stale documentation; then add a focused reintroduction guard.
