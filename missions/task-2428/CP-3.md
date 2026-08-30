# CP-3 — Lifecycle safety boundary

Withdrawn `review:act-on-findings` after verifying that the existing artifact
consumer can create review state and default a reviewer identity when the
authoritative review context is absent. That behavior cannot preserve the
current-work phase, reviewer-family constraint, or reviewed-revision identity
from a browser command. All review board kinds are intentionally unavailable.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC1: Existing CLI/application behavior is characterized before board dispatch changes. | `test/task-2428-review-board-characterization.test.ts`; `npm test -- --unit-test-headroom test/task-2428-review-board-characterization.test.ts` | Complete |
| SC2: Enabled board kinds use typed, browser-safe input only. | `test/task-2428-review-board-safety.test.ts` — “task-2428: all review board commands remain typed capability rejections”; `src/application/controller/board-command.ts` | Complete: no review kind enabled |
| SC3: Start/continue review rules remain intact. | `test/task-2428-review-board-safety.test.ts` — “task-2428: persisted-artifact consumer can synthesize review identity, so board dispatch remains unavailable”; `src/adapters/review/review-commands.ts` | Complete by retaining CLI-only flow |
| SC4: Findings handling uses persisted artifacts, not browser-supplied data. | `test/task-2428-review-board-characterization.test.ts` — “task-2428 characterization: review:act-on-findings CLI consumes persisted reviewer artifacts only” | Complete: no browser findings API exposed |
| SC5: Board approval cannot fabricate provider or human approval. | `src/application/controller/board-command.ts`; `test/task-2428-review-board-safety.test.ts` — “task-2428: all review board commands remain typed capability rejections” | Pending CP-4 dedicated negative test |
| SC6: Failed board commands leave authoritative state truthful and surface failure. | `test/board-controller.test.ts` — “controller rejects review:act-on-findings with capability kind” | Complete: command is rejected before workflow/state access |
| SC7: CLI review and history behavior remain unchanged. | `test/task-2332.14-review-use-case.test.ts`; `./scripts/verify-local.sh all` | Pending final gate |

Next action: add the explicit negative approval board-path test and record all three review kinds as intentionally unavailable before running the mission gate.
