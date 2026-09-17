# CP-2 — First slice refactor + regression tests

## Summary

Implemented Slice A from CP-1: refactored `validateDeclaredGates`
(`src/application/handoff-command-use-case.ts:248`, peak cx 22) by extracting the
original inline scan into eight private helpers, one per failure mode:

- `proseError` / `gateCommandHasProse` / `unquoteForProseScan` — prose detection
- `quoteError` / `gateUnclosedQuoteType` — unclosed-quote detection
- `delimiterError` / `firstUnbalancedDelimiter` — the three delimiter-balance
  checks collapsed into one shared pass (the genuine complexity reduction)
- `missingFileError` / `gateCommandMissingFile` — file-reference existence

The public method now reads as a linear sequence of guard calls; order, error
messages, and the `{ok, reason, error, gate}` return shape are unchanged. An
explicit `GateValidationResult` return type pins the union so callers can read
`result.error`/`result.gate` across both variants.

Behavior is preserved: the existing `test/handoff.test.ts` gate-validation cases
still pass, and 12 new focused cases in `test/gate-validation-refactor.test.ts`
pin every extracted branch.

## Before / after

- Before: one 164-line method, cx ≈ 22, six inline `return {ok:false,…}` blocks
  nested in the command loop.
- After: 14-line guard-sequence method + eight helpers, each well under the
  complexity threshold; `firstUnbalancedDelimiter` replaces three near-identical
  parens/braces/brackets checks with one shared counter.

## Behavior preservation

The refactor relocated control flow into helpers; SC5 forbids relocating
complexity without a behavior change. Each extracted branch is independently
exercised by a focused test, so the S3776 drop is evidenced by passing tests
(SC1/SC5), not by moving code.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Slice refactors a real control-flow path | `src/application/handoff-command-use-case.ts` `validateDeclaredGates` (cx 22 → guard sequence) | PASS |
| Every changed branch has a focused regression test | `test/gate-validation-refactor.test.ts`, 12 cases: `refactor quoteError branch rejects unclosed single quote`, `refactor firstUnbalancedDelimiter branch rejects unmatched braces`, `refactor missingFileError branch skips URLs, flags, and globs`, etc. | PASS |
| Existing behavior preserved | `test/handoff.test.ts` gate-validation cases still assert `validation-failed` / `all-gates-valid` | PASS |
| Static-analysis gate passes | `./scripts/verify-local.sh static-analysis` → ALL STAGES PASSED (ESLint clean, tsc typecheck clean, test-hygiene clean, test typecheck clean) | PASS |
| No metric-only / suppression-only change | behavior evidenced by passing tests (SC1); `sonar-project.properties` untouched | PASS |

### Verifiable command

```
./scripts/verify-local.sh static-analysis
node --import tsx --test test/gate-validation-refactor.test.ts   # 12 pass / 0 fail
```

## Next action
Slice budget (ADR 0047) exhausted after this slice; promote remaining S3776 findings to a bounded follow-up in CP-4.
