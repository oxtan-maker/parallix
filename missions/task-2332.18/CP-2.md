# CP-2: Amend active ADR decisions

## Summary

Amended ADR 0037, ADR 0051, and ADR 0053 in place. ADR 0037 now assigns command-workflow sequencing to application use cases, request translation to interfaces, concrete effects to adapters, and object assembly to composition. ADR 0051 now records all six canonical roots, their enforced dependency direction, application ownership of workflows, application-owned ports for cross-adapter behavior, and interface ownership of request translation. ADR 0053 now names the active `SqliteMissionStore` composition path and replaces its volatile citation wording.

No ADR status changed and `docs/adr/index.md` therefore needs no update.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| ADR 0051 describes the six-root landed architecture | `ADR 0051`, `src/adapters/architecture/boundary-guards.ts` (`layerRoots`, `allowedDependencyGraph`) | PASS |
| ADR 0051 omits the four deleted files and root entry point | `docs/adr/0051-ui-neutral-application-boundary.md`, `src/entry/px.ts` | PASS |
| ADR source citations are durable | `ADR 0037`, `ADR 0051`, `ADR 0053`, `./scripts/verify-local.sh docs` | PASS |
| Ownership rules are explicit in their owning ADRs | `ADR 0037`, `ADR 0051`, `src/adapters/README.md` | PASS |
| ADR 0037 review outcome | amended — `docs/adr/0037-ai-workflow-coordination-architecture.md` | PASS |
| ADR 0053 review outcome | amended — `docs/adr/0053-operational-persistence-and-authority-boundaries.md` | PASS |
| ADRs remain current-decision records | `ADR 0037`, `ADR 0051`, `ADR 0053` | PASS |
| Implementation defects require no follow-up task | `src/composition/application-services.ts` (`createMissionApplicationServices`), `src/adapters/architecture/boundary-guards.ts` | PASS |
| Final index review and full verification remain | `docs/adr/index.md`, `./scripts/verify-local.sh all` | PENDING |

Next action: Review ADR statuses and index consistency, then run the mission gate `./scripts/verify-local.sh all`.
