# CP 1 — Repository-specific boundary research

## Summary

Inspected the current bounded candidates before designing a seam. The read
candidate is `px stats-backfill`: it accepts `--json`, renders either JSON or
text, and writes only when `--apply` is requested. The lifecycle candidate is
`px active`: it runs preflight, launches an agent, records the existing task
Markdown transition through `transitionTask`, and rolls that transition back
when launch fails. Its current public contract is text plus explicit exit
codes; it has no `--json` flag. A follow-up must therefore preserve that
absence (reject/ignore no new JSON mode) rather than claim compatibility for
an invented format.

Observations are the source and test references below. The inference is that a
two-use-case seam can isolate orchestration without changing task/Git
authority, provided ports retain the existing effects and the CLI remains the
formatter and exit-code owner. ADR 0048's 23 checks across five phases and
eight failure classes make unchecked agent assertions, implicit policy, and
new UI state authority unacceptable. The real-agent and lifecycle E2E suites
remain constraints because they exercise actual configuration, artifact, and
lifecycle boundaries rather than only unit-level happy paths.

The alternatives to evaluate in ADR 0051 are: retain handlers as the shared
API; extract the two selected use cases behind application contracts and
effect ports; make a UI/store/event model authoritative; or rewrite a command
family/generalize before a representative slice. The research supports only
the bounded extraction as a candidate decision: it has a rollback to prior CLI
wiring, preserves `transitionTask` and Git-backed artifacts, and keeps mocked
ports deterministic. The UI-authority and framework-first alternatives fail
the authority, rollback, and NEL constraints; handler-sharing retains current
coupling and cannot give three clients a stable neutral contract.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| ADR is indexed and defines all interface-layer dependency directions | `docs/adr/0044-workflow-distribution-model.md:146`, ADR 0044 | PENDING — CP 2 |
| ADR records repository-specific research and four-option comparison | ADR 0048; `lib/commands/stats-backfill.ts:355`; `lib/commands/active.ts:24`; `test/e2e-real-agent-smoke.test.js`; `test/e2e-mission-lifecycle.test.js` | PASS — research captured for ADR drafting |
| Six shared UI-neutral contracts are specified | `lib/commands/stats-backfill.ts:390`; `lib/commands/active.ts:44` | PENDING — CP 2 |
| Board intent and UI-command-only mutation rule are documented | `lib/commands/active.ts:129`; ADR 0044 | PENDING — CP 2 |
| Markdown and Git-owned mission state remain canonical | `lib/tools/backlog.ts:280`; `lib/commands/active.ts:254` | PASS — observed authority to retain |
| Follow-up missions partition contracts, wiring, delegation, tests, gates, and rollback | `test/stats-backfill.test.ts`, `test/active.test.ts`, `test/index.test.ts` | PENDING — CP 3 |
| Follow-ups state TASK-2278 dependency and human-approval prerequisite | `backlog/tasks/task-2278 - Establish-UI-neutral-application-architecture-and-ADR-0051.md` | PENDING — CP 3 |
| Documentation/planning tree passes the declared verifier | `./scripts/verify-local.sh all` | PENDING — CP 4 |

Selected-slice test inventory: `test/stats-backfill.test.ts` contains the
existing JSON invocation and `test/active.test.ts` contains
`"active() exits with agent status when execute agent returns non-zero"`.
The former's text/JSON behavior is a baseline; the latter is the lifecycle
exit-code baseline. No existing `active --json` behavior exists
(`lib/commands/active.ts:24`), so the follow-up must add an explicit
unsupported-mode assertion rather than a JSON-equivalence assertion. The
planned import-boundary test does not exist yet and is correctly deferred to
the approved implementation mission.

Next action: author `docs/adr/0051-ui-neutral-application-boundary.md` from this inventory and index it.
