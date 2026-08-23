# CP-1: TASK-2332.01 — Codify the intended dependency graph

## Summary

TASK-2332.01 landed graph-based import-boundary validation for the ADR 0051 layer
model. This checkpoint verified that guard against the integrated tree and closed
the one gap that remained unverified by an executable assertion: the temporary
allowlist was not itself guarded, so an entry could lose its owner or go stale
without any test failing.

Work done in this checkpoint:

- Exported the production allowlist from `src/adapters/architecture/boundary-guards.ts`
  as `productionDependencyExceptions` (previously a module-private
  `PRODUCTION_EXCEPTIONS`) so the guard suite can assert on its contents.
- Added two guards to `test/dependency-graph.test.ts`:
  - `every owned dependency exception names a task ID and an existing removal mission`
    — each entry must carry an owning `TASK-<id>` and a `removalMission` path that
    exists on disk.
  - `every owned dependency exception still describes a live application-to-adapter edge`
    — each entry's `source` and `target` must still exist, and must classify as
    `application` and `adapters` respectively, so a stale entry cannot silently
    keep widening the graph after the files it named were moved or deleted.

Verified state of the ADR 0051 graph on this tree:

| Layer | Permitted targets |
|---|---|
| domain | domain |
| application | domain, application |
| adapters | domain, application (cross-adapter edges only via named package rules) |
| interfaces | domain, application, interfaces |
| composition | domain, application, adapters, interfaces, composition |
| entry | composition, interfaces |

### Allowlist inventory

Exactly one owned exception remains in the production graph:

| Source | Target | Direction | Owner | Removal condition |
|---|---|---|---|---|
| `src/application/handoff-command-use-case.ts` | `src/adapters/review/review-static-evidence.ts` | application → adapters | `TASK-2369.13` | Removed when `TASK-2369.13` (Dedup goal-check evidence handoff and review) re-homes goal-check evidence parsing out of the review adapter; tracked at `missions/task-2369.13` and `backlog/tasks/task-2369.13 - Dedup-goal-check-evidence-handoff-and-review.md`. |

This entry post-dates the TASK-2332 sequence: it was introduced by the TASK-2369
wave, not by the 2322 migration. The 2332 migration allowlist is empty — see CP-6
for the zero-2332-exception certification.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Graph-based import validation replaces name blacklists for all six ADR 0051 layers | `test/dependency-graph.test.ts` tests `dependency graph validates domain layer imports without unallowlisted violations`, `dependency graph validates application layer imports without unallowlisted violations`, `dependency graph grants adapters no blanket adapters-to-adapters permission`, `dependency graph validates interfaces layer imports without unallowlisted violations`, `dependency graph validates composition layer imports without unallowlisted violations`, `dependency graph validates entry layer imports without unallowlisted violations`; graph declared in `src/adapters/architecture/boundary-guards.ts` (`allowedDependencyGraph`, `layerRoots`) per `ADR 0051` | PASS |
| New violations fail immediately rather than being absorbed | `dependency graph rejects a forbidden unallowlisted application-to-adapter edge immediately` and `dependency graph rejects an interface import of a canonical composition module` in `test/dependency-graph.test.ts` | PASS |
| Every allowlist entry has a declared owner task ID and an intended removal mission | `every owned dependency exception names a task ID and an existing removal mission` in `test/dependency-graph.test.ts`, asserting on the exported `productionDependencyExceptions` | PASS |
| Allowlist entries cannot go stale unnoticed | `every owned dependency exception still describes a live application-to-adapter edge` in `test/dependency-graph.test.ts` | PASS |
| Production tree carries no violation outside the owned allowlist | `dependency graph production scan has no violation outside the owned allowlist` in `test/dependency-graph.test.ts` | PASS |
| Guard suite is green on this tree | `npx tsx --test test/dependency-graph.test.ts` — 30 tests, 30 pass, 0 fail | PASS |
| Static analysis passes | `./scripts/verify-local.sh static-analysis` | PASS |

Next action: Proceed to CP-2 — verify TASK-2332.02's single production composition
root and the absence of any adapter→composition import, using the composition
boundary assertions in `test/dependency-graph.test.ts` and `test/application-boundaries.test.ts`.
