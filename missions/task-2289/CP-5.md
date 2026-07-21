# CP 5 — Final verification and rollback boundary

## Summary

Ran the focused contract, service, and boundary suite after rebuilding; then
ran both required repository gates successfully. The final repair made the
transitive import guard inspect side-effect imports, kept the guard separate
from the production composition root, and resolved static-analysis findings
without changing either selected CLI handler.

Review repair: `LegacyActiveAdapter` now invokes the existing preflight,
worktree, prompt, launch-and-record, safety, synchronization, execute-stat,
and handoff helpers in their established lifecycle order. The import fixture
also exercises every SC6 prohibited category, including a source-level
`process.exit` use, while retaining transitive coverage. Strict fake runtime
tests characterize the adapter lifecycle and failed-launch boundary.

Rollback boundary: commit IDs are rewritten by the required Parallix rebase,
so do not use fixed hashes. Before integration, revert the current mission
branch range in reverse order with `git revert --no-commit $(git rev-list "$(git merge-base main HEAD)..HEAD")`, then commit that revert. This removes
the application, port, adapter, composition, fixture, guard,
checkpoint, and active-statistics type additions. The
legacy handlers remain direct in `lib/commands/stats-backfill.ts` and
`lib/commands/active.ts`; no persisted-state, authority, or CLI migration was
introduced.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC1 — terminal outcomes, labelled projections, progress IDs, cancellation, and capability contracts are explicit | `lib/application/contracts.ts:1`; `lib/application/contracts.ts:23`; `lib/application/contracts.ts:29`; `lib/application/contracts.ts:37`; `"application outcomes have one terminal status and typed error variants"` | PASS |
| SC2 — both services use narrow strict ports with ordered calls and mutation assertions | `lib/application/ports.ts:13`; `lib/application/ports.ts:23`; `"active service calls strict ports in launch-record-handoff order"`; `"stats service reads a source-labelled projection without mutation in query mode"` | PASS |
| SC3 — application boundary contains only consumer-owned port operations | `lib/application/ports.ts:13`; `test/application-boundaries.test.ts` | PASS |
| SC4 — legacy adapters retain task, agent, stats, configuration, safety, synchronization, and handoff integrations and fail safely | `lib/adapters/legacy-active-adapter.ts:17`; `lib/adapters/legacy-active-adapter.ts:51`; `test/legacy-active-adapter.test.ts`; `"legacy active adapter preserves the launch-synchronize-stats-handoff lifecycle order"` | PASS |
| SC5 — one production composition root and composition/service-locator guards are enforced | `lib/composition/application-services.ts:12`; `lib/architecture/boundary-guards.ts:34`; `"composition guard rejects complete adapter construction fixture"`; `"composition guard rejects service-locator access fixture"` | PASS |
| SC6 — every prohibited direct category plus a transitive application import are rejected | `lib/architecture/boundary-guards.ts:4`; `lib/architecture/boundary-guards.ts:16`; `"application import guard rejects every direct prohibited dependency category"`; `"application import guard rejects transitive prohibited dependency fixture"` | PASS |
| SC7 — capability rejection, progress boundaries, and cancellation preserve mutation safety and durable evidence | `lib/application/stats-backfill-service.ts:16`; `lib/application/active-service.ts:32`; `"stats service rejects apply capability before any mutation-port call"`; `"active cancellation after durable record reports partial evidence without rollback claim"` | PASS |
| SC8 — selected handlers remain characterized and direct, with no mission delegation | `test/stats-backfill.test.ts`; `test/active.test.ts`; `missions/task-2289/contract-matrix.md:15` | PASS |
| SC9 — changed boundary code is lint-clean and focused tests contain no skips | `./scripts/verify-local.sh static-analysis`; `test/application-services.test.ts`; `test/application-boundaries.test.ts` | PASS |
| SC10 — focused tests and both required repository gates completed successfully | `npm run build && node test/run-default-tests.js test/application-contracts.test.ts test/application-services.test.ts test/application-boundaries.test.ts`; `./scripts/verify-local.sh all`; `./scripts/verify-local.sh static-analysis` | PASS |
| SC11 — rollback is limited to mission additions and leaves legacy handlers untouched | `lib/commands/stats-backfill.ts:1`; `lib/commands/active.ts:1`; `git merge-base main HEAD`; `git rev-list "$(git merge-base main HEAD)..HEAD"` | PASS |

Next action: Parallix may perform the lifecycle handoff after confirming this committed CP-5 and MISSION.md are clean.
