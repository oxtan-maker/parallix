## Summary

Added durable dedup to `consumeHumanNotes` using `author\tsha256(body)` as stable dedup key (replacing unsafe `user:created` which collided at minute resolution). Dedup list stored in review state metadata (`metadata.processedCommentBodies`) capped at 20 entries. In-place metadata merge via `currentState` option so review loop's subsequent persist includes dedup data. `writeReviewStateFn` wired through composition bindings (`reviewLoopBindings`) and artifact consumers (`consumeReviewerArtifacts`, `consumeImplementerArtifacts`).

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC4: consumeHumanNotes tracks processed comments by stable dedup key | `src/adapters/review/review-events.ts:408` — dedup by `author\thash(body)`, `src/adapters/review/review-events.ts:454` — merged into `metadata.processedCommentBodies` in-place | PASS |
| Dedup test: same comment processed twice creates one event | `test/task-2342-consume-human-notes-dedup.test.ts`, `"consumeHumanNotes dedup by comment body on re-invocation"` | PASS |
| Dedup test: dedup survives across invocations via metadata | `test/task-2342-consume-human-notes-dedup.test.ts`, `"consumeHumanNotes dedup survives across invocations via metadata"` | PASS |
| Dedup test: workflow comments tracked | `test/task-2342-consume-human-notes-dedup.test.ts`, `"consumeHumanNotes skips workflow-generated comments and dedup by body"` | PASS |
| Existing tests pass | `test/review-events.test.ts` — 29/29 pass | PASS |

Next action: Run `./scripts/verify-local.sh all`, fix any lint/type errors (CP-4).
