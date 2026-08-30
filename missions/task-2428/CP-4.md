# CP-4 — Approval boundary and verification

Added a negative board-path test proving `approve:review` is rejected before
any approval authority is reached. The final safe board subset is empty:
`review:submit` remains unavailable because it means submit-for-review,
`review:act-on-findings` remains unavailable because artifact consumption can
synthesize review context, and `approve:review` remains unavailable because
approval must remain on its checked reviewer/provider path.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC1: Existing CLI/application behavior is characterized before board dispatch changes. | `test/task-2428-review-board-characterization.test.ts` — three “task-2428 characterization” tests | Complete |
| SC2: Enabled board kinds use typed, browser-safe input only. | `test/task-2428-review-board-safety.test.ts` — “task-2428: all review board commands remain typed capability rejections”; `src/application/controller/board-command.ts` | Complete: no review kind is enabled |
| SC3: Start/continue review rules remain intact. | `test/task-2428-review-board-safety.test.ts` — “task-2428: persisted-artifact consumer can synthesize review identity, so board dispatch remains unavailable” | Complete: existing CLI review flow retained |
| SC4: Findings handling uses persisted artifacts, not browser-supplied data. | `test/task-2428-review-board-characterization.test.ts` — “task-2428 characterization: review:act-on-findings CLI consumes persisted reviewer artifacts only” | Complete: no browser findings/resolutions API exposed |
| SC5: Board approval cannot fabricate provider or human approval. | `test/task-2428-review-board-safety.test.ts` — “task-2428: approve:review cannot reach authority or fabricate approval from a board payload” | Complete |
| SC6: Failed board commands leave authoritative state truthful and surface failure. | `test/board-controller.test.ts` — “controller rejects approve:review with capability kind”; `test/task-2428-review-board-safety.test.ts` | Complete |
| SC7: CLI review and history behavior remain unchanged. | `test/task-2332.14-review-use-case.test.ts`; `./scripts/verify-local.sh all` | Complete |

Next action: hand off the committed mission; no review board kind should be enabled without a new checked operation that preserves authoritative review context.
