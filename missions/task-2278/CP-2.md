# CP 2 — ADR 0051 authored and indexed

## Summary

Authored ADR 0051 and indexed it. The decision selects a two-use-case
application boundary for `stats-backfill` and `active`, rejects UI authority
and framework-first extraction, defines the six shared contracts, preserves
Markdown/Git authority, and limits board work to projections and guarded
application-command requests. It records the compatibility edge discovered
in CP 1: `active` has text and exit-code behavior but no current JSON mode.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| ADR is indexed and defines all interface-layer dependency directions | `docs/adr/0051-ui-neutral-application-boundary.md:157`; `docs/adr/index.md:22` | PASS |
| ADR records repository-specific research and four-option comparison | `docs/adr/0051-ui-neutral-application-boundary.md:60`; `docs/adr/0051-ui-neutral-application-boundary.md:103`; ADR 0044; ADR 0048 | PASS |
| Six shared UI-neutral contracts are specified | `docs/adr/0051-ui-neutral-application-boundary.md:228` | PASS |
| Board intent and UI-command-only mutation rule are documented | `docs/adr/0051-ui-neutral-application-boundary.md:274`; `docs/adr/0051-ui-neutral-application-boundary.md:281` | PASS |
| Markdown and Git-owned mission state remain canonical | `docs/adr/0051-ui-neutral-application-boundary.md:286` | PASS |
| Follow-up missions partition contracts, wiring, delegation, tests, gates, and rollback | `docs/adr/0051-ui-neutral-application-boundary.md:327` | PENDING — CP 3 creates the records |
| Follow-ups state TASK-2278 dependency and human-approval prerequisite | `docs/adr/0051-ui-neutral-application-boundary.md:329` | PENDING — CP 3 creates the records |
| Documentation/planning tree passes the declared verifier | `./scripts/verify-local.sh all` | PENDING — CP 4 |

Selected CLI baseline: `test/stats-backfill.test.ts` contains
`"statsBackfill supports help, json output, summary output, and apply mode"`
for text/JSON behavior; `test/active.test.ts` contains
`"active() exits with agent status when execute agent returns non-zero"` for
the lifecycle exit code. `lib/commands/active.ts:24` confirms no active JSON
mode exists; the follow-up must preserve that non-feature explicitly. The
import-boundary test is specified by `docs/adr/0051-ui-neutral-application-boundary.md:217`
and will be created only in the approved implementation work.

Next action: create TASK-2289 and TASK-2290 backlog records with bounded candidate files, tests, NEL, gates, rollback, and approval block.
