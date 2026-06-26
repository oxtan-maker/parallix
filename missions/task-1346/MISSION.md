# Mission: Update px --help (task-1346)

## Goal
Bring `px --help` (the `printUsage` output in `index.js`) into sync with the CLI's
current dispatchable commands so every user-invokable command is documented.

## Why Now
`px --help` had drifted from the actual command surface: `config` and `aliases`
(both in `KNOWN_COMMANDS`) and the px.js-level utility commands `version`,
`shell-init`, and `review-event` were dispatchable but undocumented in help.

## Refinement Signals
- Estimated agent % usage limit: 25-50%
- Confidence: High
- Selection note: activate as-is
- Main drivers: help/usage drift from implemented commands

## Scope
- Update `printUsage()` in `index.js` to document all dispatchable commands.
- Add regression tests asserting help coverage of every `KNOWN_COMMANDS` entry
  and the px.js utility commands.

## Out of Scope
- Changing command behavior or adding/removing commands.
- Editing the backlog task file beyond mission-relevant status.

## Success Criteria
- `px --help` output contains each of these literal command tokens: `config`,
  `aliases`, `shell-init`, `review-event`, `--version` — verified by test
  `printUsage prints the command help text`.
- `px --help` documents every entry in `KNOWN_COMMANDS` — verified by test
  `printUsage documents every KNOWN_COMMANDS entry`.
- `./scripts/verify-local.sh docs` passes.
- Full test suite (`node --test test/*.test.js`) passes with 0 failures.

## Risks and Assumptions
- Help text is plain prose; tests match on word-boundary tokens which is robust
  to wording changes as long as the command name appears.

## Checkpoints
- CP 1: Audit dispatchable commands, update printUsage, add regression tests, verify gate.

## Gates
- [ ] ./scripts/verify-local.sh docs

## Restricted Areas
- Do not delete, rename, or move the backlog task file.

## Stop Rules
- Stop if a command appears in `KNOWN_COMMANDS` but has no implementation to describe.
