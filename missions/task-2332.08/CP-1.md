# CP-1: Inspection and prerequisite finding (task-2332.08)

## Summary of work done

CP 1 required inspecting the **post-TASK-2332.15** production tree, the current guard, and
`test/dependency-graph.test.ts`, then recording the responsibility classification model, the
current blanket adapter behavior, and the concrete named dependency/port rules the canonical
tree needs.

The inspection found that the post-TASK-2332.15 tree does not exist yet. TASK-2332.15 is still
in `backlog` status (`backlog/tasks/task-2332.15 - Finish-CLI-interface-migration-and-certify-command-ownership.md`,
`status: backlog`), and the worktree still carries the full pre-migration command tree under
adapter ownership. Both of this mission's prerequisite stop rules therefore fire. No guard,
fixture, or documentation changes were made; the inspection record below is the CP-1 deliverable.

### 1. Current guard behavior (`src/adapters/architecture/boundary-guards.ts`)

- Six layer roots are declared at `src/adapters/architecture/boundary-guards.ts:8` and match the
  six responsibilities this mission must enforce (`src/domain`, `src/application`, `src/adapters`,
  `src/interfaces`, `src/composition`, `src/entry`).
- Classification is **directory placement only**: `classifyDependencyLayer` at
  `src/adapters/architecture/boundary-guards.ts:80` resolves a file to the longest matching layer
  root and returns `null` otherwise. It inspects no module content, so a monolith that moves into
  `src/adapters/` is classified as an adapter purely by path — exactly the failure mode named in the
  task description.
- Unclassified production modules are **silently skipped**, not reported:
  `src/adapters/architecture/boundary-guards.ts:95` executes `if (!sourceLayer) {continue;}`. There is
  no scan that enumerates production modules and fails on a missing classification, so SC1 has no
  implementation today.
- The **blanket adapter-to-adapter permission** is `adapters: ['domain', 'application', 'adapters']`
  at `src/adapters/architecture/boundary-guards.ts:25`. Every cross-adapter edge in the repository is
  permitted by that single self-edge; no named package-level rule or application-owned port exists in
  the guard configuration.
- An exception mechanism exists: `findDependencyViolations` accepts a
  `LegacyDependencyException[]` allowlist (`src/adapters/architecture/boundary-guards.ts:39`,
  `src/adapters/architecture/boundary-guards.ts:89`). The production entry point
  `findProductionDependencyViolations` (`src/adapters/architecture/boundary-guards.ts:111`) passes no
  allowlist, so the canonical tree is already exception-free — but only because the blanket
  adapter self-edge makes exceptions unnecessary.
- The one content-aware check is `findCompositionViolations`
  (`src/adapters/architecture/boundary-guards.ts:137`), which regex-detects complete-graph
  construction outside `src/composition/application-services.ts` and service-location via
  `serviceLocator[...]`/`services[...]` at `src/adapters/architecture/boundary-guards.ts:145`. It is
  the only existing precedent for responsibility-based (rather than path-based) enforcement and is
  the natural seam to generalize for SC3 and the hidden-service-location mutation in SC4.

### 2. Current architecture-guard coverage (`test/dependency-graph.test.ts`)

- Per-layer permitted-edge tests exist for all six layers, e.g.
  `"dependency graph validates adapters layer imports without unallowlisted violations"`
  (`test/dependency-graph.test.ts:41`), which asserts the blanket
  `['domain', 'application', 'adapters']` adapter permission verbatim. That assertion must change
  when SC2 removes the blanket edge.
- Negative coverage is limited to two layer-pair edges:
  `"dependency graph rejects an interface import of a canonical composition module"`
  (`test/dependency-graph.test.ts:62`) and
  `"dependency graph rejects a forbidden unallowlisted application-to-adapter edge immediately"`
  (`test/dependency-graph.test.ts:69`).
- The canonical-tree assertion is
  `"dependency graph production scan has no violation outside the owned allowlist"`
  (`test/dependency-graph.test.ts:87`).
- There is **no** fixture for a prohibited direct import beyond layer pairs, none for hidden
  service-location, none for adapter-owned multi-integration workflow sequencing, and none for an
  unclassified production module. All four SC4 mutations are unimplemented.
- Fixtures are hermetic today: `withFixture` (`test/dependency-graph.test.ts:9`) builds a
  `mkdtempSync` tree and removes it, so the SC-required fixtures can follow the same pattern with no
  network, Forgejo, or agent access.

