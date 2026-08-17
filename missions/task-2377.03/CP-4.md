# CP-4: Fix-prompt consolidation

## Summary

- The duplicated gate/hook prompt construction is gone from the incident path. Both the pre-review gate bounce and the pre-review Git-hook bounce now render `buildReboundFixPrompt()` in `src/application/rebound-kernel.ts`, filled from slots derived from the structured reason (`promptSlotsFor`): failure label, mission slug, per-kind facts (gate area/command/exit code, hook identity and rejected Git operation), elided diagnostic, ADR 0048 classification, attempt `n/max`, remedy sentence.
- The context-compaction boilerplate exists in exactly one source location. Previously it lived in the deleted `handleGateFailureAutoBounce`; the pre-review hook prompt had none at all, so the hook bounce now gains it for free.
- The automatic re-verify statement ("The failing check re-runs automatically after your fix; this bounce is only reported as fixed when that re-run passes.") is part of every kernel prompt, and it is now a true statement rather than the old "restart the review loop; it will re-run the rebase and gate" instruction to the agent — the kernel performs the re-run itself.
- Added two source-scan guards so the consolidation cannot silently regress: the compaction sentence may exist in exactly one file, and neither review-loop nor review-gate-handling may render `FIX REQUIRED` or a `Retry attempt:` counter.
- Out of scope and deliberately untouched: `src/application/hook-failure-workflow.ts` still builds its own prompt for the standalone `px rebase` / `px integrate` hook bounces. Those call sites are TASK-2377.05; the mission's SC6 is scoped to the pre-review gate and hook prompts.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC6 — one builder serves all kinds with the required slots | `src/application/rebound-kernel.ts` (`buildReboundFixPrompt`, `promptSlotsFor`); `"task-2377.03: the hook fix prompt uses the same builder with hook slots"` | PASS |
| SC6 — the compaction boilerplate occurs in exactly one source location | `test/task-2377.03-rebound-kernel.test.ts`: `"task-2377.03: the context-compaction boilerplate exists in exactly one source location"` | PASS |
| SC6 — the gate and hook call sites no longer duplicate prompt text | `"task-2377.03: the pre-review gate and hook paths build no prompt of their own"` | PASS |
| SC6 — the automatic re-verify statement is present | `"task-2377.03: the single fix-prompt builder carries the compaction boilerplate and the automatic re-verify statement"`; `test/task-1385-pre-review-gate.test.ts`: `"reboundPreReviewFailure includes gate output and the ADR 0048 gate classification in the fix prompt"` | PASS |
| Existing compaction expectations still hold on the migrated path | `npm test -- test/task-2317-context-compaction.test.ts test/task-2377.03-rebound-kernel.test.ts` → 6 + 24 pass, 0 fail (`"task-2317: repairable gate-error bounce compacts before repair and retains diagnostic plus retry state"`) | PASS |
| Deferred, recorded rather than silently widened | `src/application/hook-failure-workflow.ts` prompt remains for the CLI rebase/integrate paths — TASK-2377.05 | DEFERRED |

Next action: CP 5 — run `./scripts/verify-local.sh all` on the final tree, update authored docs for the verify-gated bounce policy and per-occurrence budget (then `./scripts/verify-local.sh docs`), and write the final Goal Check table covering SC1–SC9.
