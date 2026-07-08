# CP-7: Manual review corrections

## Summary

Processed the manual Forgejo review and corrected the branch direction. The runtime validator tightening and the `prompts/review.md` expansion were both backed out. The branch now keeps Parallix's existing accepted evidence forms intact and instead clarifies the draft, execute, repair, and runtime error messaging around what the current validator already accepts.

Also reverted the out-of-scope edit to `missions/task-1398/CP-4.md`. The remaining linked blocker note for `TASK-1418` stays as a follow-up reference only; this mission still does not absorb the separate `px.ts` runtime-loader repair.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Manual Forgejo review comments were loaded and applied to the branch direction | `http://localhost:3300/magnus/parallix/pulls/118`, `lib/commands/repair-handoff.ts:227` | PASS |
| Runtime evidence acceptance still matches Parallix's existing validator behavior instead of a newly narrowed contract | `lib/commands/handoff.ts:148`, `lib/review/review-commands.ts:195` | PASS |
| Draft, execute, and scaffold instructions now teach one canonical Goal Check heading while staying aligned to current runtime checks | `prompts/draft.md:28`, `prompts/execute.md:17`, `templates/mission-scaffold.md:32` | PASS |
| Out-of-scope history rewrite of `task-1398` was reverted | `missions/task-1398/CP-4.md:55` | PASS |

Next action: Rebuild the generated JS, rerun the focused Goal Check contract tests plus the required `static-analysis` gate, and confirm whether the runtime-smoke blocker remains the only `all`-gate failure.