### 3. Production tree shape (measured on this worktree)

`find src -name '*.ts'` reports 202 TypeScript modules under the six roots
(adapters 113, application 61, domain 11, interfaces 10, composition 6, entry 1). Every one resolves
to a layer root by path, and `.tsx` files exist under `src/interfaces/tui/`, so a content-aware
classifier must cover `.tsx` as well as `.ts`. `src/package.json` is a non-module file at a layer
root boundary and must be excluded from "production module" enumeration for SC1.

Running the current production guard over this tree reports 0 dependency violations and 0 retired
platform paths, matching `test/dependency-graph.test.ts:87` and
`"repository has no retired src/platform paths"` (`test/dependency-graph.test.ts:103`).

### 4. Prerequisite blocker (stop rules fired)

Mission stop rule: *"Stop and report a prerequisite blocker if TASK-2332.15 is not complete or the
canonical tree still contains command workflow sequencing under adapter ownership."* Both halves
hold.

**(a) TASK-2332.15 is not complete.** Its Backlog file carries `status: backlog`.

**(b) Multi-integration command workflow sequencing is still adapter-owned.**
`src/adapters/cli/commands/` contains 20 command modules totalling 9,342 lines, including
`src/adapters/cli/commands/integrate.ts` (2,251 lines),
`src/adapters/cli/commands/stats.ts` (2,444 lines) and
`src/adapters/cli/commands/draft.ts` (1,293 lines). `src/adapters/cli/commands/integrate.ts:5`
through `src/adapters/cli/commands/integrate.ts:20` import and sequence git, Backlog, state-map
config, Forgejo, agent runtime, mission filesystem utilities, verification, the post-integrate
process hook, and review persistence in a single adapter module. The repository's own architecture
documentation already records this as unfinished debt at `src/adapters/README.md:27`: *"`cli/commands/`
still contains legacy command implementations that combine request handling, rendering, and workflow
sequencing with concrete integrations."*

