# CP-1 — Remove the adapter workflow-sequencing rule

## Summary

Retired the count-threshold workflow-ownership rule from the architecture guard
and removed every test that depended on it.

`src/adapters/architecture/boundary-guards.ts`:
- Deleted the exported constant `multiIntegrationFanOutThreshold`.
- Deleted `findWorkflowOwnershipViolations` and its call site inside the
  `findResponsibilityViolations` aggregate.
- Removed `'adapter-owned-workflow-sequencing'` from the `ResponsibilityRule`
  union, leaving exactly four members.
- Replaced the threshold doc comment with a comment on `ResponsibilityRule`
  recording *why* the rule was retired: a count of distinct sibling packages
  cannot distinguish a mechanism that legitimately uses three siblings from a
  module that sequences a multi-integration workflow, so the rule was removed
  rather than kept permanently skipped.

`test/dependency-graph.test.ts`:
- Deleted the SC3 fixture helper `withWorkflowFixture` and its three fixture
  tests (`"workflow guard fails multi-integration command sequencing beneath an
  arbitrary adapters path"`, `"workflow guard still fails the same sequencing
  after it is renamed and moved to another adapters path"`, `"workflow guard
  permits an adapter that wires fewer integration packages than the threshold"`).
- Deleted the skipped `test.skip('production tree has no adapter-owned workflow
  sequencing', ...)` together with its explanatory comment block, and deleted
  `"workflow-ownership rule runs against the production tree and reports
  actionable diagnostics"`.
- Dropped the now-unused imports `findWorkflowOwnershipViolations` and
  `multiIntegrationFanOutThreshold`.
- Renumbered the two following section banners (`SC4 —` to `SC3 —`, `SC5/SC6 —`
  to `SC4/SC5 —`) so the remaining section labels stay contiguous.

No allowlist, grandfather list, path exemption, skip annotation, or `.only` was
added. `src/adapters/README.md` still carries the retired rule's text; that is
CP-3's scope, so SC1 is not yet fully satisfied.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC1 — no reference to the retired rule remains in `src`/`test` code | `git grep -n "multiIntegrationFanOutThreshold\|findWorkflowOwnershipViolations\|adapter-owned-workflow-sequencing" -- src test` returns only four lines, all in `src/adapters/README.md` (lines 63, 95, 103, 118); zero matches in `src/adapters/architecture/boundary-guards.ts` and `test/dependency-graph.test.ts` | PARTIAL — README rewrite is CP-3 |
| SC2 — `ResponsibilityRule` declares exactly four members | `src/adapters/architecture/boundary-guards.ts` union now lists `'unclassified-production-module'`, `'cross-adapter-dependency-not-named'`, `'hidden-service-location'`, `'complete-graph-outside-composition'`; `npx tsc --noEmit` exits 0, so no exhaustiveness consumer broke | PASS |
| SC3 — no skipped/focused tests, suite green | `git grep -n "\.only\|test\.skip\|describe\.skip\|it\.skip" -- test/dependency-graph.test.ts` returns no lines; `npm test -- test/dependency-graph.test.ts` reports `tests 28 / pass 28 / fail 0 / skipped 0 / todo 0` | PASS |
| SC9 — no allowlist, exemption, or skip introduced | `test/dependency-graph.test.ts` and `src/adapters/architecture/boundary-guards.ts` gained no new path list; the only allowlist parameter is the pre-existing `LegacyDependencyException[]` on `findDependencyViolations`, exercised unchanged by `"dependency graph honors an explicitly owned legacy exception"` | PASS |
| Aggregate scan unaffected by the removal | `"aggregate responsibility scan reports every failing rule for one fixture tree"` passes unchanged under `npm test -- test/dependency-graph.test.ts` | PASS |
| No stop rule triggered — no consumer outside the two in-scope files | `git grep` for `findWorkflowOwnershipViolations` over `src test` found consumers only in `test/dependency-graph.test.ts`; `npx tsc --noEmit` and `npx eslint src/adapters/architecture/boundary-guards.ts test/dependency-graph.test.ts` both exit 0 | PASS |

Next action: CP-2 — mutate each of the four retained rules off in a scratch edit
(`findUnclassifiedProductionModules`, `findCrossAdapterViolations`, and the two
branches of `compositionOwnershipViolations` in
`src/adapters/architecture/boundary-guards.ts`), run
`npm test -- test/dependency-graph.test.ts` per mutation, and record the fixture
that turned red with its quoted failing assertion.
