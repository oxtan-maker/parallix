---
id: TASK-2638
title: Organize tests by level and mirror src in the unit-test tree
status: backlog
assignee: []
created_date: '2026-10-03 14:18'
labels: []
dependencies: []
ordinal: 156008
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Reorganize Parallix’s tests into a central tree that makes test level and
ownership immediately visible:

- `test/unit/`: unit tests, with directories mirroring `src/`.
- `test/integration/`: integration tests, organized by boundary or subsystem.
- `test/e2e/`: end-to-end workflows, organized by public entry point or workflow.

Make this an enforced repository convention, not a cosmetic folder move.

Preserve existing behavioral assertions, required verification obligations,
CI/local eligibility, coverage semantics, execution-group isolation, and
performance safeguards.

This mission changes test organization and the tooling necessary to support it.
It does not redesign production code, replace the runner, or reopen the
build-system/caching decision.

## 1. Start from the actual integrated state

Read `AGENTS.md`, the current test guidance, and ADRs 0057, 0062, and 0063.
Read `docs/doc-standards.md` before changing documentation.

Inspect the actual checkout and current test-refactoring work before planning
moves. Public GitHub history may lag local work. Do not recreate tests already
consolidated or deleted by earlier missions.

Identify the current ownership and consumers of:

- Test discovery, category registration, and execution planning.
- Unit shared/isolated execution groups and their screening rules.
- Coverage selection, reporting, and merging.
- Package scripts, focused-test commands, and dedicated lifecycle/agent checks.
- Repository-owned pre-integration gates and hosted CI workflows.
- Test-layout, file-size, architecture, and fixture-isolation checks.

Starting points include `test/lib/test-tier-selection.ts`,
`test/lib/test-categories.ts`, `test/lib/test-run-plan.ts`,
`test/run-default-tests.ts`, and `package.json`; follow renamed equivalents.

Use `workflow.config.json`’s configured pre-integration gates as the authority
for `px integrate`. Do not substitute the standalone integration-script plan
merely because it contains similarly named checks.

Coordinate the directory cutover with overlapping test-refactoring missions.
Do not run competing repository-wide move sweeps.

## 2. Required directory and naming convention

### Unit tests: mirror production directories

For code under `src/`, remove the `src/` prefix and preserve the remaining
directory hierarchy under `test/unit/`.

Illustrative mappings:

    src/domain/missions/lifecycle.ts
    test/unit/domain/missions/lifecycle.test.ts

    src/application/review/recovery-policy.ts
    test/unit/application/review/recovery-policy.test.ts

    src/adapters/sqlite/error-mapping.ts
    test/unit/adapters/sqlite/error-mapping.test.ts

Use the real source paths in this checkout; these examples do not authorize
creating or moving production modules.

Rules:

1. The directory mapping is mandatory. Do not introduce an extra
   `test/unit/src/` level, flatten production paths, or create unit-only
   subsystem directories that have no corresponding source directory.
2. Prefer `<module>.test.ts` for a module-owned suite. A cohesive behavior
   suffix, such as `<module>.validation.test.ts`, is allowed when useful.
   Preserve applicable existing language extensions.
3. Directory mirroring does not require one test file per production file,
   class, or function. Do not create empty suites or split cohesive suites
   solely to obtain a one-to-one file count.
4. A genuine multi-module unit contract belongs at its owning source directory,
   or the nearest existing common source directory when no narrower owner
   exists. Give it a contract-oriented name and state its ownership briefly.
5. Use module/behavior names for migrated task-numbered suites. Retain task IDs
   in case names or comments where useful, not as the organizing principle.
6. Extend existing owning suites where appropriate. Do not undo consolidation
   or merge unrelated contracts into oversized files.

Only create mirrored directories that contain tests. This mission does not
require scaffolding the entire source tree.

### Tests of code outside src

Do not fabricate a `src/` owner for build scripts, verification tooling, or
other code that genuinely lives elsewhere.

Reserve `test/unit/_repo/` for these cases, preserving the repository-relative
directory of the actual owner:

    scripts/coverage-merge.ts
    test/unit/_repo/scripts/coverage-merge.test.ts

    test/lib/test-tier-selection.ts
    test/unit/_repo/test/lib/test-tier-selection.test.ts

Apply the same rule to existing non-src application roots, such as `web/`,
only where they actually exist and own the tested behavior.

Repository-wide structural checks with no individual code owner may live in
`test/unit/_repo/repository/`, provided they qualify as units under the existing
verification policy.

Document this small exception explicitly. `_repo/` must not become a dumping
ground for tests whose owner lives under `src/`. Do not build an ownership
registry containing every unit-test filename.

### Integration and E2E tests

