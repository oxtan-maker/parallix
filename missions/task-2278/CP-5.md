# CP 5 — Post-approval ADR and implementation-plan reconciliation

## Summary

Reconciled the backlog task with the locked ADR-only mission after the human
architecture review. ADR 0051 now makes completed-mission bug frequency the
primary driver, evaluates Clean Architecture explicitly, and fixes the
observation denominator. The implementation plan now uses unique TASK-2289 and
TASK-2290 records with strict completeness/no-bypass guardrails; TASK-2291 owns
the first post-integration reliability cohort. Downstream ESM and board work is
ordered behind the integrated application seam, and unextracted board commands
remain unavailable rather than duplicating lifecycle policy.

No production or test code changed. Per the operator's explicit direction, the
full verifier was not rerun for this documentation/task-plan-only reconciliation.
CP-4 retains the previously recorded `./scripts/verify-local.sh all` proof; this
checkpoint claims only current-tree Markdown, frontmatter, reference,
dependency, and diff-integrity validation.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| ADR 0051 remains indexed and defines the UI-neutral dependency direction | `docs/adr/0051-ui-neutral-application-boundary.md:212`; `docs/adr/0051-ui-neutral-application-boundary.md:236`; `docs/adr/index.md:22` | PASS |
| Repository-specific alternatives now include an explicit Clean Architecture comparison | `docs/adr/0051-ui-neutral-application-boundary.md:142`; `docs/adr/0051-ui-neutral-application-boundary.md:172`; ADR 0051 | PASS |
| Command/result, projection, progress, error, cancellation, and capability contracts remain specified | `docs/adr/0051-ui-neutral-application-boundary.md:301`; ADR 0051 | PASS |
| Board intent rejects direct mutation and retains current task/Git authority | `docs/adr/0051-ui-neutral-application-boundary.md:351`; ADR 0051 | PASS |
| Reliability uses completed missions only and records the 39 bug / 90 non-bug baseline | `docs/adr/0051-ui-neutral-application-boundary.md:79`; `docs/adr/0051-ui-neutral-application-boundary.md:86`; `docs/adr/0051-ui-neutral-application-boundary.md:406` | PASS |
| Contracts/composition work has unique ID, bounded NEL, strict mocks, violation fixtures, and agent-completeness stop rules | ADR 0051; `backlog/tasks/task-2289 - Extract-UI-neutral-application-contracts-and-composition.md:50`; `test/active.test.ts`; `test/stats-backfill.test.ts` | PASS |
| CLI delegation work covers all selected success/failure paths and prohibits shadow legacy orchestration | ADR 0051; `backlog/tasks/task-2290 - Delegate-bounded-CLI-slices-through-application-boundary.md:57`; `test/active.test.ts`; `test/stats-backfill.test.ts` | PASS |
| Reliability measurement has an owned, completed-only 20-mission cohort with fixed arithmetic and no denominator dilution | ADR 0051; `backlog/tasks/task-2291 - Measure-post-boundary-bug-frequency-cohort.md:37` | PASS |
| ESM and board work cannot precede the application seam or invent unextracted mutation use cases | ADR 0051; `backlog/tasks/task-2279 - Move-runtime-to-ESM-src-tree-and-canonical-bundle.md:12`; `backlog/tasks/task-2281 - Build-operator-board-projections-events-and-guarded-controller.md:27` | PASS |
| TASK-2278 backlog scope now matches the locked documentation/planning mission | ADR 0051; `missions/task-2278/MISSION.md:4`; `missions/task-2278/MISSION.md:42` | PASS |
| Previously declared full gate has recorded proof; current cleanup is explicitly documentation/task-plan only | `missions/task-2278/CP-4.md:23`; `./scripts/verify-local.sh all`; `backlog/tasks/task-2278 - Establish-UI-neutral-application-architecture-and-ADR-0051.md:59` | PASS |
| Current structural validation is clean without claiming a new full verifier run | `git diff --check`; `missions/task-2278/CP-5.md` | PASS |

Selected behavior baselines remain unchanged: `test/stats-backfill.test.ts`
contains `"statsBackfill supports help, json output, summary output, and apply
mode"`; `test/active.test.ts` contains `"active() success path: preflight,
launch, and handoff run in order"` and `"active() exits with agent status when
execute agent returns non-zero"`. This checkpoint adds no implementation or
test behavior.

Next action: checkpoint the reconciled documentation/task-plan tree locally,
then submit TASK-2278 for a fresh review of the post-approval changes.
