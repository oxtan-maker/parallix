# CP-2: Responsibility classifier, ownership rules and diagnostics (task-2332.08)

## Summary of work done

CP 2 replaced the coarse layer allowlist in `src/adapters/architecture/boundary-guards.ts` with an
executable responsibility-ownership model, removed the blanket adapter-to-adapter permission, and
gave every rule an actionable diagnostic. `test/dependency-graph.test.ts` was updated to the new
model and extended with the fixtures that prove each rule bites.

The mission was resumed from CP 2 under operator direction after CP-1 reported the TASK-2332.15
prerequisite blocker. That blocker is unchanged and is handled below without a guard allowlist,
directory exemption, or path bypass.

### 1. Blanket adapter-to-adapter permission removed (SC2)

`allowedDependencyGraph.adapters` is now `['domain', 'application']`
(`src/adapters/architecture/boundary-guards.ts:34`) — the `'adapters'` self-edge is gone. Every
cross-adapter edge is instead governed by named package-level rules in
`adapterPackageDependencies` (`src/adapters/architecture/boundary-guards.ts:48`), which lists each of
the 16 adapter packages and the exhaustive set of siblings it may import. `adapterPackageOf`
(`src/adapters/architecture/boundary-guards.ts:130`) resolves a module to its package and
`crossAdapterEdgeIsNamed` (`src/adapters/architecture/boundary-guards.ts:137`) is the only path by
which an adapter-to-adapter edge can pass. There is no wildcard entry, no per-file exception, and no
`LegacyDependencyException` used by the production scan.

`"cross-adapter rules name every adapter package and grant no wildcard"`
(`test/dependency-graph.test.ts`) enumerates `src/adapters/` at runtime and asserts the rule table
covers exactly those packages, contains no `'*'`, and names no unknown package — so a new adapter
package cannot be added without declaring its dependencies.

The mission's alternative mechanism, application-owned ports, remains available through the
adapter → application edge; the cross-adapter diagnostic names it explicitly as the remedy
(`src/adapters/architecture/boundary-guards.ts:269`).

### 2. Responsibility classification of every production module (SC1)

`responsibilities` (`src/adapters/architecture/boundary-guards.ts:180`) declares the six ownerships —
`domain`, `application`, `adapter`, `interfaces`, `composition`, `entry` — and `responsibilityRoots`
(`src/adapters/architecture/boundary-guards.ts:184`) binds each to exactly one canonical root.
`classifyResponsibility` (`src/adapters/architecture/boundary-guards.ts:239`) returns the owning
responsibility or `null`.

`findUnclassifiedProductionModules` (`src/adapters/architecture/boundary-guards.ts:253`) walks the
whole `src/` tree — `.ts` and `.tsx`, excluding `.d.ts` — and reports every module that no
responsibility root owns. This replaces the previous silent `if (!sourceLayer) {continue;}` skip:
a module in a new top-level directory, or loose at the `src/` root, now fails with its path and the
set of roots it could have declared. Measured on this worktree the scan reports 0 unclassified
modules across all 202 production modules.

### 3. Adapter-owned workflow sequencing (SC3)

`findWorkflowOwnershipViolations` (`src/adapters/architecture/boundary-guards.ts:287`) fails any
adapter module that directly imports `multiIntegrationFanOutThreshold` or more distinct sibling
adapter packages (`src/adapters/architecture/boundary-guards.ts:201`, value 3). The rule is
structural and content-independent, so it cannot be defeated by renaming a module, moving it to a new
`src/adapters/` sub-path, or adding entries to `adapterPackageDependencies` — naming more edges
satisfies SC2's rule but leaves the fan-out unchanged. That is what makes SC3's
"fails without adding or changing guard configuration" hold.

### 4. Hidden service location and complete-graph construction (SC4)

