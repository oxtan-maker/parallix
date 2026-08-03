# CP-3 — Dependency-graph regression coverage

Added isolated dependency-graph tests for each of the six layers. The suite
asserts the exact allowed targets per source layer, exercises a permitted local
edge for each layer, proves a new application-to-adapter edge fails without an
exception, and verifies that a fully owned temporary exception is honored.
The existing application-boundary tests were run unchanged alongside them.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC5: Domain layer has named no-unallowlisted-violation coverage | "dependency graph validates domain layer imports without unallowlisted violations" | PASS |
| SC5: Application layer has named no-unallowlisted-violation coverage | "dependency graph validates application layer imports without unallowlisted violations" | PASS |
| SC5: Adapters layer has named no-unallowlisted-violation coverage | "dependency graph validates adapters layer imports without unallowlisted violations" | PASS |
| SC5: Interfaces layer has named no-unallowlisted-violation coverage | "dependency graph validates interfaces layer imports without unallowlisted violations" | PASS |
| SC5: Composition layer has named no-unallowlisted-violation coverage | "dependency graph validates composition layer imports without unallowlisted violations" | PASS |
| SC5: Entry layer has named no-unallowlisted-violation coverage | "dependency graph validates entry layer imports without unallowlisted violations" | PASS |
| SC6: A forbidden unallowlisted edge fails immediately | "dependency graph rejects a forbidden unallowlisted application-to-adapter edge immediately" | PASS |
| SC4: Explicitly owned exception behavior is covered | "dependency graph honors an explicitly owned legacy exception" | PASS |
| SC7: Existing application-boundary assertions remain unchanged and pass | `test/application-boundaries.test.ts`; `node --import tsx --test test/dependency-graph.test.ts test/application-boundaries.test.ts` | PASS |

Next action: run `./scripts/verify-local.sh static-analysis`, then `./scripts/verify-local.sh all`, capturing final committed evidence and the remaining exception records in CP-4.
