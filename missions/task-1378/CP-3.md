# CP-3 — Update §2 ranking, §4 red-team, §5 limitations

## Summary

Incorporated UC-7 through UC-10 into the three analysis sections without restructuring them (stop rule: ≤20 lines of the ranking table — the table itself is untouched; a re-evaluation paragraph was added instead).

- **§2 (Ranking):** added a "Re-evaluation with UC-7 through UC-10" paragraph (`docs/use-cases.md:100`) explaining that none of the four new use cases displaces UC-1/UC-2/UC-4 and *why* (UC-8 = UC-1's number; UC-7/UC-10 = weak public differentiators with obvious competing tools; UC-9 = distinctive but narrow). The top-3 table is retained verbatim — satisfies SC7's "if no new use case enters top-3, the table retains" the existing entries.
- **§4 (Red-team):** added two new objections (`docs/use-cases.md:128-133`): UC-8 double-counts UC-1's figure and inflates to ~30/week; UC-10 is UC-5 renamed. Each is answered conceding the overlap by design.
- **§5 (Limitations):** added one honesty constraint per new use case (`docs/use-cases.md:145-148`): UC-7 Forgejo dependency + required diff-tool config; UC-8 permitted-figures rule; UC-9 not-a-separate-code-path; UC-10 no-op-default caveat.

## Goal Check

| Criterion | Status | Evidence |
|---|---|---|
| SC7: §2 updated, top-3 re-evaluated, table retained | Met | `docs/use-cases.md:100` (re-evaluation paragraph); table rows UC-1/UC-2/UC-4 unchanged at `:67-70` |
| SC8: §4 includes new adversarial objections | Met | `docs/use-cases.md:128` (`### New objections raised by UC-7 through UC-10`), objections at `:130`,`:133` |
| SC9: §5 includes new honesty constraints | Met | `docs/use-cases.md:145` (UC-7), `:146` (UC-8), `:147` (UC-9), `:148` (UC-10) |
| Stop rule: ranking table not rewritten >20 lines | Met | Table untouched; only an explanatory paragraph added |
| Cited code lines resolve | Met | `review-adapter.js:16` (skipped status), `diff.js:113-116` (fail on no tool), `draft.js:428` (primary fallback), `verification.js:5-12` (no-op) — all verified in CP-1/CP-3 grep |

Next action: Evaluate CP-4 (conditional README) — since no new use case enters the top-3 (SC7), confirm README requires no changes, then proceed to CP-5 verification.