`findServiceLocationViolations` (`src/adapters/architecture/boundary-guards.ts:315`) generalizes the
former `findCompositionViolations` heuristic from a bare file list to typed violations covering the
whole production tree, reporting `hidden-service-location` for dynamic collaborator lookup and
`complete-graph-outside-composition` for object-graph assembly outside
`src/composition/application-services.ts`. `findCompositionViolations` is retained unchanged for
`test/application-boundaries.test.ts`, which still passes (10/10).

### 5. Actionable diagnostics (SC6)

`ResponsibilityViolation` (`src/adapters/architecture/boundary-guards.ts:210`) carries `file`,
`rule`, `expectedOwner`, `actualOwner` and `detail`; `formatResponsibilityViolation`
(`src/adapters/architecture/boundary-guards.ts:224`) renders

```
<file>: rule <rule> failed — <detail>; expected owner: <owner>, actual owner: <owner>
```

`findResponsibilityViolations` (`src/adapters/architecture/boundary-guards.ts:349`) is the aggregate
scan across all four rules.

### 6. Outstanding prerequisite, handled without a bypass

Applying the SC3 rule to the canonical tree reports 21 adapter modules, headed by
`src/adapters/cli/commands/integrate.ts` and `src/adapters/cli/commands/handoff.ts` (9 integration
packages each) — the command tree TASK-2332.15 re-homes, exactly as CP-1 predicted.

No allowlist, grandfather list, or path exemption was added to satisfy this. Instead the *production
assertion* of that single rule is deferred with the repository's own annotated-skip mechanism
(`scripts/test-hygiene.sh` accepts an inline `skip-reason:`), naming TASK-2332.15 as the owner:
`"production tree has no adapter-owned workflow sequencing"` in `test/dependency-graph.test.ts`. The
rule itself remains live: `"workflow-ownership rule runs against the production tree and reports
actionable diagnostics"` executes it against `process.cwd()` on every run and asserts each reported
violation names a real file, the failed rule, and `application` as the expected owner.

The three rules that the canonical tree already satisfies are asserted unskipped and green:
`"production tree has no unclassified module"`, `"production tree has no unnamed cross-adapter
dependency"`, and `"production tree has no hidden service location"`.

### 7. Verification run in this checkpoint

- `npx tsx --test test/dependency-graph.test.ts` — 33 tests, 32 pass, 0 fail, 1 annotated skip.
- `npx tsx --test test/application-boundaries.test.ts` — 10 tests, 10 pass, 0 fail.
- `npx eslint src/adapters/architecture/boundary-guards.ts test/dependency-graph.test.ts` — clean.
- `bash scripts/test-hygiene.sh` — `PASS: no test-hygiene violations`.
- `npx tsc --noEmit` — clean.
- `npx tsc --noEmit --project tsconfig.test.json` — 9 errors, all pre-existing in
  `test/review-backfill.test.ts` and `test/task-2332.14-review-use-case.test.ts`; the same 9 are
  present on the CP-1 commit with this checkpoint's changes stashed, and none are in
  `test/dependency-graph.test.ts`.

