# CP-1 — `lib/tools/backlog.js`: classification ignores `bug`, `hasBugLabel` added

## Summary

Made `bug` a non-classification modifier label and added a helper to detect it.

- Introduced `CLASSIFICATION_LABELS = new Set(['ai_sdlc', 'user_value', 'unknown'])` so only those three labels count toward the "exactly one classification" rule (`lib/tools/backlog.js:549`).
- Rewrote both label-scanning branches of `getTaskClassification()` (block and inline frontmatter) to add only labels present in `CLASSIFICATION_LABELS`. A `bug` label is now ignored, so `labels: [ai_sdlc, bug]` resolves to `ai_sdlc` instead of `null` (`lib/tools/backlog.js:551`, `:564`, `:574`).
- Added `hasBugLabel(taskFilePath)` which detects a `bug` label in both block and inline frontmatter formats, returning `false` for missing files (`lib/tools/backlog.js:581`).
- Exported `hasBugLabel` from the module (`lib/tools/backlog.js:764`).
- Added regression tests in `test/backlog.test.js` covering inline/block classification-with-bug, bug-only (still `null`), and `hasBugLabel` true/false/nonexistent cases.

## Goal Check

| Success criterion | Evidence (file:line / test) | Status |
| --- | --- | --- |
| #1 `getTaskClassification()` returns `ai_sdlc` for `[ai_sdlc, bug]` | `lib/tools/backlog.js:564` + test `getTaskClassification ignores non-classification labels like bug — inline format` (`test/backlog.test.js:862`) | ✅ |
| #2 `hasBugLabel()` true/false for both formats | `lib/tools/backlog.js:581` + test `hasBugLabel detects bug in inline and block label formats` (`test/backlog.test.js:902`) | ✅ |
| #4 Non-bug classification unchanged (`[ai_sdlc]`, `[user_value]`) | `lib/tools/backlog.js:564`,`:574` (only set membership added; legacy single-label paths identical) + existing `stats`/`backlog` tests pass | ✅ |
| #2 export | `module.exports` includes `hasBugLabel` (`lib/tools/backlog.js:764`) | ✅ |

Test run: `node --test test/backlog.test.js` → 56 pass / 0 fail.

Next action: CP-2 — update `lib/commands/draft.js` classification instructions to permit `bug` as an optional modifier alongside `ai_sdlc`/`user_value`.
