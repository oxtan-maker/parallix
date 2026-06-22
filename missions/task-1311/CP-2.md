# CP-2: Implementation complete — implementer re-launch replaces review-loop trigger

## Summary

Replaced the static-review findings branch so it re-launches the implementer agent with a
targeted fix prompt instead of submitting for review and starting the full review loop. Added the
required dependency injection. The `ok: true` branch and all other flag handlers are untouched.

### DI additions

Added to the `review()` DI block (`lib/review/review-commands.js:1100-1102`):
```js
const startAgentFn = options.startAgentFn || startAgent;
const resolveTaskFileFn = options.resolveTaskFileFn || resolveTaskFile;
const getTaskImplementerFn = options.getTaskImplementerFn || getTaskImplementer;
```
All three underlying functions were already imported (`startAgent` at line 21;
`resolveTaskFile`/`getTaskImplementer` at line 12).

### Findings branch (new logic)

`lib/review/review-commands.js:1218-1233`:
- Resolve the task file via `resolveTaskFileFn(slug, worktreeForStatic)` and read the implementer
  via `getTaskImplementerFn(taskResolution.taskFile)`.
- If implementer is null/undefined ⇒ emit a `WARN` log and do nothing (no `startAgentFn`, no
  `startReviewLoopFn`, no submit, no comment).
- Otherwise build a prompt that lists each finding as its own `- ` line and call
  `await startAgentFn('active', { prompt, worktree: worktreeForStatic, agent: implementer, slug })`.
- `submitForReviewFn`, `postStaticReviewCommentFn`, and `startReviewLoopFn` are no longer called on
  this path.

## Goal Check

| Item | Status | Evidence |
| --- | --- | --- |
| `startAgentFn` injectable, defaults to `startAgent` | ✅ | `lib/review/review-commands.js:1100` |
| `resolveTaskFileFn`/`getTaskImplementerFn` injectable | ✅ | `lib/review/review-commands.js:1101-1102` |
| Implementer resolved from task file | ✅ | `lib/review/review-commands.js:1221-1223` |
| `startAgentFn('active', {...})` re-launch, not review loop | ✅ | `lib/review/review-commands.js:1231` |
| Prompt lists each finding as a line item | ✅ | `lib/review/review-commands.js:1229-1230` |
| WARN + no-op fallback when implementer unresolved | ✅ | `lib/review/review-commands.js:1224-1225` |
| `startReviewLoopFn` removed from findings path | ✅ | absent in `lib/review/review-commands.js:1218-1233` |
| `ok: true` branch unchanged | ✅ | `lib/review/review-commands.js:1234-1246` |

Next action: implement CP-3 — rewrite the conflicting `test/review-commands.test.js:194` test to assert the new contract and add a WARN-fallback test, then run `npm test` to confirm new + existing tests pass.
