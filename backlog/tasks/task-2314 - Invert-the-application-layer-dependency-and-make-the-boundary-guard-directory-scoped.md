---
id: TASK-2314
title: >-
  Invert the application-layer dependency and make the boundary guard
  directory-scoped
status: ready-for-integration
assignee: [custom]
created_date: '2026-07-26 19:21'
updated_date: '2026-07-26 19:35'
labels:
  - user_value
  - architecture
  - refactor
  - boundary
dependencies:
  - TASK-2285
references:
  - docs/adr/0051-ui-neutral-application-boundary.md
  - docs/adr/0044-workflow-distribution-model.md
documentation:
  - docs/adr/0051-ui-neutral-application-boundary.md
modified_files:
  - src/application
  - src/adapters/legacy
  - src/adapters/backlog
  - src/platform/runtime/lib/application
  - src/platform/runtime/lib/adapters
  - src/platform/runtime/lib/composition
  - src/platform/runtime/lib/architecture/boundary-guards.ts
  - src/platform/runtime/lib/commands/stats-backfill.ts
  - scripts/build-canonical-bundle.js
  - test/application-boundaries.test.ts
  - test/application-contracts.test.ts
  - test/application-services.test.ts
  - test/legacy-active-adapter.test.ts
  - docs/adr/0051-ui-neutral-application-boundary.md
priority: high
ordinal: 67000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
ADR 0051 sets the intended dependency direction: interfaces call application use cases, adapters implement effects. The repository currently runs that arrow backwards at the layer boundary.

There are two application layers. The canonical one is `src/application/` (18 files). A second one lives inside the legacy tree at `src/platform/runtime/lib/application/` (4 files, 163 LOC: `contracts.ts`, `ports.ts`, `active-service.ts`, `stats-backfill-service.ts`) and owns the shared vocabulary — `ApplicationOutcome`, `Capability`, `DurableEvidence`, `ProgressEvent`, `SourceFact`, `ActivePort`, `ProgressPort`, `ActiveService`, `StatsBackfillService`.

Nine import sites in `src/application/` and `src/adapters/` reach *into* the legacy tree for those symbols (`board-command.ts`, `board-controller.ts`, `board.ts`, `board-readers.ts`, `concrete-mission-read-adapter.ts`, plus the forwarding shims `src/application/services/index.ts` and `src/adapters/legacy/index.ts`, which are two-line re-exports and the whole content of `src/adapters/legacy/`). The effect is that every file written in the target layout is anchored to the tree that is supposed to disappear, so each new wave of migration work adds back-references instead of removing them. TASK-2278 and TASK-2290 established the boundary; this task makes the boundary's own vocabulary live on the correct side of it.

The second half is the guard that is supposed to prevent this. `findForbiddenApplicationDependencies` (`src/platform/runtime/lib/architecture/boundary-guards.ts`) is sound, but `test/application-boundaries.test.ts` invokes it against a hardcoded list of nine entry-point paths. `src/application/` holds 18 files, so roughly eleven — including `board-command.ts`, `board-controller.ts`, `board-readers.ts`, `metrics.ts`, `board-event-recorder.ts`, `create-board-projection-builder.ts` — are unguarded, and a new file in the layer is unguarded by default until someone remembers the array. Compare `test/domain-import-boundary.test.ts`, which walks `src/domain` and checks every file; the strong guard is on the 1.1k-LOC layer that is already clean, and the weak one is on the layer under active migration.

The guard's forbidden-token list also contains the bare string `sqlite`, while `src/adapters/sqlite/` is a legitimate 2.3k-LOC adapter. That rule holds today only because the allowlist never points at anything reaching it — a latent false positive that a directory-scoped guard would trip immediately.

