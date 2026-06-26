---
event_type: reviewer_outcome
timestamp: 2026-06-26T06:39:15.004Z
round: 2
phase: reviewing
actor: qwen
slug: task-1290
verdict: request-changes
---

# Task-1290 Review Outcome

## Verdict
`request-changes`

## Rationale
All 9 mission success criteria are satisfied:
- `qwen` removed from all runtime family selection, config, telemetry, and public docs
- `custom` correctly replaces `qwen` in eligibility arrays, launcher maps, telemetry, and display logic
- Model provenance is threaded through stats (`telemetryToStatsFields`, `recordStageStats`, `recordReviewStats`, `recordActiveStats`)
- `npm test` passes with 1658 pass, 0 fail, 22 skipped
- Final checkpoint (CP-5.md) contains a Goal Check table with real file:line and test-name evidence

However, the diff includes out-of-scope changes to `prompts/review.md` and `prompts/review-verbose.md` that significantly simplify the review prompt instructions. The detailed separation-of-duties boilerplate (`You MUST NOT` / `You MUST` / `You MAY` blocks) was removed from both prompts, reducing reviewer behavioral constraints for all future review invocations. This was not documented in any checkpoint and exceeds the mission scope.

## Required Changes
1. **Restore separation-of-duties boilerplate to `prompts/review.md` and `prompts/review-verbose.md`** — the detailed `You MUST NOT` / `You MUST` / `You MAY` instructions should be preserved. Merge conflict marker cleanup is acceptable, but the behavioral constraints should not be discarded.

## Verification Result
- `px review task-1290 --verify`: PASS (1658 pass, 0 fail, 22 skipped)
- Grep for `qwen` in `lib/**/*.js`, `config/*.json`, `docs/*.md`, `README.md`: zero matches
- Diff scope: 80 files changed (mostly within scope; 2 out-of-scope prompt files)

## Non-blocking Notes
- `isSpuriousOpencodeExit()` addition (`lib/agents/opencode.js`) is a positive reliability improvement for opencode v2.0.0, though not explicitly scoped
- `fmt.agent()` condition inversion (`===` → `!==`) changes display semantics slightly but tests validate the new behavior
- Task-1325 mission directory cleanup (`missions/task-1325/` deletion) is unusual housekeeping but not harmful

---
`[workflow-round:2, workflow-phase:reviewing]`