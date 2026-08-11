# CP-4: Architecture documentation and verification gate (task-2332.08)

## Summary of work done

CP 4 rewrote `src/adapters/README.md` to describe the enforced responsibility model and ran the
mission gate.

### 1. Architecture documentation (SC7)

`src/adapters/README.md` now carries four new sections:

- **The layer DAG** (`src/adapters/README.md:12`) — a table of the six responsibilities with their
  canonical roots and what each owns, followed by the permitted-edge DAG transcribed from
  `allowedDependencyGraph`, including the explicit note that `adapters` has no self-edge.
- **Cross-adapter dependency constraints** (`src/adapters/README.md:41`) — states that no blanket
  adapters-to-adapters permission exists, that every cross-adapter edge must match a named
  package-level rule in `adapterPackageDependencies`, that the table holds no wildcard and no
  per-file exception, and that the alternative is an application-owned port under
  `src/application/ports/`. It also records that naming an edge does not grant workflow ownership:
  the 3-package fan-out threshold still applies.
- **Enforced rules and the fixtures that prove they bite** (`src/adapters/README.md:82`) — a table
  mapping each of the five rules to the named fixtures that demonstrate its failure behaviour
  (`src/adapters/README.md:91` through `src/adapters/README.md:94`), a worked diagnostic showing
  file, rule and expected owner, and the hermeticity statement (only `node:fs`/`node:path`, no
  network, Forgejo, agent or CLI process).
- **Known outstanding debt** (`src/adapters/README.md:111`) — replaces the old "What this directory
  is not" paragraph. It names TASK-2332.15 as the owner of the `cli/commands/` re-homing, records
  that the rule reports those modules rather than exempting them, and states that only the tree-wide
  zero-violation assertion is annotated-skipped.

The `Layout` table (`src/adapters/README.md:65`) was completed with the `architecture/` and
`rebase/` packages, which the previous version omitted.

### 2. Mission gate (SC8)

`./scripts/verify-local.sh all` — **passed**: 2019 tests, 2018 pass, 0 fail, 0 cancelled,
1 skipped (the single annotated skip added by this mission), 67 suites, 57.7 s. A second run
filtered for this mission's tests confirms the architecture guard tests execute inside the full
suite rather than being dropped by the default runner: 17 matching result lines for
`responsibility` / `workflow guard` / `cross-adapter`.

Supporting checks, all clean:

- `npm test -- test/dependency-graph.test.ts` — 33 tests, 32 pass, 0 fail, 1 annotated skip, 341 ms.
- `npx tsx --test test/application-boundaries.test.ts` — 10 pass, 0 fail.
- `npx eslint src/adapters/architecture/boundary-guards.ts test/dependency-graph.test.ts` — no output.
- `bash scripts/test-hygiene.sh` — `PASS: no test-hygiene violations`.
- `npx tsc --noEmit` — clean.
- `npx tsc --noEmit --project tsconfig.test.json` — 9 errors, all pre-existing in
  `test/review-backfill.test.ts` and `test/task-2332.14-review-use-case.test.ts`; the identical 9 are
  present on commit `6fa93f407` with this mission's changes stashed, and none are in files this
  mission touched.

### 3. What this mission delivered

| Rule | Location | Production status |
|---|---|---|
| `unclassified-production-module` | `src/adapters/architecture/boundary-guards.ts:253` | Enforced, green (0 of 202 modules unclassified) |
| `cross-adapter-dependency-not-named` | `src/adapters/architecture/boundary-guards.ts:269` | Enforced, green (all 71 edges named) |
| `hidden-service-location` | `src/adapters/architecture/boundary-guards.ts:315` | Enforced, green |
| `complete-graph-outside-composition` | `src/adapters/architecture/boundary-guards.ts:315` | Enforced, green |
| `adapter-owned-workflow-sequencing` | `src/adapters/architecture/boundary-guards.ts:287` | Rule live and fixture-proven; reports 21 modules owned by TASK-2332.15 |

### 4. Remaining gap, stated plainly

SC3 and SC5 are met for the guard and its fixtures but **not** for the canonical tree's
workflow-ownership rule. `src/adapters/cli/commands/` still holds 9,342 lines of multi-integration
command sequencing, so `findWorkflowOwnershipViolations(process.cwd())` reports 21 modules. This is
the TASK-2332.15 prerequisite that CP-1 raised as a stop-rule blocker; the mission was resumed from
CP 2 by operator direction with that blocker unresolved.

