# CP 5 — Final verification and revert boundary

## Summary

Completed the two CLI delegations and recorded their verification boundary.
Reverting this mission restores lib/commands/active.ts and
lib/commands/stats-backfill.ts orchestration and removes only the
delegation-specific wiring, without changing task Markdown authority,
lifecycle policy, text/JSON output, or exit-code contracts.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC1 stats success and write-failure equivalence are covered | test/stats-backfill.test.ts; "statsBackfill maps a delegated write failure to stderr and exit 1 without success output" | PASS |
| SC2 stats projection/write ordering crosses the service | lib/application/stats-backfill-service.ts:22; lib/application/stats-backfill-service.ts:26 | PASS |
| SC3 active lifecycle, exact progress ordering, and nonzero-exit text are covered | test/active.test.ts; "active progress renderer preserves launch and handoff status order"; test/active.test.ts; "active() exits with agent status when execute agent returns non-zero"; test/legacy-active-adapter.test.ts; "legacy active adapter stops after a failed launch without safety, stats, or handoff" | PASS |
| SC4 active CLI delegates to the composed service | lib/commands/active.ts:61; lib/adapters/legacy-active-adapter.ts:34 | PASS |
| SC5/SC6 strict ports preserve order and terminal outcomes | test/application-services.test.ts | PASS |
| SC7 CLI edge owns rendering and exit mapping | lib/commands/active.ts:67; lib/commands/stats-backfill.ts:387 | PASS |
| SC8 boundary guards and composition wiring pass | test/application-boundaries.test.ts; lib/composition/application-services.ts:11 | PASS |
| SC9 changed paths contain no placeholders or focused tests | lib/commands/active.ts; lib/commands/stats-backfill.ts; test/active.test.ts | PASS |
| SC10 focused tests and repository gates pass | node test/run-default-tests.js test/active.test.ts test/stats-backfill.test.ts test/application-services.test.ts test/application-boundaries.test.ts; ./scripts/verify-local.sh all; ./scripts/verify-local.sh static-analysis | PASS |
| SC11 precise revert boundary restores the handlers and delegation wiring | `git revert --no-commit HEAD 84a46804a3295fa572799ee728a43742a1a1e3ea 1c6c039eb82325613970e894324b83c8e32fa633 b260f1028c1e936c2993e52e85fe177d10c03c01`; `git diff 02f3003f4aa23a74023b0f27db9084cc7dde6903..HEAD -- lib/commands/active.ts lib/commands/stats-backfill.ts lib/application lib/adapters lib/composition` | PASS |
| SC12 frozen ADR baseline query and post-integration cohort instruction are recorded without an outcome claim | `git show 09c183ac7b64b66c1e5566d01105070a432b0420:docs/adr/0051-ui-neutral-application-boundary.md | sed -n '77,96p'`; `docs/adr/0051-ui-neutral-application-boundary.md:408-430`; `backlog/tasks/task-2291 - Measure-post-boundary-bug-frequency-cohort.md:29-46` | PASS |

Next action: submit the implementation for independent review after the declared gates complete.
