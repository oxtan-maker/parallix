# CP-2 — Prove the four retained rules bite

## Summary

Ran a mutation check against each of the four rules the `ResponsibilityRule`
union still declares in `src/adapters/architecture/boundary-guards.ts`. For each
rule the detection was disabled in a scratch edit, `npm test -- test/dependency-graph.test.ts`
was run, the fixture that turned red was recorded with its failing assertion, and
the edit was reverted with `git checkout -- src/adapters/architecture/boundary-guards.ts`.

Every rule already had at least one hermetic fixture that turns red when the rule
is mutated off, so **no new fixture was needed**. No production code outside the
two in-scope files was touched, and no stop rule was triggered.

Working tree after the four reverts is clean apart from the pre-existing
`package-lock.json` modification carried in from the mission's parent commit;
`npm test -- test/dependency-graph.test.ts` is back to `tests 28 / pass 28 /
fail 0 / skipped 0`.

### Mutation log

**1. `unclassified-production-module`** — mutated `findUnclassifiedProductionModules`
by replacing `.filter(file => classifyDependencyLayer(file, root) === null)` with
`.filter(() => false)`. Result: `pass 24 / fail 4`.
Red fixture: `"responsibility scan reports a loose module at the src root as unclassified"`.
Failing assertion:

```
AssertionError [ERR_ASSERTION]: Expected values to be strictly deep-equal:
    actual: [], expected: [ 'src/stray.ts' ]
```

Also red: `"responsibility scan reports a new unclassified production module with
its path and expected owner"` (`actual: []`, `expected: [ 'src/runtime/relabeled-monolith.ts' ]`)
and `"aggregate responsibility scan reports every failing rule for one fixture tree"`.

**2. `cross-adapter-dependency-not-named`** — mutated `findCrossAdapterViolations`
by replacing `.filter(violation => violation.sourceLayer === 'adapters' && violation.targetLayer === 'adapters')`
with `.filter(() => false)`.
Red fixture: `"cross-adapter guard rejects a prohibited direct import between unnamed adapter packages"`.
Failing assertion:

```
AssertionError [ERR_ASSERTION]: Expected values to be strictly deep-equal:
    actual: [],
    expected: [ [ 'src/adapters/alpha/source.ts', 'cross-adapter-dependency-not-named', 'application' ] ]
```

**3. `hidden-service-location`** — mutated the service-locator branch of
`compositionOwnershipViolations` by replacing
`if (/(?:serviceLocator|services)\s*\[/.test(source)) {` with `if (false) {`.
Red fixture: `"responsibility guard fails hidden service location in an adapter module"`.
Failing assertion:

```
AssertionError [ERR_ASSERTION]: Expected values to be strictly deep-equal:
    actual: [],
    expected: [ [ 'src/adapters/git/locator.ts', 'hidden-service-location', 'composition', 'adapters' ] ]
```

**4. `complete-graph-outside-composition`** — mutated the complete-graph branch of
`compositionOwnershipViolations` by replacing
`if (makesCompleteGraph && !file.endsWith(path.join('src', 'composition', 'application-services.ts'))) {`
with `if (false && makesCompleteGraph) {`.
Red fixture: `"responsibility guard fails complete-graph construction outside the composition root"`.
Failing assertion:

```
AssertionError [ERR_ASSERTION]: Expected values to be strictly deep-equal:
    actual: [],
    expected: [ [ 'src/adapters/mission/sneaky-root.ts', 'complete-graph-outside-composition', 'composition' ] ]
```

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC4 — production-tree assertions survive unchanged and pass | `"production tree has no unnamed cross-adapter dependency"`, `"production tree has no hidden service location"`, and `"production tree has no unclassified module"` all pass in `npm test -- test/dependency-graph.test.ts` (`pass 28 / fail 0`); none of the three was edited by this mission — CP-1 touched only the workflow-rule block of `test/dependency-graph.test.ts` | PASS |
| SC5 — the six named fixtures survive and pass | `"responsibility scan reports a new unclassified production module with its path and expected owner"`, `"responsibility scan reports a loose module at the src root as unclassified"`, `"cross-adapter guard rejects a prohibited direct import between unnamed adapter packages"`, `"cross-adapter rules name every adapter package and grant no wildcard"`, `"responsibility guard fails hidden service location in an adapter module"`, `"responsibility guard fails complete-graph construction outside the composition root"` — all present in `test/dependency-graph.test.ts` and green under `npm test -- test/dependency-graph.test.ts` | PASS |
| SC6.1 — `unclassified-production-module` bites | Mutation 1 above: `findUnclassifiedProductionModules` filter forced false; `"responsibility scan reports a loose module at the src root as unclassified"` red with `actual: [], expected: [ 'src/stray.ts' ]`; reverted | PASS |
| SC6.2 — `cross-adapter-dependency-not-named` bites | Mutation 2 above: `findCrossAdapterViolations` filter forced false; `"cross-adapter guard rejects a prohibited direct import between unnamed adapter packages"` red with `expected: [ [ 'src/adapters/alpha/source.ts', 'cross-adapter-dependency-not-named', 'application' ] ]`; reverted | PASS |
| SC6.3 — `hidden-service-location` bites | Mutation 3 above: service-locator branch of `compositionOwnershipViolations` forced false; `"responsibility guard fails hidden service location in an adapter module"` red with `expected: [ [ 'src/adapters/git/locator.ts', 'hidden-service-location', 'composition', 'adapters' ] ]`; reverted | PASS |
| SC6.4 — `complete-graph-outside-composition` bites | Mutation 4 above: complete-graph branch of `compositionOwnershipViolations` forced false; `"responsibility guard fails complete-graph construction outside the composition root"` red with `expected: [ [ 'src/adapters/mission/sneaky-root.ts', 'complete-graph-outside-composition', 'composition' ] ]`; reverted | PASS |
| No fixture had to be added, and no stop rule fired | All four mutations produced a red hermetic fixture, so the mission's "no red fixture" stop rule does not apply; `git status --porcelain` after the reverts shows only the pre-existing `package-lock.json` entry, and `npm test -- test/dependency-graph.test.ts` is green again | PASS |

Next action: CP-3 — rewrite `src/adapters/README.md`: drop the paragraph and the
`multiIntegrationFanOutThreshold` sentence at line 63, remove the
`adapter-owned-workflow-sequencing` enforced-rules row and its sample diagnostic
block, and rewrite "Known outstanding debt" to name
`src/adapters/cli/commands/` as unguarded and attribute re-homing to TASK-2332
(SC7, SC8).
