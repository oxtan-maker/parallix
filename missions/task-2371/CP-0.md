# CP-0: Baseline and production seam trace

Baseline recorded before production edits: `0b5bda1bab6f391944ad9f7ae214b177fd40345d`; the working tree was clean.

Traced the approval seam in `src/adapters/review/review-commands.ts`, landed closeout in `src/adapters/cli/commands/integrate.ts`, authoritative transition persistence in `src/application/mission-integration-service.ts`, shared decision windows in `src/adapters/cli/commands/stats.ts`, and Agent Performance/Spend aggregation in `src/adapters/cli/commands/stats.ts` with `src/application/services/statistics-service.ts`. The pre-change seams still permit direct landing completion from `review`, telemetry-date-first performance selection, and fallback unknown review-fix values as zero.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Baseline and clean tree recorded before code changes | `git rev-parse HEAD`; `git status --short` | PASS |
| Production lifecycle approval and landing seams traced | `src/adapters/review/review-commands.ts`; `src/adapters/cli/commands/integrate.ts`; `src/application/mission-integration-service.ts` | PASS |
| Decision-window, performance, spend, and PR-fix seams traced | `src/adapters/cli/commands/stats.ts`; `src/application/services/statistics-service.ts` | PASS |
| Existing integration regression path identified | `test/task-2367-integration-completion-repro.test.ts` | PASS |

Next action: add R1–R4 lifecycle regressions before changing the approval or landing production paths.