This is precisely the artifact SC3 requires the guard to **reject**: "multi-integration command
workflow sequencing beneath an arbitrary `src/adapters/` path". Implementing SC3 now would make the
canonical tree fail its own guard, and SC5 ("the complete canonical production tree passes the
responsibility-ownership guard with zero allowlist exceptions") would be unsatisfiable — unless the
guard were weakened with exactly the allowlist, grandfather list, or path-only bypass that the
mission's Restricted Areas and Out of Scope sections forbid.

**(c) The named-rule set would encode the prerequisite debt.** SC2 replaces the blanket
adapter-to-adapter permission with named package-level rules. A scan of every resolved cross-adapter
import edge in `src/adapters/` yields **71 distinct package-to-package edges**. The largest fan-out
belongs to the command tree that TASK-2332.15 removes: `cli` alone depends on 14 other adapter
packages (`cli -> agents`, `assets`, `backlog`, `config`, `filesystem`, `forgejo`, `git`, `process`,
`rebase`, `review`, `sqlite`, `storage`, `verification`), and three packages depend back into it
(`mission -> cli`, `rebase -> cli`, `review -> cli`). Naming these as permitted rules today would
promote the pre-migration coupling into enforced guard configuration, then require deleting most of
it again after TASK-2332.15 — the opposite of the "regression-resistant proof" this mission exists to
create.

The mission's own Risks section states the same condition: *"Assumption: TASK-2332.15 has completed
before implementation starts; if command workflows remain under adapters, strict enforcement will
conflate prerequisite debt with this mission's changes."*

### 5. Work that is ready to resume once TASK-2332.15 lands

The inspection produced the design inputs, so resumption does not need to repeat CP 1:

- **Classifier seam:** generalize `findCompositionViolations`
  (`src/adapters/architecture/boundary-guards.ts:137`) into a content-aware responsibility classifier;
  keep path-derived layer as an input, not the verdict.
- **SC1 enumeration:** add a production-module scan that walks all six roots for `.ts`/`.tsx`,
  excludes `src/package.json` and `README.md`, and fails with module path plus expected owner when a
  module has no classification — replacing the silent skip at
  `src/adapters/architecture/boundary-guards.ts:95`.
- **SC2 rule table:** replace `src/adapters/architecture/boundary-guards.ts:25` with a named
  package-edge table plus application-owned ports; re-derive the edge inventory after re-homing,
  since the 14 `cli -> *` and 3 `* -> cli` edges above are expected to disappear.
- **SC3/SC4 fixtures:** four hermetic `withFixture`-style cases in `test/dependency-graph.test.ts`
  following `test/dependency-graph.test.ts:9`.
- **SC7 documentation:** `src/adapters/README.md` must gain the layer DAG and responsibility rules,
  and its `src/adapters/README.md:27` debt paragraph must be replaced rather than preserved.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC1 — every production module classified; guard fails with path and expected owner when unclassified | Not implemented. `classifyDependencyLayer` classifies by directory only (`src/adapters/architecture/boundary-guards.ts:80`) and unclassified sources are silently skipped at `src/adapters/architecture/boundary-guards.ts:95`; no enumeration test exists in `test/dependency-graph.test.ts` | Blocked — not started (prerequisite) |
| SC2 — cross-adapter imports need a named package rule or application-owned port; no blanket permission | Blanket permission still present at `src/adapters/architecture/boundary-guards.ts:25` and asserted verbatim by `"dependency graph validates adapters layer imports without unallowlisted violations"` (`test/dependency-graph.test.ts:41`). Inventory measured: 71 cross-adapter package edges, of which 17 involve the `cli` package that TASK-2332.15 re-homes | Blocked — naming rules now would encode prerequisite debt |
| SC3 — fixture placing multi-integration command sequencing under an arbitrary `src/adapters/` path fails, naming adapter as wrong owner | Real production instance already present: `src/adapters/cli/commands/integrate.ts:5`–`src/adapters/cli/commands/integrate.ts:20` sequences git, Backlog, Forgejo, agents, verification and review persistence; documented as debt at `src/adapters/README.md:27` | Blocked — canonical tree would fail its own guard |
| SC4 — mutation coverage for prohibited direct import, hidden service-location, adapter-owned sequencing, unclassified module | None of the four exist. Existing negative coverage is only two layer-pair cases: `"dependency graph rejects an interface import of a canonical composition module"` (`test/dependency-graph.test.ts:62`) and `"dependency graph rejects a forbidden unallowlisted application-to-adapter edge immediately"` (`test/dependency-graph.test.ts:69`). Service-location detection seam exists at `src/adapters/architecture/boundary-guards.ts:145` | Blocked — not started (prerequisite) |
| SC5 — complete canonical tree passes with zero allowlist exceptions; all six ownerships exercised | Today's pass is vacuous: `"dependency graph production scan has no violation outside the owned allowlist"` (`test/dependency-graph.test.ts:87`) succeeds only because of the blanket edge at `src/adapters/architecture/boundary-guards.ts:25`. Under SC3 rules the tree fails via `src/adapters/cli/commands/integrate.ts`, and clearing it would require the exceptions the mission forbids | Blocked — unsatisfiable before TASK-2332.15 |
| SC6 — diagnostics name offending file, failed responsibility rule, expected owner | `DependencyViolation` (`src/adapters/architecture/boundary-guards.ts:31`) carries source, target, layers and specifier but no failed-rule or expected-owner field; `findCompositionViolations` (`src/adapters/architecture/boundary-guards.ts:137`) returns bare file paths | Blocked — not started (prerequisite) |
| SC7 — `src/adapters/README.md` documents layer DAG, six responsibilities, cross-adapter constraints, named failing fixtures | Current README documents a directory table and the outstanding debt paragraph only (`src/adapters/README.md:25`, `src/adapters/README.md:27`); no DAG, no responsibility categories, no fixture references. Rewriting it now would document rules the tree cannot satisfy | Blocked — deferred with guard work |
| SC8 — `./scripts/verify-local.sh all` passes after guard, tests and docs are complete | Not run. No guard, test, or documentation change was made in this checkpoint, so the gate has nothing new to verify; `./scripts/verify-local.sh all` is deferred to the checkpoint that lands the guard | Blocked — deferred, no change to verify |

Falsifiability vocabulary and the "no grandfather list" constraint follow `ADR 0039`; the six layer
roots and the UI-neutral application boundary follow `ADR 0051`.

Next action: Report the TASK-2332.15 prerequisite blocker to the operator and hold this mission
until that task reaches a completed status with `src/adapters/cli/commands/` re-homed; on resumption,
re-run the 71-edge cross-adapter inventory against the re-homed tree and begin CP 2 by replacing the
blanket permission at `src/adapters/architecture/boundary-guards.ts:25` with the named package-rule
table and adding the unclassified-module scan that supersedes the silent skip at
`src/adapters/architecture/boundary-guards.ts:95`.
