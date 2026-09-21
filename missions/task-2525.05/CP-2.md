# CP-2 — S3776 complexity remediation batches

## Summary

Continued the behavior-preserving `typescript:S3776` (Cognitive Complexity > 15) remediation. The first batch (CP-2, committed) reduced the family from 113 to 109 by isolating branch-heavy decisions in the recovery, integrate, and review command paths and by closing the shared-scanner guard in `scripts/sonar-local.ts`.

This batch reduced `typescript:S3776` from 109 to 102 by extracting focused helpers from five control-flow-dense functions, each verified against its existing regression suite so observable behavior is preserved:

- `src/application/rebase-workflow.ts` — `parseConflictFilesFromGitStatus`: per-line conflict classification lifted into `conflictFileFromStatusLine`. Evidence: `test/rebase.test.ts`, `test/rebase_hardening.test.ts`.
- `src/domain/review.ts` — `applyReviewerCommand`: requested-change finding validation lifted into `validateRequestChanges`. Evidence: `test/domain-mission.test.ts`, `test/domain-projections.test.ts`.
- `src/adapters/cli/commands/stats-backfill.ts` — `renderBackfillSummary`: the three near-identical Resolved/Unresolved/Skipped sections collapsed into one `pushSummarySection` renderer. Evidence: `test/stats-backfill.test.ts`, `test/stats-backfill-helpers.test.ts`, `test/stats-backfill-pure.test.ts`.
- `src/adapters/architecture/boundary-guards.ts` — `findDependencyViolations`: the per-source specifier loop lifted into `violationsFromSource`. Evidence: `test/application-boundaries.test.ts`.
- `src/adapters/backlog/mission-materialization.ts` — `materializeBacklogMission`: the done-base branch lifted into `materializeDoneMission`. Evidence: `test/backlog-mission-materialization.test.ts`.

The full unit suite passes after these edits (`npm test`, 2869 passed / 0 failed). `tsc --noEmit` is clean. No `.only` or bare `.skip` was introduced; no suppression, severity change, or source exclusion was used.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Fresh S3776 batches have focused behavior-preservation evidence | `test/rebase.test.ts`, `test/domain-mission.test.ts`, `test/stats-backfill.test.ts`, `test/application-boundaries.test.ts`, `test/backlog-mission-materialization.test.ts`; `npm test` 2869 passed / 0 failed | PASS |
| Every S3776 fix is a source-site refactor with no suppression or config change | `sonar-project.properties` unchanged; refactors in `src/application/rebase-workflow.ts`, `src/domain/review.ts`, `src/adapters/cli/commands/stats-backfill.ts`, `src/adapters/architecture/boundary-guards.ts`, `src/adapters/backlog/mission-materialization.ts` | PASS |
| S3776 findings reduced from the 113 baseline | `curl -fsS 'http://127.0.0.1:9000/api/issues/search?componentKeys=parallix&resolved=false&impactSeverities=HIGH,BLOCKER&rules=typescript:S3776&ps=500'` returned `total: 102`; scanner enforcement in `scripts/sonar-local.ts` | PENDING (all eliminated) |
| Remaining High-or-worse rule families eliminated at source sites | `missions/task-2525.05/MISSION.md` rule families; `./scripts/verify-local.sh static-analysis` | PENDING CP-3 |
| Final repository verification passes | `./scripts/verify-local.sh all` | PENDING CP-4 |

Next action: CP-3 resolves the remaining baseline families (`typescript:S3735`, `typescript:S2004`, `typescript:S2871`, `typescript:S3516`, `typescript:S4123`); the two surviving `typescript:S2004` live in the review-loop handoff composition in `src/composition/application-services.ts` and `src/composition/create-cli.ts`.
