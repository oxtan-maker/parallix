# CP-3: Fail-closed lifecycle persistence

Added a single persistence guard that accepts committed/unchanged results and throws on structured persistence failures with mission, phase, round, failed stage, and the underlying diagnostic. Migrated every review-state write in review artifacts, review commands, and the review loop through that guard; `review-events.ts` has no `writeReviewState` caller to migrate. This prevents verdict recording, submission, telemetry checkpoints, retry checkpoints, phase transitions, terminal dispositions, round advancement, and validation-failure auto-bounces from continuing after a known persistence failure. Legacy injected JavaScript spies that return no structured result remain compatible, while production writers are typed to the structured API.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Persistence failures throw with slug, phase, round, stage, and diagnostic | `lib/review/review-state.ts:43`, `lib/review/review-state.ts:55`, "durable review checkpoints fail closed with mission phase round stage and diagnostic" | PASS |
| Verdict recording fails before event creation when persistence fails | `lib/review/review-artifacts.ts:206` | PASS |
| Review command state writes inspect structured persistence results | `lib/review/review-commands.ts:1009`, `lib/review/review-commands.ts:1200`, `lib/review/review-commands.ts:1272` | PASS |
| Review-loop phase, auto-bounce, and durable terminal checkpoints fail closed | `lib/review/review-loop.ts:780`, `lib/review/review-loop.ts:1112`, `lib/review/review-loop.ts:1521` | PASS |
| Validation-failure auto-bounce inspects its structured persistence result | `lib/review/review-loop.ts:780`, "task-2234 repro: review-loop self-heal fails closed when validation-failure state cannot commit" | PASS |
| Fail-closed regression tests pass | `node --test test/task-2220-repro.test.js`, "durable review checkpoints fail closed with mission phase round stage and diagnostic" | PASS |

Next action: Migrate `resetReviewState()` to a structured atomic deletion result, update boolean-era review-state assertions, add all five focused persistence-mode tests, and then clear the static-analysis, focused, and default gates.
