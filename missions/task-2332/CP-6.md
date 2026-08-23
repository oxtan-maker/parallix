# CP-6: TASK-2332.06 — Remove migration scaffold and certify the architecture

## Summary

Final checkpoint of the post-2322 ports-and-adapters cleanup. TASK-2332.01 through
TASK-2332.06 are integrated in order (CP-1 … CP-5). This checkpoint removed the
residual migration commentary the sequence left behind, made documentation/graph
agreement executable rather than a review-time claim, and ran the mission's
certification gates.

Work done in this checkpoint:

- Added `no production module names a retired migration scaffold` to
  `test/dependency-graph.test.ts`. It scans every `.ts`/`.tsx` file under the six
  canonical layer roots for `LegacyActiveAdapter`, `ActivePort`, and `src/platform`.
  It caught one live leftover, now fixed: `src/application/ports.ts` still carried
  the migration note "*Mechanism ports for the execute workflow (architecture
  migration). They replace the legacy phase-named `ActivePort`*". That comment now
  describes what the ports are (workspace, agent execution, telemetry, handoff
  review) rather than what they replaced.
- Removed the dangling migration marker in `src/adapters/README.md`, which still
  claimed the adapter re-homing was "tracked by parent TASK-2332" — the parent
  sequence being certified here. The paragraph now describes the retired fan-out
  rule and the conditions for adopting a structural replacement, without pointing
  at an open migration.
- Added `ADR 0051 names every canonical layer root the graph enforces` — every
  entry in `layerRoots` (`src/adapters/architecture/boundary-guards.ts`) must be
  named by `docs/adr/0051-ui-neutral-application-boundary.md`, so the ADR cannot
  fall behind a layer the guard enforces.
- Added `no architecture document describes a layer the graph does not enforce` —
  the reverse direction, across ADR 0051 and the four directory READMEs
  (`src/adapters/`, `src/composition/`, `src/interfaces/`, `src/entry/`), so a doc
  cannot resurrect a retired tree such as `src/platform/` in prose.

### Review-history compatibility backfill

This branch also restores persisted review conversation history for pre-cutover
missions. `readExportedReviewEvents` imports the existing exported Markdown into
the authoritative Review aggregate only through the explicit backfill path; normal
readers remain SQLite-only. `parseResolutionDispositions` preserves fixes and
pushbacks from legacy resolution artifacts in the status projection.

| Behavior | Evidence | Status |
|---|---|---|
| Legacy Markdown resolution sections project fixes and pushbacks | `parseResolutionDispositions reads Markdown section lists and skips (none)` in `test/task-2332-status-review-history.test.ts` | PASS |
| Post-cutover review conversation is backfilled without `review-state.json` | `restores the conversation for a post-cutover mission that has no review-state.json` in `test/domain-review-workflow-state.test.ts` | PASS |

### Retained cutover importer

`MissionCompatibilityImporter` remains as the audited one-way cutover tool from
TASK-2322.04. It has no production caller after the completed import gate and is
not a runtime fallback. Its removal needs a dedicated migration/schema retirement
because its tested contract and provenance tables remain; TASK-2405 tracks that
work. This checkpoint therefore certifies removal of TASK-2332 transition
scaffolding, not deletion of every historical cutover adapter.

### Dependency-graph exception status

The 2322/2332 migration allowlist is empty. The whole-tree scan
(`dependency graph production scan has no violation outside the owned allowlist`)
passes against `productionDependencyExceptions`, which holds exactly one entry:

| Source | Target | Owner | Removal |
|---|---|---|---|
| `src/application/handoff-command-use-case.ts` | `src/adapters/review/review-static-evidence.ts` | `TASK-2369.13` | `missions/task-2369.13`, `backlog/tasks/task-2369.13 - Dedup-goal-check-evidence-handoff-and-review.md` |

This entry is **not** a 2322-migration exception and is not scaffolding this
mission introduced or is scheduled to remove: it was added by the TASK-2369 wave
after the TASK-2332 sequence had integrated (`git log -S"TASK-2369.13" -- src/adapters/architecture/boundary-guards.ts`
shows commit `b8e2eba1c`, `mission/task-2369.13`). It is fully attributed and its
attribution is now itself guarded — see
`every owned dependency exception names a task ID and an existing removal mission`
and `every owned dependency exception still describes a live application-to-adapter edge`
(CP-1). Removing the edge is the accepted scope of the open TASK-2369.13 mission;
doing it here would duplicate that mission's work and change production code
outside this mission's acceptance criteria.

### Final integrated graph

`allowedDependencyGraph` in `src/adapters/architecture/boundary-guards.ts`, enforced
across all six layers, matching ADR 0051's "Canonical layer homes":

