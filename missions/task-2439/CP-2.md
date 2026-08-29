# CP-2: Validate parenthesized gate documentation before execution

Extended declared-gate validation to reject a trailing parenthesized documentation suffix containing a label/value separator. The gate text remains intact in the diagnostic, and no Bash process is invoked. Exact commands and existing outcome-prose rejection remain covered by the focused regression test.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC1 reproduction is green after validator change | `test/task-2439-rebounce-review-submit-repro.test.ts`, test name `task-2439 repro: review-submit declared-gate prose is a reboundable validation failure, never a Bash command`; `node --test --import tsx test/task-2439-rebounce-review-submit-repro.test.ts` | PASS |
| SC2 rejects the parenthesized declaration before Bash | `src/application/handoff-command-use-case.ts`, `test/task-2439-rebounce-review-submit-repro.test.ts` | PASS |
| SC6 retains exact command acceptance and outcome-suffix rejection | test name `task-2439 validator keeps exact commands and rejects documented outcomes` | PASS |

Next action: route structured declared-gate validation and execution failures from review-submit through the rebound kernel.