The mission gate `./scripts/verify-local.sh all` runs in CP 4.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC1 — every production module classified; guard fails with path and expected owner when unclassified | `findUnclassifiedProductionModules` at `src/adapters/architecture/boundary-guards.ts:253` scans all of `src/`; `responsibilities` at `src/adapters/architecture/boundary-guards.ts:180` and `classifyResponsibility` at `src/adapters/architecture/boundary-guards.ts:239`. Proven by `"responsibility scan reports a new unclassified production module with its path and expected owner"`, `"responsibility scan reports a loose module at the src root as unclassified"` and `"production tree has no unclassified module"` in `test/dependency-graph.test.ts` | Met |
| SC2 — cross-adapter imports need a named package rule or application-owned port; no blanket permission | Blanket self-edge removed at `src/adapters/architecture/boundary-guards.ts:34`; named table at `src/adapters/architecture/boundary-guards.ts:48`; enforcement at `src/adapters/architecture/boundary-guards.ts:137`. Proven by `"dependency graph grants adapters no blanket adapters-to-adapters permission"`, `"cross-adapter rules name every adapter package and grant no wildcard"`, `"cross-adapter guard rejects a prohibited direct import between unnamed adapter packages"` and `"production tree has no unnamed cross-adapter dependency"` in `test/dependency-graph.test.ts` | Met |
| SC3 — fixture placing multi-integration command sequencing under an arbitrary `src/adapters/` path fails, naming adapter as wrong owner | `findWorkflowOwnershipViolations` at `src/adapters/architecture/boundary-guards.ts:287` with the threshold constant at `src/adapters/architecture/boundary-guards.ts:201`. Proven by `"workflow guard fails multi-integration command sequencing beneath an arbitrary adapters path"` and `"workflow guard still fails the same sequencing after it is renamed and moved to another adapters path"` in `test/dependency-graph.test.ts`; both assert `expectedOwner: application`, `actualOwner: adapter` with no configuration change | Met for fixtures; production assertion deferred to TASK-2332.15 |
| SC4 — mutation coverage for prohibited direct import, hidden service-location, adapter-owned sequencing, unclassified module | All four negative fixtures exist in `test/dependency-graph.test.ts`: `"cross-adapter guard rejects a prohibited direct import between unnamed adapter packages"`, `"responsibility guard fails hidden service location in an adapter module"`, `"workflow guard fails multi-integration command sequencing beneath an arbitrary adapters path"`, `"responsibility scan reports a new unclassified production module with its path and expected owner"`. Rule detection lives at `src/adapters/architecture/boundary-guards.ts:315` and `src/adapters/architecture/boundary-guards.ts:349` | Fixtures land; CP 3 confirms each mutation fails for its intended rule |
| SC5 — complete canonical tree passes with zero allowlist exceptions; all six ownerships exercised | `findProductionDependencyViolations` at `src/adapters/architecture/boundary-guards.ts:171` passes no allowlist; three production scans are green and unskipped (`"production tree has no unclassified module"`, `"production tree has no unnamed cross-adapter dependency"`, `"production tree has no hidden service location"`). All six ownerships are exercised by `"responsibility classifier assigns each canonical root its owning responsibility"` and `"responsibility scan is clean for a tree that exercises all six responsibilities"` in `test/dependency-graph.test.ts` | Partial — workflow rule reports 21 modules owned by TASK-2332.15 |
| SC6 — diagnostics name offending file, failed responsibility rule, expected owner | `ResponsibilityViolation` at `src/adapters/architecture/boundary-guards.ts:210` and `formatResponsibilityViolation` at `src/adapters/architecture/boundary-guards.ts:224`. Proven by `"every responsibility violation names the offending file, the failed rule, and the expected owner"` in `test/dependency-graph.test.ts`, which asserts the rendered form for every violation of every rule | Met |
| SC7 — `src/adapters/README.md` documents layer DAG, six responsibilities, cross-adapter constraints, named failing fixtures | Not started in CP 2. Source material is now fixed: the DAG at `src/adapters/architecture/boundary-guards.ts:31`, the responsibility roots at `src/adapters/architecture/boundary-guards.ts:184`, and the named rules at `src/adapters/architecture/boundary-guards.ts:48` | Deferred to CP 4 |
| SC8 — `./scripts/verify-local.sh all` passes after guard, tests and docs are complete | Not run in CP 2. Focused runs are green: `npx tsx --test test/dependency-graph.test.ts` (32 pass, 1 annotated skip, 0 fail) and `npx tsx --test test/application-boundaries.test.ts` (10 pass, 0 fail); `bash scripts/test-hygiene.sh` reports `PASS: no test-hygiene violations` | Deferred to CP 4 |

Falsifiability vocabulary follows `ADR 0039`; the six roots and the UI-neutral application boundary
follow `ADR 0051`.

Next action: Execute CP 3 by running each of the four negative fixtures as a mutation proof —
revert `adapterPackageDependencies` to a blanket permission, raise
`multiIntegrationFanOutThreshold`, remove the service-location pattern, and add a module outside the
six roots — confirming each mutation turns exactly its own fixture red and recording the observed
failure output in `CP-3.md`.
