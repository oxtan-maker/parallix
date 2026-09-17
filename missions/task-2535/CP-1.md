# Checkpoint 1 — Pre-mission baseline aggregate coverage

## Summary
Captured the pre-mission aggregate line coverage from `coverage/lcov.info` at the
mission's parent commit (`830634647`, "backlog(task-2535): transition to refined"),
which is the last commit before the mission branch diverged. The coverage gate
(`npm run test:coverage -- --lcov`) was run there to produce a durable
`coverage/lcov.info`. The recorded aggregate is **89.01%** line coverage, which
is below the `threshold = 90` literal in `src/adapters/verification/coverage-gate.ts`
and therefore exits 1.

Also ran `./scripts/verify-local.sh all` on the clean mission branch to confirm
the passing baseline for the fast gate (2688 tests, 0 failures).

The backlog task's per-module percentages (~27–39%) are stale; the real parent
commit already has focused tests on several of those modules. The genuinely-low
modules from the parent `coverage/lcov.info` are:

| Module | Line coverage (parent) |
| --- | --- |
| `src/adapters/cli/commands/stats-backfill.ts` | 55.8% |
| `src/adapters/github/github-pr.ts` | 59.2% |
| `src/application/presentation/cli-format.ts` | 67.5% |
| `src/adapters/review/review-loop.ts` | 72.1% |
| `src/adapters/git/git.ts` | 90.2% |
| `src/adapters/config/product-config.ts` | 79.4% |
| `src/adapters/config/repository-gates.ts` | 100.0% |
| `src/adapters/verification/verification.ts` | 97.9% |
| `src/adapters/cli/commands/stats.ts` | 90.4% |

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Pre-mission aggregate baseline captured | `coverage/lcov.info` at parent `830634647` → `all files 89.01` line; `npm run test:coverage -- --lcov` exited 1 with `89.01% line coverage does not meet threshold of 90%` | PASS |
| Fast gate passes on clean mission branch | `./scripts/verify-local.sh all` → `pass 2688 fail 0` | PASS |
| Threshold literal still 90 (untouched) | `grep -n "let threshold = 90" src/adapters/verification/coverage-gate.ts` | PASS |
| Baseline recorded durably | this `missions/task-2535/CP-1.md` | PASS |

## Next action:
Author focused tests for the lowest modules first — `cli-format` (no existing
test file), `stats-backfill`, `github-pr`, and `review-loop` — mocking every
external boundary; see CP-2.