No allowlist, grandfather list, directory exemption, or path bypass was added to conceal it — the
Restricted Areas forbid all four, and none appear in the guard. The deferral is confined to one
annotated-skipped test, `"production tree has no adapter-owned workflow sequencing"`, whose inline
`skip-reason:` names TASK-2332.15. Enabling it is a one-line change (`test.skip` → `test`) once that
task lands; nothing else in the guard needs to move.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC1 — every production module classified; guard fails with path and expected owner when unclassified | `findUnclassifiedProductionModules` at `src/adapters/architecture/boundary-guards.ts:253`, roots at `src/adapters/architecture/boundary-guards.ts:184`. Green in production via `"production tree has no unclassified module"` (`test/dependency-graph.test.ts:184`); bites via `"responsibility scan reports a new unclassified production module with its path and expected owner"` (`test/dependency-graph.test.ts:165`) and `"responsibility scan reports a loose module at the src root as unclassified"` | Met |
| SC2 — cross-adapter imports need a named package rule or application-owned port; no blanket permission | Self-edge removed at `src/adapters/architecture/boundary-guards.ts:34`; named table at `src/adapters/architecture/boundary-guards.ts:48`; sole enforcement path at `src/adapters/architecture/boundary-guards.ts:137`. Proven by `"dependency graph grants adapters no blanket adapters-to-adapters permission"`, `"cross-adapter rules name every adapter package and grant no wildcard"`, `"cross-adapter guard rejects a prohibited direct import between unnamed adapter packages"` (`test/dependency-graph.test.ts:207`) and `"production tree has no unnamed cross-adapter dependency"` | Met |
| SC3 — fixture placing multi-integration command sequencing under an arbitrary `src/adapters/` path fails, naming adapter as wrong owner | `findWorkflowOwnershipViolations` at `src/adapters/architecture/boundary-guards.ts:287`, threshold at `src/adapters/architecture/boundary-guards.ts:201`. `"workflow guard fails multi-integration command sequencing beneath an arbitrary adapters path"` (`test/dependency-graph.test.ts:252`) and `"workflow guard still fails the same sequencing after it is renamed and moved to another adapters path"` (`test/dependency-graph.test.ts:263`) pass with no configuration change and assert `expectedOwner: application`, `actualOwner: adapter` | Met for the guard and its fixtures; production assertion deferred to TASK-2332.15 |
| SC4 — mutation coverage for prohibited direct import, hidden service-location, adapter-owned sequencing, unclassified module | Four mutations executed and recorded in `missions/task-2332.08/CP-3.md`, each failing a disjoint rule: blanket permission restored → `test/dependency-graph.test.ts:207`; fan-out threshold raised → `test/dependency-graph.test.ts:252`; service-location predicate disabled → `"responsibility guard fails hidden service location in an adapter module"` (`test/dependency-graph.test.ts:287`); new module outside the roots → `test/dependency-graph.test.ts:184` | Met |
| SC5 — complete canonical tree passes with zero allowlist exceptions; all six ownerships exercised | `findProductionDependencyViolations` at `src/adapters/architecture/boundary-guards.ts:171` passes no allowlist and the guard holds no exception list. Four of five rules are green on the canonical tree (`"production tree has no unclassified module"`, `"production tree has no unnamed cross-adapter dependency"`, `"production tree has no hidden service location"`, `"dependency graph production scan has no violation outside the owned allowlist"`). All six ownerships exercised by `"responsibility classifier assigns each canonical root its owning responsibility"` (`test/dependency-graph.test.ts:156`) and `"responsibility scan is clean for a tree that exercises all six responsibilities"` | Partial — `adapter-owned-workflow-sequencing` reports 21 modules that TASK-2332.15 re-homes; no exception was added to hide them |
| SC6 — diagnostics name offending file, failed responsibility rule, expected owner | `ResponsibilityViolation` at `src/adapters/architecture/boundary-guards.ts:210`, formatter at `src/adapters/architecture/boundary-guards.ts:224`. Asserted for every rule by `"every responsibility violation names the offending file, the failed rule, and the expected owner"` (`test/dependency-graph.test.ts:328`); worked example documented at `src/adapters/README.md:82` | Met |
| SC7 — `src/adapters/README.md` documents layer DAG, six responsibilities, cross-adapter constraints, named failing fixtures | Layer DAG and six responsibilities at `src/adapters/README.md:12`; cross-adapter constraints and the application-owned-port alternative at `src/adapters/README.md:41`; fixture table naming the biting tests at `src/adapters/README.md:91`–`src/adapters/README.md:94`; outstanding TASK-2332.15 debt at `src/adapters/README.md:111` | Met |
| SC8 — `./scripts/verify-local.sh all` passes after guard, tests and docs are complete | `./scripts/verify-local.sh all` passed: 2019 tests, 2018 pass, 0 fail, 1 annotated skip, 67 suites. A filtered rerun confirms this mission's guard tests run inside the full suite. `bash scripts/test-hygiene.sh` reports `PASS: no test-hygiene violations`; `npx eslint src/adapters/architecture/boundary-guards.ts test/dependency-graph.test.ts` is clean | Met |

Falsifiability vocabulary follows `ADR 0039`; the six responsibility roots and the UI-neutral
application boundary follow `ADR 0051`.

Next action: Hand this mission to review noting that SC3 and SC5 are complete for the guard and its
fixtures but that the `adapter-owned-workflow-sequencing` rule reports 21 production modules pending
TASK-2332.15; on that task's completion, flip `test.skip` to `test` for
`"production tree has no adapter-owned workflow sequencing"` in `test/dependency-graph.test.ts` and
delete the `Known outstanding debt` section at `src/adapters/README.md:111`.