Organize integration tests by the boundary or subsystem they verify, for example:

    test/integration/sqlite/
    test/integration/git/
    test/integration/cli/
    test/integration/verification/

Organize E2E tests by public entry point or workflow, for example:

    test/e2e/cli/
    test/e2e/lifecycle/
    test/e2e/agents/

Use only meaningful directories justified by the actual suites. Integration
and E2E directories do not need to mirror individual production modules.

Keep runner infrastructure and shared fixtures outside runnable suite roots
where practical. Retain existing `test/lib/`, bootstrap files, and
`test/fixtures/` unless a specific move is necessary. Do not turn this mission
into a wholesale fixture-library rewrite.

## 3. Separate test level from execution eligibility

The physical path declares the test level. The existing category/selection
authority declares execution eligibility and special requirements.

Use these repository definitions:

**Unit:** bounded in-process behavior, with doubles at external boundaries,
consistent with ADR 0057. Preserve its existing allowance for isolated temporary
state; do not introduce a blanket new filesystem prohibition.

**Integration:** real component composition or an actual adapter boundary,
such as SQLite, Git, child processes, packaging, sockets, or renderer integration.

**E2E:** a representative workflow driven through the application's public
entry point and relevant production wiring. State which external dependencies
are real and which are substituted.

Do not classify by duration, filename history, or whether the test uses mocks
somewhere. A temporary database is still a real database boundary.

Preserve the existing execution lanes and dedicated checks. Do not create a
new verification tier merely because `test/e2e/` now exists.

In particular:

- CI-safe boundary tests remain positively registered.
- Local-only tests retain their explicit unavailable-dependency reasons.
- Real-agent tests retain their agent/model requirements.
- Dedicated lifecycle and agent commands retain their required gate positions.
- A deterministic E2E workflow may retain an existing integration-CI execution
  assignment. An `e2e/` path does not automatically make it agent-dependent
  or remove it from its previous gate.

Every suite must have one level and explicit, validated execution ownership.
Composite commands may combine populations, but must not accidentally run a
file twice within one execution plan.

Preserve the complete existing full-integration command population, including
tests moved to `e2e/` that previously belonged to that population.

## 4. Capture the migration baseline before moving files

Record the actual starting revision and obtain an inventory from the existing
discovery and gate machinery.

Capture each runnable suite's:

- Original path and owning module, contract, or boundary.
- Execution lane and dedicated gate membership.
- Shared/isolated execution assignment where applicable.
- Special bootstrap, artifact, environment, or workstation requirements.

Separately audit test sources against discovery so already-undiscovered files
do not disappear from consideration.

Create an old-to-new migration map. For splits, identify the retained case
groups and their destinations. Treat existing discovery gaps as explicit
findings, not permission to delete or silently ignore those files.

Preserve this as mission evidence using the repository's supported workflow.
Do not add permanent test inventories to live documentation or introduce a
second runtime manifest just to retain migration history.

Use exact-revision existing execution evidence where suitable. Do not repeatedly
run all gates merely to generate inventory or intermediate progress reports.

## 5. Replace implicit level classification with validated discovery

Evolve the existing selector rather than building a parallel discovery system.

Discover runnable suites recursively beneath the three canonical level roots.
Keep the repository's supported test-file extensions.

Use normalized repository-relative paths as identifiers. Never identify a suite
by basename alone: two different modules may legitimately have `index.test.ts`.

Remove obsolete mechanisms used to infer UNIT/INTEGRATION LEVEL, including:

- Root-only discovery and special handling for selected subdirectories.
- Source-content boundary heuristics that decide test level.
- The redundant known-integration filename set.
- Exact-filename exclusions used only to keep E2E tests out of unit discovery.

Do not remove unrelated source analysis, shared-process screening, runtime
isolation protections, or security checks merely because they also use patterns.

Retain one authoritative category/selection implementation. Coverage, normal
execution, focused selection, and gate planning must use it rather than maintain
independent file lists or competing globs.

Dedicated E2E entry points may retain their existing launch mechanics, but their
paths and membership must be validated against the same catalog.

Add an enforced layout/registration validation step that fails clearly for:

- Runnable test sources outside approved level roots.
- Invalid unit-directory mirroring or misuse of `_repo/`.
- Missing files referenced by category or execution-group registrations.
- Unclassified boundary suites, overlapping lane registrations, or missing
  required local-dependency reasons.
- Invalid path references, duplicate canonical entries, and unsupported routing.
- Explicit focused selectors matching nothing, or an unexpectedly empty
  required population.

Run validation in mandatory verification paths, not only as an optional command.

