# CP 5 — Constant-Conditional Findings (`S3923`)

## Summary

Repaired the constant-conditional findings (`S3923`, conditional branches that
return the same value in both arms), which are dead conditionals that signal a
copy-paste or an abandoned branch:

- `src/adapters/cli/commands/stats-backfill.ts` —
  ```ts
  // before
  return uniqueAuthors.length === 1 ? uniqueAuthors[0] : uniqueAuthors[0];
  // after
  return uniqueAuthors[0];
  ```
- `src/adapters/filesystem/mission-paths.ts` —
  ```ts
  // before
  return SUPPORTED_VERIFY_AREAS.has(area) ? area : area;
  // after
  return area;
  ```

Both are behavior-preserving: each conditional returned the same value in both
arms, so dropping it changes nothing observable.

Note: a third identical dead conditional in `src/adapters/agents/agents.ts`
(`exclude instanceof Set ? exclude : exclude`) was evaluated but **left
unchanged** — repairing it shifts the line anchors that
`test/domain-consumer-requirements.test.ts` asserts on and would fail that test
without a broader citation fix. It is outside the demonstrable set for this
mission and was not in scope; it is recorded here for follow-up.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| S3923 dead conditionals removed | `git diff` shows `stats-backfill.ts:87` and `mission-paths.ts` reduced to the single returned value | PASS |
| Behavior unchanged | `test/sonarqube-reliability-repairs.test.ts`, `"normalizeVerifyArea returns an unsupported area unchanged"` | PASS |
| SC4 — no rule disabled | grep `sonar.comments`/`@sonar`/`sonar.exclusions` in changed tree yields none | PASS |
| Full suite green | `` `npm test` `` → 2636 pass, 0 fail | PASS |

## Next action

CP-6: run the mission gates (`static-analysis`, `all`, `npm test`) and confirm
no rule was disabled and the baseline finding list is fully resolved.
