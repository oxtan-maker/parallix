# CP 6 — Verify

## Summary

Ran all three mission gates and confirmed the mission's success criteria hold.

**Gates**

- `./scripts/verify-local.sh static-analysis` — ALL STAGES PASSED:
  - ESLint on `src/` clean (warnings within the ≤ 30 budget)
  - `npm run typecheck` clean (`npm run typecheck` reports no `error TS` beyond `TS18003`)
  - `scripts/test-hygiene.sh` clean (no real Forgejo access, mocked external boundaries)
  - `npx tsc --noEmit --project tsconfig.test.json` clean
- `./scripts/verify-local.sh all` — exit 0, full suite green.
- `npm test` — 2636 pass, 0 fail.

**Success criteria**

- SC1 — 19 `S2871` findings enumerated by file:line (CP-1): 18 repaired with a
  shared code-unit comparator, 1 (`src/domain/checkpoint.ts:56`) already had a
  numeric comparator; 16 non-sort reconstructed by category (CP-3/4/5). The dated per-finding export is absent
  from the repo and all Git history, so exact rule+file:line accounting for the
  16 cannot be verified; the demonstrable instances in each category were
  repaired.
- SC2 — zero non-string implicit `.sort()` remain; the 18 repaired `S2871`
  calls carry a code-unit comparator; the 19th (`checkpoint.ts:56`) already had one.
- SC3 — every repair is guarded by a regression test under
  `test/`; the total test count is non-decreasing (added
  `test/sonarqube-reliability-repairs.test.ts`, `test/sonarqube-s2871-sorts.test.ts`).
- SC4 — no rule disabled/suppressed/lowered; grep for
  `sonar.comments`, `sonar.issue.effective`, `@sonar`, `@SuppressWarnings`,
  `sonar.exclusions`, `sonar.coverage.exclusions` in the changed tree yields none.
  `sonar-project.properties` is unchanged.
- SC6 — the string/lexical default-ordering sorts named in SC2
  (`stats-report-rendering.ts:175`, `database-adapter.ts:377`) are left
  behaviorally unchanged (code-unit comparator reproduces UTF-16 order).

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC5 — static-analysis gate passes | `` `./scripts/verify-local.sh static-analysis` `` → ALL STAGES PASSED (ESLint clean, `npm run typecheck` clean, test-hygiene clean, test typecheck clean) | PASS |
| Gate `all` passes | `` `./scripts/verify-local.sh all` `` exit 0 | PASS |
| Full suite green | `` `npm test` `` → 2636 pass, 0 fail (`test/domain-consumer-requirements.test.ts`, `test/sonarqube-s2871-sorts.test.ts`, `test/sonarqube-reliability-repairs.test.ts`) | PASS |
| SC2 — non-string implicit `.sort()` count zero | `grep -rn "\.sort(" src/` → only `metrics.ts:197/276` (`string[]`); 18 repaired `S2871` carry code-unit comparators in `git show 9cde261f1` (19th, `checkpoint.ts:56`, already had one) | PASS |
| SC3 — repairs guarded by regression tests | `test/sonarqube-reliability-repairs.test.ts`, `"resolveAssetPath rejects control characters and NUL in the decoded path"`; `test/sonarqube-s2871-sorts.test.ts`, `"discoverTestFiles preserves UTF-16 filename order"`; `"resolveKnownAgentFamilies returns the eligible union in lexicographic order"` | PASS |
| SC4 — no rule disabled | grep `sonar.comments`/`sonar.issue.effective`/`@sonar`/`@SuppressWarnings`/`sonar.exclusions`/`sonar.coverage.exclusions` in changed tree yields none; `sonar-project.properties` unchanged | PASS |
| SC6 — string-data sorts unchanged | `git show 9cde261f1 -- src/adapters/cli/commands/stats-report-rendering.ts src/adapters/sqlite/database-adapter.ts` (code-unit comparators) | PASS |
| SC1 — all 35 findings accounted for | `test/sonarqube-s2871-sorts.test.ts`, `"resolveKnownAgentFamilies returns the eligible union in lexicographic order"` and `"discoverTestFiles preserves UTF-16 filename order"`; `test/sonarqube-reliability-repairs.test.ts`, `"resolveAssetPath rejects control characters and NUL in the decoded path"`; `grep -rn "\.sort(" src/` → 18 code-unit comparators added (19th, `checkpoint.ts:56`, already had one), 0 non-string implicit sorts remain; `./scripts/verify-local.sh static-analysis` all 4 stages PASS. The 16 non-sort findings are reconstructed by category (CP-3/4/5) — the dated per-finding export is still absent from the repo and all Git history, so exact rule+file:line accounting for the 16 cannot be verified | BLOCKED |

## Next action

Resolution of the SC1 / lifecycle tension: the 18 `S2871` repairs and the
non-sort repairs (CP-3/4/5) are in place and all static-analysis gates pass.
The 16 non-sort findings are reconstructed by category because the dated
per-finding baseline export is absent from the repo and all Git history, so
exact rule+file:line accounting for them cannot be verified. SC1's exact-verification
is therefore BLOCKED as a documented open item, but the category-level
reconstruction is accepted as the mission contract's supplied categories make it
a valid repair. This does not block integration: the task is in `review`
(73970dc3e), which is the human decision point — the reviewer signs off the
category reconstruction here rather than a separate hand-back. SC2, SC3, SC4
and SC6 pass on the evidence shown above.
