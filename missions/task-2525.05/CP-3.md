# CP-3 — Remaining baseline rule families

## Summary

Resolved the non-`S3776` baseline High-or-worse families at their source sites. The four families below are eliminated from the unresolved inventory; each fix is a minimal, behavior-preserving source-site change verified by the existing regression suite:

- `typescript:S3735` (16): removed the redundant `void` operator on fire-and-forget / intentionally-unused expressions across `src/adapters/agents/vibe.ts`, `src/adapters/agents/vibe-telemetry.ts`, `src/adapters/cli/commands/active.ts`, `src/adapters/cli/commands/stats.ts`, `src/interfaces/tui/action-bar.tsx`, `src/interfaces/tui/ui-command.ts`, and `src/application/execute-mission-service.ts`.
- `typescript:S2871` (2): `src/application/projections/metrics.ts` sorts now use a `String.localeCompare`-based comparator. Evidence: `test/sonarqube-s2871-sorts.test.ts`.
- `typescript:S3516` (1) and `typescript:S4123` (1): resolved at source in `src/adapters/cli/commands/draft-setup.ts` and `src/adapters/cli/commands/stats-backfill.ts` respectively.

The two surviving `typescript:S2004` (nesting > 4) live in the review-loop handoff composition. They are pre-existing baseline findings whose inline `performHandoffFn` arrow is pinned by `test/task-2332.09-handoff-composition.test.ts` (which asserts the composed review loop injects the handoff function) while the nesting limit forbids the shallow-extraction that would otherwise remove it; they carry to CP-4.

After this batch the unresolved High-or-worse inventory is 104: `typescript:S3776=102`, `typescript:S2004=2`. All `S3735`, `S2871`, `S3516`, and `S4123` findings are eliminated.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| `typescript:S3735` eliminated at source | `curl -fsS 'http://127.0.0.1:9000/api/issues/search?componentKeys=parallix&resolved=false&impactSeverities=HIGH,BLOCKER&rules=typescript:S3735&ps=500'` returned `total: 0`; scanner enforcement in `scripts/sonar-local.ts` | PASS |
| `typescript:S2871` eliminated with localeCompare comparators | `test/sonarqube-s2871-sorts.test.ts`; `src/application/projections/metrics.ts` | PASS |
| `typescript:S3516` and `typescript:S4123` eliminated at source | `src/adapters/cli/commands/draft-setup.ts`; `src/adapters/cli/commands/stats-backfill.ts` | PASS |
| `typescript:S2004` reduced from 5 to 2 (2 remain, carried to CP-4) | `curl -fsS 'http://127.0.0.1:9000/api/issues/search?componentKeys=parallix&resolved=false&impactSeverities=HIGH,BLOCKER&rules=typescript:S2004&ps=500'` returned `total: 2`; `test/task-2332.09-handoff-composition.test.ts` pins the inline injection | PENDING (2 remaining) |
| Full regression suite green after family remediation | `npm test` full unit suite passes (2869 passed / 0 failed); `test/rebase.test.ts`, `test/domain-mission.test.ts`, `test/stats-backfill.test.ts` | PASS |
| Repository verification gate passes | `./scripts/verify-local.sh static-analysis` | PASS |

Next action: CP-4 runs the final fresh analysis; the remaining 102 `S3776` and 2 `S2004` are carried from earlier batches and require further source-site batches before the `total: 0` completion criterion can be met.
