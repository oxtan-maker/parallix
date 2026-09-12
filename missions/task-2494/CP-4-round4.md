# CP-4-round4: agent rate limits classify as AgentCapacity, not infra (TASK-2494)

## Summary
Round 4 review (codex -> custom, REQUEST_CHANGES) returned one finding.

- F1: the round-3 `hasInfraMarker` guard matched a bare `rate limit` as an infra
  marker before the AgentCapacity branch. Agent-branded / provider rate limits
  (`Codex rate limit exceeded`, `Claude rate limit reached`, Qwen
  `429 ... Requests rate limit exceeded`) therefore fell through to
  `InfraBlocker`/`HumanOnly`, leaving the rate-limit part of the classifier fix
  unimplemented.

Fix:
- Removed bare `rate limit` from the infra marker guard (inline in
  `classifyError` and in `EXPLICIT_HUMAN_ONLY_DIAGNOSTIC_RE`).
- Added agent-branded rate-limit patterns to the AgentCapacity branch:
  `rate limit reached|exceeded`, alongside the existing quota / 429
  rate/quota/usage / usage-limit / resource-exhausted markers (following
  `agent-limit.ts`).
- Infra-branded rate limits (carrying a network/infrastructure/token marker)
  still classify as `InfraBlocker`/`HumanOnly`.

Changes:
- `src/application/failure-classification.ts`: drop `rate limit` from infra
  guard + const; add `rate limit reached|exceeded` to AgentCapacity condition.
- `test/task-2494-repro.test.ts`:
  - `"agent-branded rate limits classify as AgentCapacity (F1 round 4)"`
  - `"infra-branded rate limit still classifies as InfraBlocker"`
- `docs/adr/0048-...md`: documented that `rate limit` is not an infra marker.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| F1 agent-branded rate limits → AgentCapacity | `test/task-2494-repro.test.ts`, `"agent-branded rate limits classify as AgentCapacity (F1 round 4)"` asserts `Codex rate limit exceeded`, `Claude rate limit reached`, `mistral rate limit exceeded`, `429 Requests rate limit exceeded` → `AgentCapacity`/`AutoRepair`, `hasExplicitHumanOnlyDiagnostic === false` | PASS |
| F1 infra-branded rate limit → InfraBlocker | `test/task-2494-repro.test.ts`, `"infra-branded rate limit still classifies as InfraBlocker"` asserts `network error: rate limit exceeded ...` → `InfraBlocker`/`HumanOnly`, `hasExplicitHumanOnlyDiagnostic === true` | PASS |
| No regression across suite | `./scripts/verify-local.sh all` — `tests 2501 / pass 2501 / fail 0`, gate exit 0 | PASS |
| SC6 behavior change documented | `docs/adr/0048-fail-closed-harness-defense-against-agent-hallucinations.md` documents `rate limit` not being an infra marker; agent-branded rate limits follow `agent-limit.ts` | PASS |

## Next action
Commit the round-4 fix and hand back to the active reviewer for the next formal decision.
