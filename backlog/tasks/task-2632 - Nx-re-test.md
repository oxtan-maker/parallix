---
id: TASK-2632
title: Nx re-test
status: backlog
assignee: []
created_date: '2026-10-02 08:45'
labels: []
dependencies: []
ordinal: 153008
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Continue ADR 0063 with a bounded feature-scoped Nx experiment.

The previous trial established that Nx caching and same-input
cross-worktree restoration work. It rejected the tested coarse targets;
it did not evaluate useful reuse between different mission candidates.

Keep direct verification authoritative. Leave the broader adoption
decision at "pending data for decision" while this experiment runs.
Preserve the previous measurements and negative findings.

1. Freeze execution semantics.

Use the existing node:test runner, per-file process isolation,
disposable homes, CPU guards, wall-clock watchdog, cleanup, and
coverage implementation.

Do not introduce a shared-process runner, switch test frameworks,
retune CPU budgets, or rewrite production code in this experiment.

2. Follow Nx's feature-based testing model.

Read the official Nx guides on feature-based testing, project
configuration, inputs, and the project graph.

A dedicated node:test plugin is not required to cache commands.
Do not stop because no plugin automatically computes each test
file's complete dependency closure.

3. Model a small, meaningful set of real boundaries.

Use existing Nx source/dependency analysis, project.json metadata,
and ordinary command targets.

Choose CPU-significant groups from both unit and integration-ci.
Do not evaluate only trivial domain tests or leave all integration-ci
work outside the caching experiment.

Production source files must not be moved or rewritten.
Bounded test-only grouping is permitted when needed to establish
clear project ownership; preserve tier classification and every
required test. Do not create a competing test-membership registry.

If useful boundaries cannot be expressed within these constraints,
record the exact obstacle and the smallest necessary scope change.

4. Inspect before benchmarking.

Export the actual Nx project graph and effective target configurations.
Identify the source files responsible for broad dependency edges.

Check root-wide globs, targetDefaults overrides, shared bootstraps,
version/bookkeeping inputs, and accidental dependencies on the
whole canonical bundle.

Do not replace verified dependencies with a filename heuristic or
a custom dependency-analysis engine.

5. Prove selective invalidation on clean commits.

After populating the cache:
- Change component A: its relevant tests execute; unrelated B hits.
- Change a transitive dependency: every dependent group invalidates.
- Change a fixture or common bootstrap: affected groups invalidate.
- Add a test: it is discovered, assigned once, and executed.
- Introduce a failure: it fails through the actual guarded runner.
- Repeat in another clean worktree: matching results and artifacts
  restore without contamination.

A relevant comment change causing a miss is expected for content
hashing. The important test is an unrelated component change.

6. Preserve complete coverage artifacts.

Each target owns distinct outputs.
Determine whether the coverage command reads the whole source tree
to construct its denominator; include that dependency or implement
a verified component-fragment/current-candidate aggregation boundary.

Do not cache a whole-repository report under a narrower runtime-only
input key. Preserve original-source mapping, uncovered-source
accounting, and all existing coverage obligations.

Initially request every required target and let Nx choose hits/misses.
Do not use affected-only execution to leave required artifacts absent.

7. Measure the actual adoption question.

First demonstrate useful invalidation with a small correctness probe.
Then replay the predeclared representative ten candidate revisions.

Compare equivalent direct, Nx cache-bypassed, and Nx cache-enabled
obligations with unchanged execution semantics. Include initial
population, all child CPU, graph/hash/restore overhead, uncached gates,
and cache misses caused by real changes.

Retain the >=50% total local verification CPU reduction criterion
and the existing throughput/latency safeguards. Do not credit
unrelated runner optimizations to Nx.

8. Handle dependency security explicitly.

Keep the audit gate. Check whether an upstream update or a
compatibility-tested scoped override resolves the actual advisories.
Do not suppress findings or assume a newer dependency is compatible.

Report separately:
- Does the feature-scoped Nx configuration work correctly?
- Does it preserve verification and coverage?
- Does it meet the total-CPU target?
- Is the migration/configuration burden acceptable?

A negative result remains valid, but it must describe the tested
feature-scoped model rather than repeat the known monolithic result.
<!-- SECTION:DESCRIPTION:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 Verification gate ran and passed on the final tree with captured proof rather than an unverified claim
- [ ] #2 Lint and static analysis report clean on every changed file
- [ ] #3 No focused or unannotated skipped tests were introduced (no .only and no bare .skip)
- [ ] #4 Final checkpoint Goal Check table cites real evidence using file:line references and test names
- [ ] #5 Docs updated to reflect any workflow or user-facing behavior change
- [ ] #6 Bug-labeled missions include a red-to-green reproduction test that fails before the fix and passes after
<!-- DOD:END -->
