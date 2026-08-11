# CP-8 — Regression sensitivity

Proved the critical regressions turn red under their prior production behavior, then restored the committed implementation and reran the focused tests. Reversing the CP-3 `metrics.ts` change caused nine window assertions to fail (including `n=299` rather than `n=31` and a 890-minute rather than 40-minute median). Reversing the CP-6 statistics producer changes caused the canonical identity assertions to receive the configured display alias and caused omitted review-fix rounds to persist as zero instead of SQL NULL.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| All-history aggregation is detected | `test/task-2363-weekly-decision-window.test.ts`, "reports the current-window cycle-time population, not all history" (red under prior `metrics.ts`) | PASS |
| Extreme history sensitivity is exact | `test/task-2363-weekly-decision-window.test.ts`, red oracle: actual 890 min vs expected 40 min | PASS |
| Unknown review-fix collapse is detected | `test/task-2363-review-fix-rounds.test.ts`, "writes SQL NULL when a stage row has no review-fix count yet" (red with actual 0) | PASS |
| Split repository identity is detected | `test/task-2363-repository-identity.test.ts`, "writes new measurement rows under the canonical repository id, not product.name" (red with display alias) | PASS |
| Restored implementation passes | `npx tsx --test test/task-2363-weekly-decision-window.test.ts test/task-2363-review-fix-rounds.test.ts test/task-2363-repository-identity.test.ts` | PASS |

Next action: run the final mission gate and inspect documentation impact for the rolling-window semantics before CP-9 handoff.
