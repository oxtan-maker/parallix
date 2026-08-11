# CP-3: Mutation proof that the responsibility guards bite (task-2332.08)

## Summary of work done

CP 3 executed the mutation coverage SC4 requires. The four negative fixtures landed in
`test/dependency-graph.test.ts` during CP 2; this checkpoint proves each one is load-bearing by
mutating the guard (or the tree) and confirming that exactly the intended rule turns red, then
restoring the tree. All mutations were applied to the committed tree at `50ad6c80a` and reverted with
`git checkout -- src/adapters/architecture/boundary-guards.ts`; `git status --short` is clean
afterwards.

Baseline before every mutation: `npx tsx --test test/dependency-graph.test.ts` → 33 tests, 32 pass,
0 fail, 1 annotated skip.

### Mutation 1 — restore the blanket adapters-to-adapters permission

Applied: `allowedDependencyGraph.adapters` reverted to `['domain', 'application', 'adapters']`
(`src/adapters/architecture/boundary-guards.ts:34`) and `crossAdapterEdgeIsNamed`
(`src/adapters/architecture/boundary-guards.ts:137`) forced to `return true`.

Result: 33 tests, 29 pass, **3 fail** —
`"dependency graph grants adapters no blanket adapters-to-adapters permission"`,
`"cross-adapter guard rejects a prohibited direct import between unnamed adapter packages"`
(`test/dependency-graph.test.ts:207`) and
`"aggregate responsibility scan reports every failing rule for one fixture tree"`
(`test/dependency-graph.test.ts:316`).

This is the prohibited-direct-import mutation: reintroducing the blanket permission is detected, so
the named-rule table cannot silently regress to a wildcard.

### Mutation 2 — raise the multi-integration fan-out threshold

Applied: `multiIntegrationFanOutThreshold` set to `99`
(`src/adapters/architecture/boundary-guards.ts:201`).

Result: 33 tests, 29 pass, **3 fail** —
`"workflow guard fails multi-integration command sequencing beneath an arbitrary adapters path"`
(`test/dependency-graph.test.ts:252`),
`"workflow guard still fails the same sequencing after it is renamed and moved to another adapters path"`
(`test/dependency-graph.test.ts:263`) and
`"workflow guard permits an adapter that wires fewer integration packages than the threshold"`,
which pins the constant so the threshold cannot be widened without an explicit test change.

This is the adapter-owned workflow-sequencing mutation. The second failing test is the relabeling
proof: the same three-integration module is written to
`src/adapters/cli/commands/integrate.ts` and to `src/adapters/mechanisms/harmless-helper.ts`, and the
guard fails both, so moving or renaming a monolith cannot make it pass.

### Mutation 3 — remove hidden service-location detection

Applied: the dynamic-lookup predicate at `src/adapters/architecture/boundary-guards.ts:335` replaced
with a constant false branch.

Result: 33 tests, 29 pass, **3 fail** —
`"responsibility guard fails hidden service location in an adapter module"`
(`test/dependency-graph.test.ts:287`),
`"aggregate responsibility scan reports every failing rule for one fixture tree"` and
`"every responsibility violation names the offending file, the failed rule, and the expected owner"`
(`test/dependency-graph.test.ts:328`).

### Mutation 4 — add a new unclassified production module

Applied: `src/runtime/relabeled-monolith.ts` created outside the six responsibility roots (no guard
change at all).

Result: 33 tests, 31 pass, **1 fail** — `"production tree has no unclassified module"`
(`test/dependency-graph.test.ts:184`). The emitted diagnostic was:

```
src/runtime/relabeled-monolith.ts: rule unclassified-production-module failed — module is outside
every canonical responsibility root (src/domain, src/application, src/adapters, src/interfaces,
src/composition, src/entry); expected owner: application, actual owner: unclassified
```

Reproduce with `npx tsx -e "import {findUnclassifiedProductionModules, formatResponsibilityViolations} from './src/adapters/architecture/boundary-guards.ts'; console.log(formatResponsibilityViolations(findUnclassifiedProductionModules(process.cwd())))"`
after creating any file outside the six roots.

Each mutation failed a disjoint primary rule, and no mutation left the suite green.

### Live diagnostic against the real monolith

The workflow rule already bites the canonical tree. Running
`findWorkflowOwnershipViolations(process.cwd())` reports, among 21 modules:

```
src/adapters/cli/commands/integrate.ts: rule adapter-owned-workflow-sequencing failed — sequences 9
distinct integration packages (agents, backlog, config, filesystem, forgejo, git, process, review,
verification), at or above the 3-package workflow threshold; expected owner: application, actual
owner: adapter
```

`"workflow-ownership rule runs against the production tree and reports actionable diagnostics"`
asserts this shape on every run, so the rule cannot silently stop applying to production while
TASK-2332.15 is outstanding.

