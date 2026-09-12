# CP-4-round5: underscore rate-limit signature covered (TASK-2494)

## Summary
Round 5 review (codex -> custom, REQUEST_CHANGES) returned one finding.

- F1: `agent-limit.ts` recognizes Codex's `rate_limit exceeded` / `rate_limit
  reached` form via `\brate[_ ]?limit`, but the round-4 capacity rule only
  matched `rate\s+limit`. A diagnostic containing `Codex rate_limit exceeded`
  therefore still fell through to `InfraBlocker`/`HumanOnly`.

Fix: changed the AgentCapacity rate-limit pattern from `rate\s+limit` to
`rate[_\s]?limit`, matching `rate limit`, `rate_limit`, and `ratelimit` —
aligning with the `agent-limit.ts` signature. Covered in the rate-limit
regression test with a `Codex rate_limit exceeded` case.

Changes:
- `src/application/failure-classification.ts`: `rate\s+limit` → `rate[_\s]?limit`
  in the AgentCapacity branch.
- `test/task-2494-repro.test.ts`: added `Codex rate_limit exceeded` to the
  `"agent-branded rate limits classify as AgentCapacity (F1 round 4)"` cases.
- `docs/adr/0048-...md`: documented the `rate limit` / `rate_limit` / `ratelimit`
  coverage.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| F1 underscore rate limit → AgentCapacity | `test/task-2494-repro.test.ts`, `"agent-branded rate limits classify as AgentCapacity (F1 round 4)"` asserts `Codex rate_limit exceeded` → `AgentCapacity`/`AutoRepair`, `hasExplicitHumanOnlyDiagnostic === false` | PASS |
| No regression across suite | `./scripts/verify-local.sh all` — `tests 2501 / pass 2501 / fail 0`, gate exit 0 | PASS |
| SC6 behavior change documented | `docs/adr/0048-fail-closed-harness-defense-against-agent-hallucinations.md` documents `rate limit` / `rate_limit` / `ratelimit` coverage | PASS |

## Next action
Commit the round-5 fix and hand back to the active reviewer for the next formal decision.