| Layer | Permitted targets |
|---|---|
| domain | domain |
| application | domain, application |
| adapters | domain, application (cross-adapter only via named `adapterPackageDependencies` / `adapterPortDependencies` rules) |
| interfaces | domain, application, interfaces |
| composition | domain, application, adapters, interfaces, composition |
| entry | composition, interfaces |

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| All six child missions are integrated in order, after TASK-2322.12 | `missions/task-2332/CP-1.md` … `missions/task-2332/CP-5.md` and this document, one per child in sequence; child tasks completed in order per `ls backlog/completed` (`task-2332.01` … `task-2332.06`) | PASS |
| TASK-2332.01 provides executable import-boundary validation with every allowlist entry named and justified | `dependency graph production scan has no violation outside the owned allowlist`, `every owned dependency exception names a task ID and an existing removal mission`, `every owned dependency exception still describes a live application-to-adapter edge` in `test/dependency-graph.test.ts`, per `ADR 0051` | PASS |
| TASK-2332.02 establishes one production composition root with no adapter→composition import | `composition guard accepts the sole production composition root` in `test/application-boundaries.test.ts`; `dependency graph rejects an adapter import of a canonical composition module` in `test/dependency-graph.test.ts` | PASS |
| TASK-2332.03 places application ports in capability-organized owning-layer modules | `every application port module is a capability module that declares contracts`, `application ports name no storage mechanism in their declarations`, `application ports import no adapter and no storage runtime` in `test/dependency-graph.test.ts`; adapters conform per `implements the six application-owned capability contracts` in `test/sqlite-ports-cp2.test.ts` | PASS |
| TASK-2332.04 replaces `LegacyActiveAdapter` with `ExecuteMission`, characterization green | `execute workflow: success runs preflight, prepare, launch, record, telemetry, handoff in order` and 16 further cases in `test/execute-mission-characterization.test.ts`; `execute mission use case sequences workspace, agent, lifecycle, telemetry, then handoff` in `test/execute-mission-service.test.ts`; scaffold absence guarded by `no production module names a retired migration scaffold` in `test/dependency-graph.test.ts` | PASS |
| TASK-2332.05 routes CLI and TUI through one canonical command-dispatch path | `CLI active command dispatches through BoardCommandController` and `TUI dispatches through same BoardCommandController type` in `test/command-dispatch-convergence.test.ts`; `production composition delivers a board controller that publishes to the wired recorder` in `test/task-2387-board-current-work.test.ts` verifies the TUI progress sink | PASS |
| TASK-2332.06 removes migration scaffolding and deferred migration commentary | `no production module names a retired migration scaffold` in `test/dependency-graph.test.ts` (which caught and now prevents the `ActivePort` migration note in `src/application/ports.ts`); the TASK-2332 tracking marker is gone from `src/adapters/README.md` | PASS |
| No TASK-2332 compatibility façade or retired runtime tree remains | `repository has no retired src/platform paths` and `platform-path guard rejects a production legacy directory even without an import edge` in `test/dependency-graph.test.ts`; `production tree has no unclassified module`; `CLI interface parsing and rendering exports preserve each command contract` in `test/cli-interface-migration.test.ts` shows `src/interfaces/cli/` owns real contracts rather than transitional re-exports. The retained TASK-2322 importer is tracked by TASK-2405. | PASS |
| Architecture documentation and the executable graph agree | `ADR 0051 names every canonical layer root the graph enforces` and `no architecture document describes a layer the graph does not enforce` in `test/dependency-graph.test.ts`, covering `ADR 0051`, `src/adapters/README.md`, `src/composition/README.md`, `src/interfaces/README.md`, `src/entry/README.md` | PASS |
| Zero migration exceptions remain in the dependency graph | `dependency graph production scan has no violation outside the owned allowlist` in `test/dependency-graph.test.ts`; `productionDependencyExceptions` holds no 2322/2332 entry — its single entry is owned by the open `TASK-2369.13` (see table above) | PASS |
| Persistence and authority boundaries are unchanged by the cleanup | `authority map covers all operator-local domains` and `authority map: every field maps to exactly one authority owner` in `test/sqlite-ports-cp2.test.ts`, per `ADR 0053` | PASS |
| Architecture guard suite green | `npx tsx --test test/dependency-graph.test.ts` — 37 tests, 37 pass, 0 fail | PASS |
| Static-analysis gate passes on the final tree | `./scripts/verify-local.sh static-analysis` — ESLint, tsc typecheck, test-hygiene, and test typecheck all report clean | PASS |
| Full verification suite passes on the final tree | `./scripts/verify-local.sh all` — 2052 tests, 2052 pass, 0 fail, 0 skipped (exit 0) | PASS |

Next action: Hand off task-2332 for review — both mission-declared gates
(`./scripts/verify-local.sh static-analysis` and `./scripts/verify-local.sh all`)
are green on the committed tree and all six checkpoint documents are committed;
no further child mission remains in the TASK-2332 sequence.
