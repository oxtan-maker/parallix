# CP-2 — Draft UC-7 through UC-10 in §1

## Summary

Added four new use cases to §1 of `docs/use-cases.md`, immediately after UC-6, each in the established (P)(B)(E)(C) format with non-README, file:line / test-name citations sourced in CP-1. No use case required Aspirational marking — all four are evidenced. UC-7 and UC-8 carry Partial confidence (Forgejo dependency; measured-but-caveated throughput); UC-9 and UC-10 are Confirmed.

The document now contains exactly ten use cases UC-1 … UC-10. No existing use case was modified or removed.

## Goal Check

| Criterion | Status | Evidence |
|---|---|---|
| SC1: exactly ten use cases UC-1…UC-10 | Met | `docs/use-cases.md` headings UC-1 (`:18`) … UC-6 (`:53`), UC-7 (`:60`), UC-8 (`:66`), UC-9 (`:72`), UC-10 (`:78`) |
| SC2: each new UC has (P)(B)(E)(C) | Met | UC-7 `docs/use-cases.md:61-64`, UC-8 `:67-70`, UC-9 `:73-76`, UC-10 `:79-82` |
| SC3: UC-7 cites `px diff` evidence | Met | `docs/use-cases.md:63` → `lib/commands/diff.js:42-43,89-111`, `index.js:39,158,224`, `test/diff.test.js` |
| SC4: UC-8 cites measurable throughput, reconciles ~27/~30 | Met | `docs/use-cases.md:69` → `research.md:51-57` (~27/wk), `RETROSPECTIVE_Q2_2026.md:18-23`; reconciliation sentence present |
| SC5: UC-9 cites feature-branch evidence | Met | `docs/use-cases.md:75` → `lib/commands/draft.js:173-188,223,411-430,439-468`, `mission-utils.js:67-99`, `test/draft.test.js` |
| SC6: UC-10 cites QA-gate evidence | Met | `docs/use-cases.md:81` → `scripts/verify-local.sh:14-64`, `.eslintrc.cjs:10-19`, `lib/core/verification.js:5-35`, `test/verification.test.js` |
| Stop rule: no fabricated/Aspirational | Met | All four Confirmed/Partial against real cited code; CP-1 confirmed evidence exists |

Next action: Update §2 ranking re-evaluation, §4 red-team, and §5 limitations (CP-3 work — already drafted; verify line citations resolve in CP-3.md).