Scope note: this task deliberately does not flatten `src/platform/runtime/lib/` or touch the CommonJS `dist/` emitter. Removing that emitter is owned by TASK-2288 (blocked on TASK-2284/2285/2287), and flattening before it lands would multiply the string-replacement path surgery in `scripts/build-canonical-bundle.js`. Both are cheaper after this arrow is corrected.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 The four application modules currently under src/platform/runtime/lib/application have exactly one home in the canonical application layer, and no file under src/application or src/adapters imports from src/platform/runtime/lib/application
- [ ] #2 Remaining legacy consumers (legacy-active-adapter, legacy-stats-backfill-adapter, composition/application-services, commands/stats-backfill) import the application layer from its canonical home, so the dependency arrow points from the legacy tree toward the application layer and not the reverse
- [ ] #3 The forwarding-only modules src/application/services/index.ts and src/adapters/legacy/index.ts are removed and their consumers import the real modules, or each is retained with a documented reason that is not 'it looks populated'
- [ ] #4 The application boundary guard evaluates every file under the canonical application layer by directory walk, not by a hardcoded entry list; a newly added file that violates the rules fails the suite without any edit to the test
- [ ] #5 The guard no longer flags the legitimate src/adapters/sqlite adapter: the forbidden-dependency rule distinguishes the node:sqlite builtin from a repository adapter directory, and a fixture proves both the accept and the reject case
- [ ] #6 px active and px stats-backfill retain their existing behavior, including the ADR 0051 invariants: status/assignee restoration on failed launch, transitionTask ordering, stats-backfill producing its projection before any write, and active having no JSON contract
- [ ] #7 The canonical esbuild bundle and the transitional CommonJS rollback tree both build, and the package-content audit and reproducible-dist gates pass
- [ ] #8 Tests that load the relocated modules through dist paths are updated, and the default suite is green with no reduction in the number of executed tests
- [ ] #9 ADR 0051 is amended in place to record the corrected dependency direction, without appending superseding or dated-history clauses
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Readiness / sequencing (verified against main @ f5bb550e3 on 2026-07-26):

SATISFIED prerequisites (not encoded as dependencies because completed tasks cannot be referenced, and they add no scheduling signal) — TASK-2278 established the UI-neutral application boundary and the contracts/ports vocabulary this task relocates; TASK-2290 delegated the first CLI slices through it. Both are done, so the target shape is already agreed and exercised. Nothing about the design needs re-deciding before starting.

BLOCKING — TASK-2285 is active with a live worktree (mission/task-2285 @ 6ea8043d7) whose diff against main changes scripts/build-canonical-bundle.js by +44 lines plus package.json. This task must also edit that script's emit-tree list, because relocating the application modules changes which trees are emitted as CJS versus ESM. Two concurrent missions editing that file will conflict in exactly the region both need. Start once TASK-2285 integrates. Note this is serialization on a shared file, not a functional dependency: nothing TASK-2285 produces is consumed here, so if TASK-2285 is abandoned or descoped away from the build script, this task is immediately startable.

NOT a blocker, deliberately — TASK-2288 (retire transitional CommonJS) runs the other way: it gets cheaper once this arrow is corrected. The current double emit of lib/ (83 files as CJS at dist/lib/, the same 83 again as ESM at dist/platform/runtime/lib/) plus four brittle string .replace() path repairs in the build script are what make the emit list fragile. Do not wait for TASK-2288; prefer running this first.

WATCH, not a dependency — TASK-2307 (Ink TUI wave 5) has a worktree (mission/task-2307 @ 49c3072dc), but its diff so far only adds new files under src/interfaces/tui/ with their tests, and does not touch src/application/controller. If that wave grows to route guarded actions through board-command.ts or board-controller.ts before this task starts, re-check overlap: those two files are among the nine import sites rewritten here.
<!-- SECTION:NOTES:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 Verification gate ran and passed on the final tree with captured proof rather than an unverified claim
- [ ] #2 Lint and static analysis report clean on every changed file
- [ ] #3 No focused or unannotated skipped tests were introduced (no .only and no bare .skip)
- [ ] #4 Final checkpoint Goal Check table cites real evidence using file:line references and test names
- [ ] #5 Docs updated to reflect any workflow or user-facing behavior change
- [ ] #6 Bug-labeled missions include a red-to-green reproduction test that fails before the fix and passes after
- [ ] #7 A grep for 'platform/runtime/lib/application' across src returns no results outside the legacy tree itself
<!-- DOD:END -->
