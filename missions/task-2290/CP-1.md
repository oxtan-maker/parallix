# CP 1 — Prerequisite confirmation and handler path inventory

## Summary

Confirmed that TASK-2278/ADR 0051 and TASK-2289 are integrated before this
mission branch, and that the prior architecture checkpoint records the required
human review. Inventoried the legacy handler branches before rewiring: the
stats handler owns help parsing, argument interpretation, projection, optional
write, rendering, and unresolved-item stderr; the active handler owns usage,
preflight, worktree/setup, launch, post-launch synchronization, stats, and
handoff. Existing direct-handler and strict-port tests are the characterization
baseline for the delegation checkpoints.

| Handler branch | Application outcome | CLI rendering / exit mapping | Mutation order / rollback | Exact characterization test |
|---|---|---|---|---|
| `stats-backfill --help` | Not invoked | Usage on stdout; return | None | `"statsBackfill supports help, json output, summary output, and apply mode"` |
| Stats report-only text or JSON | Completed projection | Existing text or JSON on stdout; return | Read only | `"statsBackfill supports help, json output, summary output, and apply mode"`; `"stats service reads a source-labelled projection without mutation in query mode"` |
| Stats `--apply` | Completed projection plus evidence | Existing summary / applied line; unresolved notice on stderr | Read projection, then write rows; write failure must not render success | `"statsBackfill supports help, json output, summary output, and apply mode"`; `"stats service cancels at the safe boundary before applying rows"` |
| Stats skipped / malformed / unresolved record | Completed projection retaining item representation | Existing summary / JSON representation, unresolved stderr only for apply | No write for skipped or unresolved rows | `"collectHistoricalStatsBackfill resolves done missions, skips non-done missions, and reports unresolved items"`; `"collectHistoricalStatsBackfill reports unresolved task resolution and legacy classification fallback"` |
| `active` usage or malformed `--implementer` | Not invoked | Usage on stderr; exit 1 | None | `"active() exits non-zero with usage text when --implementer is missing its value"` |
| Active preflight/worktree rejection | Rejected | Existing stderr; exit 1 | No launch or task mutation | `"active() exits 1 when preflight fails"`; `"active() exits 1 when worktree is missing"` |
| Active launch and durable active transition | Completed launch evidence | Existing progress stdout | Select/launch, then record active; deferred rebase synchronized after output | `"active() success path: preflight, launch, and handoff run in order"`; `"selectLaunchAndRecord writes Backlog before the launcher resolves its final result"` |
| Active launch throw / nonzero / rollback failure | Failed | Existing stderr; exit 1 or exact agent status | Roll back prior status/assignee after a recorded launch; retain partial evidence if rollback is unsafe | `"active() exits 1 when execute launch throws"`; `"active() exits with agent status when execute agent returns non-zero"`; `"selectLaunchAndRecord rolls Backlog back when startAgent returns non-zero exit status"`; `"selectLaunchAndRecord logs warning (not throws) when rollback transitionTask fails inside onLimitHit"` |
| Active cancellation / handoff / deferred synchronization | Cancelled or failed/completed | Existing stderr / exit mapping | No later port calls after cancellation; safety and synchronization precede handoff | `"active cancellation after durable record reports partial evidence without rollback claim"`; `"active() synchronizes a launch-deferred rebase after execute output is committed"`; `"active() exits 1 when handoff fails after successful execute launch"` |

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Prerequisites are integrated and the required human architecture review is recorded | ADR 0051; `missions/task-2278/CP-5.md:5`; `git log --oneline --all --grep='task-2278\\|TASK-2278\\|ADR 0051\\|0051'` | PASS |
| TASK-2289 application services and sole composition root are available before delegation | `lib/application/stats-backfill-service.ts:12`; `lib/application/active-service.ts:18`; `lib/composition/application-services.ts:11` | PASS |
| SC1 stats branches have a pre-rewire characterization baseline | `test/stats-backfill.test.ts`; `"statsBackfill supports help, json output, summary output, and apply mode"` | PASS |
| SC3 active lifecycle branches have a pre-rewire characterization baseline | `test/active.test.ts`; `"active() success path: preflight, launch, and handoff run in order"`; `"selectLaunchAndRecord rolls Backlog back when startAgent returns non-zero exit status"` | PASS |
| SC5/SC6 strict application-port behavior is characterized before handler rewiring | `test/application-services.test.ts`; `"active service calls strict ports in launch-record-handoff order"`; `"active cancellation after durable record reports partial evidence without rollback claim"` | PASS |
| SC8 composition and import boundary guards are in place | `test/application-boundaries.test.ts`; `"composition guard accepts the sole production composition root"` | PASS |

Next action: delegate the `stats-backfill` projection and apply branches through `StatsBackfillService`, retaining help and rendering at the CLI edge.
