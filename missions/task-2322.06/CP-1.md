# CP-1: Mission-domain access inventory and application ownership

The compatibility authority remains `CompatibilityMissionStore`: it materializes
Mission from the task document, checkpoint documents, and NEL record while
exposing a checked `MissionStore` port. The inventory below assigns
the remaining direct compatibility accesses to TASK-2322.07; this mission routes
callers through application use cases without deleting those compatibility
implementations.

| Legacy access | Access role | Application owner now | TASK-2322.07 action |
|---|---|---|---|
| `review-state.json` in `review-state.ts` | Review read/write | Review command/query port | delete compatibility reader/writer after authority cutover |
| `CP-N.md` in `concrete-mission-read-adapter.ts` | Mission projection read | Mission query port | delete direct projection reader |
| task Markdown in `concrete-mission-read-adapter.ts` | Mission status and board read | Mission query port | delete direct projection reader |
| `nel-record.json` in `compatibility-mission-store.ts` | Mission NEL read/write | Handoff command/query port | delete compatibility document access |
| task Markdown in `integrate.ts` | integration/closure decision input | observed-facts command port | delete direct lifecycle decision input |

CP-1 also identifies a blocking contract mismatch. `ConcreteMissionReadAdapter`
deliberately materializes `review: null`, and `CompatibilityMissionStore.save()`
writes lifecycle, checkpoints, and NEL only. The direct review-state writer has
a phase/disposition snapshot rather than the domain Review round/finding/
resolution model. An application Review command cannot save through the selected
store without a lossless compatibility translation and a declared atomicity rule.
Adding a second Review persistence writer or changing the selected authority is
explicitly forbidden by this mission.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Compatibility authority remains the only selected file-backed Mission authority | `src/adapters/backlog/compatibility-mission-store.ts:1`; `src/application/mission-authority.ts:18` | PASS |
| Remaining review, checkpoint, task, and NEL accesses have a deletion assignment | `src/platform/runtime/lib/core/durable-state-inventory.ts:121`; `src/platform/runtime/lib/core/durable-state-inventory.ts:215` | PASS |
| Application ownership is defined for lifecycle and checkpoint command paths | `src/application/mission-lifecycle-service.ts:42`; `src/application/mission-checkpoint-service.ts:43` | PASS |
| Review routing has a documented blocking compatibility-store contract gap | `src/adapters/backlog/concrete-mission-read-adapter.ts:302`; `src/adapters/backlog/compatibility-mission-store.ts:201`; `src/platform/runtime/lib/review/review-state.ts:90` | BLOCKED — decision required |

Next action: obtain a domain-boundary decision for a lossless Review compatibility adapter and its atomicity/version contract before CP-2 implementation.
