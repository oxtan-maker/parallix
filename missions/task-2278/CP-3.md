# CP 3 — Post-ADR implementation missions partitioned

## Summary

Created two non-overlapping backlog missions. TASK-2289 owns contracts, ports,
composition wiring, and mocked/import-boundary tests without CLI delegation.
TASK-2290 depends on it and owns only `stats-backfill` and `active` delegation,
behavior equivalence, final gates, and rollback. Both depend on TASK-2278 and
are blocked until ADR integration plus explicit human approval of the decision
and breakdown.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| ADR is indexed and defines all interface-layer dependency directions | `docs/adr/0051-ui-neutral-application-boundary.md:157`; `docs/adr/index.md:22` | PASS |
| ADR records repository-specific research and four-option comparison | `docs/adr/0051-ui-neutral-application-boundary.md:60`; `docs/adr/0051-ui-neutral-application-boundary.md:103` | PASS |
| Six shared UI-neutral contracts are specified | `docs/adr/0051-ui-neutral-application-boundary.md:228` | PASS |
| Board intent and UI-command-only mutation rule are documented | `docs/adr/0051-ui-neutral-application-boundary.md:274`; `docs/adr/0051-ui-neutral-application-boundary.md:281` | PASS |
| Markdown and Git-owned mission state remain canonical | `docs/adr/0051-ui-neutral-application-boundary.md:286` | PASS |
| Follow-up missions partition contracts, wiring, delegation, tests, gates, and rollback | `backlog/tasks/task-2289 - Extract-UI-neutral-application-contracts-and-composition.md`; `backlog/tasks/task-2290 - Delegate-bounded-CLI-slices-through-application-boundary.md` | PASS |
| Follow-ups state TASK-2278 dependency and human-approval prerequisite | `backlog/tasks/task-2289 - Extract-UI-neutral-application-contracts-and-composition.md:12`; `backlog/tasks/task-2290 - Delegate-bounded-CLI-slices-through-application-boundary.md:13` | PASS |
| Documentation/planning tree passes the declared verifier | `./scripts/verify-local.sh all` | PENDING — CP 4 |

Selected-slice evidence remains exact and durable: `test/stats-backfill.test.ts`
contains `"statsBackfill supports help, json output, summary output, and apply
mode"`; `test/active.test.ts` contains `"active() exits with agent status when
execute agent returns non-zero"`. TASK-2290 requires new assertions for
`active` text and its intentionally unsupported JSON mode. The required
import-boundary test is assigned to TASK-2289 and its scope is specified by
`docs/adr/0051-ui-neutral-application-boundary.md:217`.

Next action: run `./scripts/verify-local.sh all`, inspect the documentation-only diff, then write CP-4 with final gate evidence.