### Hermeticity and speed

Every fixture builds its tree with `fs.mkdtempSync` under `withTempRoot`
(`test/dependency-graph.test.ts:26`) and removes it in `finally`; the guard itself uses only
`node:fs` and `node:path` (`src/adapters/architecture/boundary-guards.ts:1`). No test opens a network
socket, contacts Forgejo, launches an agent, or spawns a CLI process. `npx tsx --test
test/dependency-graph.test.ts` completes in roughly 0.35 s.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC1 — every production module classified; guard fails with path and expected owner when unclassified | Mutation 4 created `src/runtime/relabeled-monolith.ts` and turned `"production tree has no unclassified module"` (`test/dependency-graph.test.ts:184`) red with a diagnostic naming path, rule and expected owner; scanner at `src/adapters/architecture/boundary-guards.ts:253` | Met |
| SC2 — cross-adapter imports need a named package rule or application-owned port; no blanket permission | Mutation 1 restored the blanket edge at `src/adapters/architecture/boundary-guards.ts:34` and `src/adapters/architecture/boundary-guards.ts:137` and turned `"cross-adapter guard rejects a prohibited direct import between unnamed adapter packages"` (`test/dependency-graph.test.ts:207`) red; named table at `src/adapters/architecture/boundary-guards.ts:48` | Met |
| SC3 — fixture placing multi-integration command sequencing under an arbitrary `src/adapters/` path fails, naming adapter as wrong owner | `"workflow guard fails multi-integration command sequencing beneath an arbitrary adapters path"` (`test/dependency-graph.test.ts:252`) and `"workflow guard still fails the same sequencing after it is renamed and moved to another adapters path"` (`test/dependency-graph.test.ts:263`) pass with no guard-configuration change; Mutation 2 on `src/adapters/architecture/boundary-guards.ts:201` turns both red | Met for fixtures; production assertion deferred to TASK-2332.15 |
| SC4 — mutation coverage for prohibited direct import, hidden service-location, adapter-owned sequencing, unclassified module | Four mutations executed above, each failing a disjoint rule: Mutation 1 → `test/dependency-graph.test.ts:207`; Mutation 3 → `"responsibility guard fails hidden service location in an adapter module"` (`test/dependency-graph.test.ts:287`); Mutation 2 → `test/dependency-graph.test.ts:252`; Mutation 4 → `test/dependency-graph.test.ts:184` | Met |
| SC5 — complete canonical tree passes with zero allowlist exceptions; all six ownerships exercised | `findProductionDependencyViolations` at `src/adapters/architecture/boundary-guards.ts:171` passes no allowlist; unskipped production scans `"production tree has no unclassified module"`, `"production tree has no unnamed cross-adapter dependency"` and `"production tree has no hidden service location"` are green; six ownerships exercised by `"responsibility classifier assigns each canonical root its owning responsibility"` and `"responsibility scan is clean for a tree that exercises all six responsibilities"` | Partial — workflow rule reports 21 modules owned by TASK-2332.15 |
| SC6 — diagnostics name offending file, failed responsibility rule, expected owner | Mutation 4's captured diagnostic and the live `src/adapters/cli/commands/integrate.ts` diagnostic above; asserted for every rule by `"every responsibility violation names the offending file, the failed rule, and the expected owner"` (`test/dependency-graph.test.ts:328`); formatter at `src/adapters/architecture/boundary-guards.ts:224` | Met |
| SC7 — `src/adapters/README.md` documents layer DAG, six responsibilities, cross-adapter constraints, named failing fixtures | Not started. The fixture names this document must cite are now fixed at `test/dependency-graph.test.ts:207`, `test/dependency-graph.test.ts:252`, `test/dependency-graph.test.ts:287` and `test/dependency-graph.test.ts:184` | Deferred to CP 4 |
| SC8 — `./scripts/verify-local.sh all` passes after guard, tests and docs are complete | Not run in CP 3. Focused run `npx tsx --test test/dependency-graph.test.ts` is green at 32 pass / 0 fail / 1 annotated skip; `bash scripts/test-hygiene.sh` reports `PASS: no test-hygiene violations` | Deferred to CP 4 |

Falsifiability vocabulary follows `ADR 0039`; the six roots follow `ADR 0051`.

Next action: Execute CP 4 by rewriting `src/adapters/README.md` — replace the "What this directory is
not" debt paragraph at `src/adapters/README.md:25` with the layer DAG from
`src/adapters/architecture/boundary-guards.ts:31`, the six responsibility categories from
`src/adapters/architecture/boundary-guards.ts:184`, the named cross-adapter rule table from
`src/adapters/architecture/boundary-guards.ts:48`, and the four biting-fixture test names — then run
`./scripts/verify-local.sh all` and record the result in `CP-4.md`.