Discovery must not import test modules, execute fixture setup, scan generated
worktree copies, or collect dependency/build/coverage output. Distinguish
intentional fixture test programs from runnable repository suites explicitly;
do not silently ignore arbitrary new test locations.

Include newly authored test sources, not only already-committed files.

## 6. Migrate suites without rewriting their meaning

Migrate all applicable repository suites, not just representative examples.

Prefer mechanical moves and path corrections. Preserve assertion intent,
inputs, failure cases, cleanup, and meaningful test identities.

Split files that genuinely mix unit and integration/E2E case groups when this
can be done without changing their behavioral coverage. Do not mock away a
real boundary merely to move its tests into the unit tree.

Keep such splits separately understandable in the diff and migration evidence.
Do not combine the migration with broad assertion rewrites or duplicate-removal
work already owned by other missions.

Update every affected path consumer, including:

- Imports, dynamic imports, module-mock targets, fixtures, and snapshots.
- Repository-root resolution and file-relative resource access.
- Runner filters, focused commands, category entries, and execution groups.
- Bootstrap/preload paths, package scripts, CI, and configured gates.
- Architecture/file-size checks and any legitimate existing exception paths.
- Test-authoring guidance and active command examples.

Preserve the existing TypeScript/module-resolution convention. Do not introduce
new import aliases or change production packaging to make moved tests resolve.

Move snapshots where necessary without blindly regenerating their expected
content. Avoid accidental changes to working directory, artifact identity,
temporary-home isolation, or operator-state protection.

At completion, remove temporary compatibility discovery, forwarding suites,
duplicate copies, and legacy move-only exceptions.

Historical evidence may retain original paths. Active executable references
must resolve to the new paths.

## 7. Preserve execution cost, isolation, and coverage

Directory organization must not silently alter the execution model.

For mechanically moved unit suites, carry existing approved shared/isolated
assignments through the migration map. Do not accidentally treat every moved
file as a new unknown suite and push the entire shared population back into
per-file execution.

Equally, do not put additional suites into shared execution just because they
now share a directory.

Reassess genuinely split or behaviorally changed suites according to the current
screening policy. Preserve ordinary `npm test` isolation and the separately
configured local hybrid behavior unless the current integrated policy differs.

Retain CPU accounting, CPU budgets, headroom checks, concurrency policy, finite
wall watchdogs, cleanup, and missing-measurement failures. Do not confuse CPU
limits with elapsed-time limits or increase either to hide migration regressions.

Preserve the accepted native coverage implementation, source-map handling,
source denominator, inclusion of unloaded source files, exclusions, per-lane
fragments, and merge semantics.

Do not add a second test execution just to produce coverage. Keep covered runs
on the same authoritative selection path as ordinary runs.

Use normal required execution evidence to compare populations, execution groups,
normalized coverage file/line sets, and CPU consumption where comparable.
Investigate discrepancies rather than changing thresholds or exclusions.

Do not require byte-identical coverage hit counters as a substitute for checking
assertion and source coverage preservation. Explain observed attribution
differences with evidence; do not dismiss unexplained losses as noise.

## 8. Preserve fixture and boundary discipline

Unit suites must not acquire real infrastructure indirectly through a helper
import during relocation.

Reuse existing fixture ownership and isolation mechanisms. Keep pure helpers
and in-memory fakes distinguishable from helpers that initialize real databases,
repositories, processes, or services.

Where existing checks cannot enforce that distinction, extend the narrowest
appropriate boundary/import check and prove its relevant failure case.

Do not build a general dependency-analysis engine or claim that a source-text
regex proves transitive isolation.

Never import another runnable test file as a fixture helper. Preserve cleanup
on both successful and failing execution.

## 9. Required regression coverage

Extend the existing owning suites for discovery, categories, planning, coverage,
and isolation. Use synthetic test trees for pure planning tests and a bounded
real runner fixture for execution wiring.

Prove these scenarios:

1. Deeply nested suites under each level root are discovered exactly once;
   support files and intentional fixture programs are not executed as suites.

2. Two suites with the same basename in different directories remain distinct,
   and an exact focused path selects only the requested suite.

3. A valid mirrored unit path passes; an incorrect mirror fails with the
   offending path. Legitimate non-src ownership passes without weakening
   the rule for src-owned tests.

4. A test containing words such as `spawn`, `fetch`, or `git` in comments or
   strings does not change level. Real forbidden behavior remains subject
   to the separate isolation/boundary protections.

5. An unregistered boundary suite, dangling registration, conflicting lane,
   or missing local-dependency reason fails validation rather than vanishing
   or inheriting CI eligibility.

6. A workflow moved into `e2e/` retains its existing required execution
   assignment. Real-agent suites never enter ordinary unit or hosted lanes.

