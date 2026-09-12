# CP-4-round1: F1 fix — replacement selection honors eligibility policy (TASK-2494)

## Summary
Round 1 review (codex -> custom, REQUEST_CHANGES) returned one finding, F1:
`selectReplacementFamily` called `selectAgent({ role: 'implementer' })`, which
bypassed the configured eligibility policy (the production selector is
`selectAgent(step, options)`, so the object was read as the step and the pinned
implementer was never excluded). Fixed by invoking the selector with the real
workflow step and an exclusion set, and by extending the repro tests to exercise
that contract.

Changes:
- `src/application/ports/rebase-workflow.ts`: typed `selectAgent` as
  `selectAgent(_step, _options?: { exclude?: Set<string>; worktree?: string })`
  to match the production `(step, options)` signature.
- `src/application/rebase-workflow.ts`: `selectReplacementFamily` now calls
  `port.selectAgent?.('conflict-resolution', { exclude: new Set([implementer]) })`.
- `test/task-2494-repro.test.ts`: replacement fake honors the contract and
  asserts the step + exclusion; added a selector-exclusion test. Also fixed a
  pre-existing unused-arg lint error on the `onReplacement` type param.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| F1 selector uses real workflow step + excludes pinned implementer | `test/task-2494-repro.test.ts`, `"TASK-2494 repro: usage-blocked pinned implementer substitutes an eligible replacement family when policy permits"` (asserts `selectAgent` called with `conflict-resolution` step and `codex` excluded) | PASS |
| F1 selector never returns the excluded pinned implementer | `test/task-2494-repro.test.ts`, `"TASK-2494 repro: selector never returns the excluded pinned implementer"` | PASS |
| No regression across rebase suite | `./scripts/verify-local.sh all` — `tests 2495 / pass 2495 / fail 0`, gate exit 0 | PASS |
| SC5 ESLint + tsc clean on changed files | ESLint clean on `rebase-workflow.ts`, `ports/rebase-workflow.ts`, `test/task-2494-repro.test.ts`; `tsc --checkJs` clean | PASS |

## Next action
Commit the F1 fix and hand back to the active reviewer for the next formal decision.
