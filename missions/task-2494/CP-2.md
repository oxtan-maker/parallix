# CP-2: Rebase-handoff family fallback (TASK-2494)

## Summary
Fixed the `px rebase` shared-file conflict path in `src/application/rebase-workflow.ts`. When `startAgent('conflict-resolution', { pinnedAgent: true })` throws a PinnedAgentUnavailableError, the catch block now:
1. Detects an agent usage-block (regex on `usage limit` / `blocked until`).
2. Selects an eligible replacement family via the existing eligibility/selection surface (`port.selectAgent({ role: 'implementer' })` + `port.workflowLauncherStatus`) and relaunches conflict-resolution unpinned when policy permits.
3. Otherwise emits a final diagnostic naming the usage block and its reset time, without the old hard-refusal phrase and without any `forgejo`/`infrastructure`/`credential` token.

Non-usage-block launch errors keep the original fail-and-abort path. The `agents.ts` `startAgent` retry/fallback core and `pinnedAgent` refusal semantics are untouched (restricted area).

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC1 substitution when policy permits | `test/task-2494-repro.test.ts`, `"TASK-2494 repro: usage-blocked pinned implementer substitutes an eligible replacement family when policy permits"` | PASS |
| SC2 reset-time diagnostic, no forbidden tokens | `test/task-2494-repro.test.ts`, `"TASK-2494 repro: usage-blocked pinned implementer during rebase conflict names the usage block and reset time, never infra/Forgejo"` | PASS |
| No hard-refusal phrase emitted | `src/application/rebase-workflow.ts` catch block; verified by the SC2 test assertion `/does not substitute/` absent | PASS |
| agents.ts startAgent core untouched | git diff `fbff97f97~1..fbff97f97` touches only `rebase-workflow.ts` + `failure-classification.ts` | PASS |

## Next action
CP-3: fix the ADR 0048 failure-classifier so agent-capacity diagnostics are not misclassified as infrastructure.
