# CP 4 — Final documentation/planning verification

## Summary

The ADR/planning tree passed the required general verifier. The task-specific
committed documentation/planning change set, measured from pre-CP-1 commit
`484c9cbd`, contains ADR/index, checkpoint, and new follow-up backlog records;
it contains no production, application-seam, CLI-wiring, or test-behavior
changes. Apart from workflow-managed task status transitions, existing
TASK-2278 backlog content and dependency-lock data were preserved unchanged.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| ADR 0051 exists, is indexed, and specifies dependency direction for domain, application, ports, adapters, CLI, Ink TUI, and web transport | `docs/adr/0051-ui-neutral-application-boundary.md:157`; `docs/adr/index.md:22` | PASS |
| ADR records repository-specific research and evidence-backed comparison of all four alternatives | `docs/adr/0051-ui-neutral-application-boundary.md:60`; `docs/adr/0051-ui-neutral-application-boundary.md:103`; ADR 0044; ADR 0048 | PASS |
| ADR specifies command/result, read-projection, progress/event, error, cancellation, and capability/authorization contracts | `docs/adr/0051-ui-neutral-application-boundary.md:228` | PASS |
| ADR records board intent and rejects direct UI workflow-state mutation | `docs/adr/0051-ui-neutral-application-boundary.md:274`; `docs/adr/0051-ui-neutral-application-boundary.md:281` | PASS |
| ADR retains task Markdown and Git-owned mission state as canonical and requires a separate authority ADR for replacement | `docs/adr/0051-ui-neutral-application-boundary.md:286` | PASS |
| New backlog missions cover contracts/ports, composition, one read and lifecycle delegation, equivalence/mocked/import-boundary tests, gates, and rollback | `backlog/tasks/task-2289 - Extract-UI-neutral-application-contracts-and-composition.md:31`; `backlog/tasks/task-2290 - Delegate-bounded-CLI-slices-through-application-boundary.md:33`; `docs/adr/0051-ui-neutral-application-boundary.md:327` | PASS |
| Every follow-up names files/tests, NEL, TASK-2278 dependency, and integrated-ADR plus human-approval block | `backlog/tasks/task-2289 - Extract-UI-neutral-application-contracts-and-composition.md:11`; `backlog/tasks/task-2289 - Extract-UI-neutral-application-contracts-and-composition.md:25`; `backlog/tasks/task-2290 - Delegate-bounded-CLI-slices-through-application-boundary.md:12`; `backlog/tasks/task-2290 - Delegate-bounded-CLI-slices-through-application-boundary.md:27` | PASS |
| Required general verification succeeds and this mission makes no production boundary/wiring/test-behavior change | `./scripts/verify-local.sh all`; `git diff --name-only 484c9cbd..HEAD` | PASS |

Selected-slice durable baselines: `test/stats-backfill.test.ts` contains
`"statsBackfill supports help, json output, summary output, and apply mode"`
for text and JSON output; `test/active.test.ts` contains
`"active() success path: preflight, launch, and handoff run in order"` and
`"active() exits with agent status when execute agent returns non-zero"` for
text lifecycle output and exit propagation. `lib/commands/active.ts:24`
shows that active currently has no JSON contract, which TASK-2290 must
explicitly preserve. The planned import-boundary test is assigned to TASK-2289
with its forbidden-import rule in `docs/adr/0051-ui-neutral-application-boundary.md:217`;
this documentation-only mission intentionally does not create it.

Next action: run `px review task-2278 --submit` after this repaired checkpoint is committed.
