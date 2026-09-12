# CP-4-round3: agent-capacity rule yields to explicit infra markers (TASK-2494)

## Summary
Round 3 review (codex -> custom, REQUEST_CHANGES) returned one finding.

- F1: the `AgentCapacity` branch matched `\bquota\b` before the `InfraBlocker`
  branch and did not exclude `EXPLICIT_HUMAN_ONLY_DIAGNOSTIC_RE` markers, so
  `Forgejo quota exceeded` / `network error: quota exhausted` were classified as
  `AgentCapacity`/`AutoRepair` — mislabeling a genuine infra/Forgejo failure.

Fix: added a `hasInfraMarker` guard (the exact infra marker set of
`EXPLICIT_HUMAN_ONLY_DIAGNOSTIC_RE`) checked before the `AgentCapacity` branch;
when present the agent-capacity rule does not fire and the message falls
through to `InfraBlocker`/`HumanOnly`.

Changes:
- `src/application/failure-classification.ts`: `hasInfraMarker` guard +
  `!hasInfraMarker` on the AgentCapacity condition.
- `test/task-2494-repro.test.ts`: `"infra marker beats agent-capacity quota
  marker (F1)"` (two cases) + `"a pure agent usage limit still classifies as
  AgentCapacity"` sanity.
- `docs/adr/0048-...md`: documented the explicit-infrastructure guard.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| F1 infra marker wins over quota marker | `test/task-2494-repro.test.ts`, `"infra marker beats agent-capacity quota marker (F1)"` asserts `Forgejo quota exceeded` and `network error: quota exhausted` → `InfraBlocker`/`HumanOnly`, `hasExplicitHumanOnlyDiagnostic === true` | PASS |
| Pure usage limit still AgentCapacity | `test/task-2494-repro.test.ts`, `"a pure agent usage limit still classifies as AgentCapacity"` | PASS |
| No regression across suite | `./scripts/verify-local.sh all` — `tests 2499 / pass 2499 / fail 0`, gate exit 0 | PASS |
| SC6 behavior change documented | `docs/adr/0048-fail-closed-harness-defense-against-agent-hallucinations.md` "Agent-capacity diagnostics are not infrastructure blockers (task-2494)" documents the explicit-infrastructure guard | PASS |

## Next action
Commit the round-3 fix and hand back to the active reviewer for the next formal decision.
