# CP-1: ADR architecture audit

## Summary

Audited ADR 0037, ADR 0051, and ADR 0053 against the landed ports-and-adapters tree. `layerRoots` and `allowedDependencyGraph` in `src/adapters/architecture/boundary-guards.ts` establish the six canonical roots and permitted direction. `src/adapters/README.md` establishes that named host-mechanism dependencies do not grant workflow ownership, that behavior crosses application-owned ports, and that request translation belongs in `src/interfaces/`.

Decision/reference ledger:

| Item | Audit result | Owning record / next change |
|---|---|---|
| Canonical roots and dependency direction | Current tree has `src/domain`, `src/application`, `src/adapters`, `src/interfaces`, `src/composition`, and `src/entry`; the guard enforces their DAG. | ADR 0051: replace its pre-migration framing with the landed decision. |
| Command workflow ownership | `ExecuteMissionService` coordinates the execute workflow through application-owned ports; adapters implement concrete effects. | ADR 0051: state application ownership as the active architecture. |
| Adapter mechanism versus workflow | Named adapter-package rules allow concrete host mechanisms only; they do not authorize workflow sequencing. | ADR 0051: state the distinction explicitly. |
| Cross-adapter behavior | An adapter behavior route is an application-owned port; direct adapter edges require named mechanism rules. | ADR 0051: require cross-adapter collaboration to use an application-owned port. |
| Request translation | `src/interfaces/` owns CLI/TUI translation and rendering. | ADR 0051: assign request translation to interfaces explicitly. |
| ADR 0051 deleted-file references | The four specified deleted paths do not occur. `src/entry/px.ts` is a current file, not the deleted root `px.ts`. | ADR 0051: retain only durable current file-and-symbol references. |
| ADR 0037 | Its `workflow/index.js`, `workflow/lib/`, `docs/missions/2026/`, and dated reconciliation addendum describe the retired harness. | ADR 0037: amend in place to the current application-owned coordination decision; no implementation defect found. |
| ADR 0053 | The architecture decision remains compatible with application-owned ports and interfaces, but `src/adapters/backlog/compatibility-mission-store.ts` no longer exists and its prose says `file:line` citations. | ADR 0053: correct that obsolete reference and use file-and-symbol wording; no implementation defect found. |
| Line-based ADR references | No concrete `file:line` or `file:line-range` citation was found in ADRs 0037, 0051, or 0053. | ADR 0053 must still remove its generic `file:line` citation wording. |
| Implementation-versus-ADR contradictions | None found. The obsolete claims are ADR documentation defects, not a reason to change restricted source. | No follow-up task required. |

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| ADR 0051 landed-architecture audit is complete | `ADR 0051`, `src/adapters/architecture/boundary-guards.ts` | PASS |
| Four deleted ADR 0051 references are identified as absent | `docs/adr/0051-ui-neutral-application-boundary.md`, `src/entry/px.ts` | PASS |
| Line-based source-reference audit is complete | `ADR 0037`, `ADR 0051`, `ADR 0053` | PASS |
| Ownership rules have an identified ADR owner | `ADR 0051`, `src/adapters/README.md` | PASS |
| ADR 0037 review outcome is recorded | `ADR 0037`, `docs/adr/0037-ai-workflow-coordination-architecture.md` — amendment required | PASS |
| ADR 0053 review outcome is recorded | `ADR 0053`, `docs/adr/0053-operational-persistence-and-authority-boundaries.md` — amendment required | PASS |
| No unsupported implementation change is planned | `src/adapters/architecture/boundary-guards.ts`, `src/composition/application-services.ts` | PASS |
| Final ADR/index and verification work remains | `docs/adr/index.md`, `./scripts/verify-local.sh all` | PENDING |

Next action: Amend ADRs 0037, 0051, and 0053 in place using this ledger, without changing source or ADR status.
