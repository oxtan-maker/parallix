# CP-4: Final verification sweep

Completed the bounded code/test work for the stale backlog-state and dirty `review-events` defects. The repo-local evidence now shows:
- provider-backed review approval repairs stale `active` tasks to `review`;
- the repaired local task state satisfies integration preflight without narrowing the accepted `review + APPROVED` path;
- successful artifact-consumption no longer leaves `missions/<slug>/review-events/*` untracked.

The mission-template `./scripts/verify-local.sh docs` gate is not runnable in this repo because `scripts/verify-local.sh` does not exist here; `README.md` explicitly says repos without that script declare their own command. The branch is already in `review`; this checkpoint now matches that workflow state and no longer claims the mission is awaiting handoff. Gate evidence is mixed: a fresh full `npm test` rerun reached subtest `1589` and then failed in an unrelated intermittent test (`test/task-1109.test.js`), while `node --test test/task-1109.test.js` passes 5/5 in isolation. That is current evidence of a pre-existing flaky suite edge, not of a task-1327 regression.

## Goal Check

| Goal | Evidence | Status |
|---|---|---|
| Provider-backed approval no longer leaves the task file stale in `active` | `lib/review/review-commands.js:91-115` `repairStaleActiveTaskAfterReview`; `test/review.test.js:2982` `submitReviewRound promotes an active backlog task to review after provider-backed approval` | PASS |
| The repaired flow keeps YAML `status:` and rendered `Status:` aligned | `test/review.test.js:3020` `submitReviewRound keeps YAML and rendered task status aligned when provider-backed approval repairs active` | PASS |
| Integration preflight no longer fails on the stale-state symptom | `test/integrate.test.js:468` `provider-backed approval repair leaves integration preflight with review instead of stale active` | PASS |
| Existing accepted `review + APPROVED` integration behavior is preserved | `test/integrate.test.js:455` `evaluateTaskStatusForIntegration accepts review when the latest formal review is approved` | PASS |
| Truly active implementation paths are not silently promoted outside a real review outcome | `lib/review/review-commands.js:104-110` repair only runs when current task is virtual `active` *after* review submission; `test/review.test.js:2067` `review posts zero-finding artifact but does NOT transition task when static review passes` | PASS |
| Successful artifact consumption no longer strands `review-events` dirt | `lib/review/review-commands.js:837-845` auto-commit before success return; `test/task-1209-consume-artifacts.test.js:93` `consumeArtifacts leaves no untracked review-events files after a successful transition` | PASS |
| Task-1327 backlog classification remains exactly `ai_sdlc` | `backlog/tasks/task-1327 - sometimes-the-backlog.md-task-is-in-the-wrong-state.md:8` `labels: [ai_sdlc]` | PASS |
| `./scripts/verify-local.sh docs` gate applicability was checked honestly | `README.md:79-83` documents the `verify-local.sh` default and the repo-without-script substitution rule; repo search confirms `scripts/verify-local.sh` is absent here | N/A |
| `npm test` gate was attempted on the full suite | Fresh rerun failed at `test/task-1109.test.js:132` (`integrate resolves PR and approval using the task assignee Forgejo identity`, expected `gemini`, got `null`) after passing through subtest `1589`; unrelated isolation check `node --test test/task-1109.test.js` passed 5/5 | FAIL |

Next action: Reviewer to decide whether the documented pre-existing `test/task-1109.test.js` flake is acceptable for this mission or should be split into separate stabilization work.