7. Ordinary and covered plans select the same intended population. Path moves
   do not accidentally change approved shared/isolated assignments.

8. The real runner executes a selected nested fixture and propagates a deliberate
   assertion failure. A no-match focused selection fails rather than returning
   a misleading green result.

Do not implement these as tests that merely search configuration source text
for expected strings. Assert selection results, validation errors, executed
fixtures, and process outcomes.

Classify subprocess-based regression tests as integration tests, not units.

## 10. Documentation and architectural decisions

Update the existing test-authoring guidance and the relevant part of ADR 0057
to record:

- The three physical test levels.
- Mandatory src-to-unit directory mirroring.
- The bounded non-src exception.
- The distinction between level, execution eligibility, and isolation grouping.
- How to locate an owning suite and run it through supported commands.

Remove contradictory active guidance about flat paths or inferred levels.

Keep ADR 0062/0063 decisions unchanged except for genuinely stale path references
or narrowly necessary clarification. Do not use this mission to rewrite their
coverage, isolation, performance, or caching decisions.

Do not duplicate executable suite inventories in documentation.

## 11. Checkpoints and verification

### Checkpoint 1: Baseline and ownership

Complete the current inventory, migration map, ownership decisions, dependency
review, and overlapping-work assessment.

Identify special suites and execution policies before changing their paths.

### Checkpoint 2: Discovery and validation

Implement recursive canonical discovery and fail-closed validation, with focused
regressions. Temporary migration compatibility may exist inside the mission,
but it must be removed before completion.

### Checkpoint 3: Complete migration

Move all applicable suites, update consumers, preserve special execution
assignments, and reconcile the inventory against the actual post-migration tree.

### Checkpoint 4: Evidence and cleanup

Run focused affected checks, including discovery/category/execution regressions
and representative moved suites at their appropriate levels.

Run `./scripts/verify-local.sh static-analysis`, the required documentation
checks, and other checks mandated by the current repository instructions.

Let Parallix run complete gates at their configured lifecycle points. Do not
duplicate full-suite runs during every checkpoint or substitute focused evidence
for a required authoritative gate.

Capture final gate results against the actual candidate revision. Unavailable
required environments are blocked verification, not successful tests.

Respect existing change-size and source-size policies. Do not expand exception
lists or weaken guards to accommodate this migration.

## Non-goals and prohibited shortcuts

No runner/framework migration, Nx adoption, test-result cache, affected-test
algorithm, compile-once redesign, runtime upgrade, or new dependency unless
separately authorized.

No production architecture changes just to make ownership or imports easier.

No blanket skips, `.only`, retries, timeout inflation, weakened assertions,
reduced coverage scope, or moving tests to a less frequently executed gate to
obtain a green result.

No misleading `misc/`, `legacy/`, task-number, or similarly unowned unit buckets.

No one-file-per-function explosion, giant merged suites for process-startup
savings, permanent dual layouts, or parallel membership authorities.

## Definition of Done
<!-- DOD:BEGIN -->
The mission is complete only when:

- All applicable runnable repository suites use the approved level tree, with
  no unexplained discovery gaps or unmigrated flat suites.
- Src-owned unit directories mirror src, and non-src exceptions are bounded
  and documented.
- Level classification comes from paths, while execution eligibility remains
  explicit and validated.
- Every original behavioral case group is accounted for. File/test-count
  changes caused by splits or new guard tests are explained.
- Required local, hosted, lifecycle, and real-agent obligations are preserved.
- Existing execution-group policies, isolation, coverage semantics, and
  performance safeguards remain intact.
- Active commands, imports, fixtures, snapshots, and gate references work with
  nested paths.
- Automated checks prevent layout and registration drift.
- Focused checks and the authoritative configured gates provide the required
  evidence, with no failed or unrun requirement represented as green.
- Temporary migration machinery and duplicate copies have been removed.

The final report must summarize actual before/after populations by level and
execution lane, migration completeness, any justified classification or
execution-group changes, verification results, and remaining blockers.

Do not claim a speedup unless it was measured under comparable conditions.
<!-- SECTION:DESCRIPTION:END -->

- [ ] #1 Verification gate ran and passed on the final tree with captured proof rather than an unverified claim
- [ ] #2 Lint and static analysis report clean on every changed file
- [ ] #3 No focused or unannotated skipped tests were introduced (no .only and no bare .skip)
- [ ] #4 Final checkpoint Goal Check table cites real evidence using file:line references and test names
- [ ] #5 Docs updated to reflect any workflow or user-facing behavior change
- [ ] #6 Bug-labeled missions include a red-to-green reproduction test that fails before the fix and passes after
<!-- DOD:END -->
