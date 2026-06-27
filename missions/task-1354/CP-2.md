# CP-2 — `lib/commands/draft.js`: classification instructions permit optional `bug`

## Summary

Updated the draft-phase classification guidance so `bug` is explicitly allowed as an optional modifier alongside the single required classification label.

- `resolveClassificationInstructions()` now returns "set exactly one of `ai_sdlc` or `user_value` … — plus optionally `bug` for bug-fix missions." (replacing the old "no other value" wording) (`lib/commands/draft.js:698`).
- `buildRestartPrompt()` focused-repair guidance now says labels may contain "(plus optionally `bug` if this is a bug fix)" and the dedupe rule was scoped to "if both **classification** labels are present, keep only the correct one" so a coexisting `bug` label is not stripped (`lib/commands/draft.js:766`, `:769`).

The synthetic-task branch (`source: synthetic` → preserve `unknown`) is unchanged.

## Goal Check

| Success criterion | Evidence (file:line / test) | Status |
| --- | --- | --- |
| #3 Draft instructions permit `bug` alongside classification | `lib/commands/draft.js:698` (instruction text includes "plus optionally `bug`") | ✅ |
| #3 Restart/repair prompt permits `bug` and only dedupes classification labels | `lib/commands/draft.js:766`,`:769` | ✅ |
| #4 Non-bug behavior unchanged (synthetic + standard paths) | `lib/commands/draft.js:694-698` (synthetic branch untouched) + `test/draft.test.js`/`test/draft-command.test.js` pass | ✅ |

Test run: `node --test test/draft.test.js test/draft-command.test.js` → 63 pass / 0 fail.

Next action: CP-3 — add the bug-labeled conditional sections to `prompts/draft.md` (author failing repro test as first checkpoint) and `prompts/execute.md` (repro-before-fix enforcement).
