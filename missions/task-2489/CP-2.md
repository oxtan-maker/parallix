# CP-2: Persistent lead and safe Codex resume

## Summary

`px lead` now watches the actionable lifecycle lanes (`active` and `review`)
continuously. It leaves `refined` for an operator to start and leaves
`ready-for-integration` for an operator to integrate.

Forward workflow commands are launched without blocking fleet observation. A
current-work publication keeps the board from dispatching the same mission
twice while that command runs. The supervisor now recognises that a mission
with live current work is intentionally absent from the attention queue: it is
watched rather than treated as cleared and launched again.

The branch was rebased onto `main`. The Codex launcher correction already
existed as commit `b1a588c6e` on unmerged `mission/task-2511` and was
cherry-picked as `511f31b6a`. It places Codex's native sandbox option on
`codex exec` only when it is the Bubblewrap fallback; it never passes that
option to `codex exec resume`, whose CLI rejects it.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Refined missions await operator activation | `test/task-2489-recovery-supervisor.test.ts`, `px lead --dry-run omits refined missions awaiting operator activation` | PASS |
| Integration remains a human handoff | `test/task-2489-recovery-supervisor.test.ts`, `the supervisor never integrates: an integration item is left for the human` | PASS |
| Lead stays responsive while a forward workflow runs | `test/task-2489-recovery-supervisor.test.ts`, `lead starts long forward workflows without blocking fleet supervision` | PASS |
| Live current work hidden from the queue is not falsely cleared or relaunched | `test/task-2489-recovery-supervisor.test.ts`, `a mission hidden by live work is watched, not cleared` | PASS |
| Codex resume uses valid argv under native-sandbox fallback | `test/codex.test.ts`, `startCodexDraftAgent places the fallback sandbox on exec before resume` | PASS |
| Focused unit suite | `npm test -- --unit-test-headroom test/codex.test.ts test/agents.test.ts test/task-2489-recovery-supervisor.test.ts`: 179 pass, 1 skipped | PASS |

## Follow-up

The focused suite is green. Static analysis was started locally; its final
test-hygiene result is left for the operator's continuing test run.
