# CP-1: Red PR-history review-prompt reproduction

Added `test/task-2359-repro.test.ts`, which renders both `buildReviewPrompt()`
and `buildCompactReviewPrompt()` for a review baseline named
`review-baseline-sha`. The test locks the intended context-only PR-history
contract, finding-grounding boundary, three mandatory-finding paths, and
Rebasing Artifacts guidance without changing `prompts/review.md`.

The focused command was red before the prompt change: 4 of 6 subtests failed.
In particular, `task-2359: rendered review prompts treat unrelated PR history
as context only (buildReviewPrompt + buildCompactReviewPrompt)` failed because
the rendered prompt still contained the unqualified instruction to report any
PR-history inconsistency as a finding. The materially-false-checkpoint-evidence
and rebasing-artifact subtests passed, proving those existing protections are
already present.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC1 red-to-green reproduction covers unrelated PR history through both builders | `test/task-2359-repro.test.ts`; `npx tsx --test test/task-2359-repro.test.ts` failed with the named context-only test | RED |
| SC2 grounds findings in the mission diff, checkpoint evidence, or unidentified revision | `test/task-2359-repro.test.ts` test `task-2359: rendered review prompts ground findings in the mission diff, checkpoint evidence, or unidentified reviewed revision` | RED |
| SC3 removes or qualifies unbounded PR-history finding instructions | `prompts/review.md`; `test/task-2359-repro.test.ts` context-only test | RED |
| SC4 retains all mandatory-finding paths | `test/task-2359-repro.test.ts` tests named for material worsening, materially false checkpoint evidence, and unidentified reviewed revision | PARTIAL (checkpoint-evidence path passes; two paths are red) |
| SC5 retains Rebasing Artifacts guidance | `test/task-2359-repro.test.ts` test `task-2359: rendered review prompts retain rebasing-artifact guidance` | PASS |
| SC6 full verifier passes | `./scripts/verify-local.sh all` | NOT RUN |
| SC7 static analysis passes | `./scripts/verify-local.sh static-analysis` | NOT RUN |

Next action: narrow only `prompts/review.md` so the four red assertions turn green, then run the prompt-adjacent suites.
