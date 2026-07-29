# CP-2: Add compaction and durable reload requirements

Added explicit compact-and-reload instructions at the successful declared-gate, implementation-to-act-on-review, and later-review-round boundaries. The implementation transition is explicitly independent of mission gate declarations. Repairable pre-review gate bounces and reviewer/implementer timeout recoveries now require compaction before repair/resume while retaining their diagnostic, retry, review state, and revision context. Workflow reference documentation now describes the same behavior.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Successful declared gates compact only after success and preserve mission/evidence state | `prompts/execute.md:27` | PASS |
| Act-on-review compacts independently of `MISSION.md` gates and reloads durable review state | `prompts/act-on-review.md:11` | PASS |
| Reviewer round 2+ compacts after rebase/baseline capture and reloads rewritten revision context | `prompts/review.md:13`, `src/platform/runtime/lib/review/review-loop.ts:1155` | PASS |
| Repairable bounce and recovery retain diagnostic/retry state before relaunch | `src/platform/runtime/lib/review/review-loop.ts:448`, `src/platform/runtime/lib/review/review-loop.ts:1291`, `src/platform/runtime/lib/review/review-loop.ts:1534` | PASS |
| Workflow documentation describes all independent boundaries | `docs/authority-reference.md:116`, `docs/authority-reference.md:122` | PASS |

Next action: Add focused regression coverage for prompt boundaries, gate-failure bounce, recovery relaunch, and post-rebase round-two baseline handling, then run the mission gate.
