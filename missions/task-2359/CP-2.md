# CP-2: Green scoped PR-history reviewer contract

Updated only `prompts/review.md`. The review contract now explicitly grounds
findings in the reviewed diff, mission/checkpoint evidence, or inability to
identify the reviewed revision. It makes PR metadata, commit ancestry, and
historical commits outside the review diff context only, prohibiting a finding,
request-changes verdict, or workflow block for that history alone. The two
permitted PR-history exceptions remain explicit: the mission introduced or
materially worsened the inconsistency, or the review surface cannot identify
the exact reviewed revision.

Removed both unqualified instructions that told reviewers to report any
workflow-state, prompt, or PR-history inconsistency as a finding. The existing
materially-false checkpoint-evidence and Rebasing Artifacts guidance remains
unchanged. No live authored documentation describes the removed behavior;
`rg` found no such wording outside mission/backlog history, so no docs change
was needed.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC1 red-to-green reproduction covers unrelated PR history through both builders | `test/task-2359-repro.test.ts`; `npx tsx --test test/task-2359-repro.test.ts` — 6 passing tests | PASS |
| SC2 grounds findings in the mission diff, checkpoint evidence, or unidentified revision | `test/task-2359-repro.test.ts` test `task-2359: rendered review prompts ground findings in the mission diff, checkpoint evidence, or unidentified reviewed revision` | PASS |
| SC3 removes or qualifies unbounded PR-history finding instructions | `prompts/review.md`; `test/task-2359-repro.test.ts` context-only test | PASS |
| SC4 retains all mandatory-finding paths | `test/task-2359-repro.test.ts` tests named for material worsening, materially false checkpoint evidence, and unidentified reviewed revision | PASS |
| SC5 retains Rebasing Artifacts guidance | `test/task-2359-repro.test.ts` test `task-2359: rendered review prompts retain rebasing-artifact guidance`; `test/review-prompts.test.ts` test `review prompts instruct reviewers to ignore rebasing artifacts that are not mission changes (task-1430)` | PASS |
| SC6 full verifier passes | `./scripts/verify-local.sh all` | NOT RUN |
| SC7 static analysis passes | `./scripts/verify-local.sh static-analysis` | NOT RUN |

Next action: run the declared docs, static-analysis, and full verification gates and record their results in CP-3.
