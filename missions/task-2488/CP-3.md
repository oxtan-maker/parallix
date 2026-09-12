# Checkpoint 3 — Final verification

## Summary
Final tree committed. `printUsage` in `src/interfaces/cli/runtime.ts` now emits
three headings — `Core Commands:` (the seven lifecycle commands in order),
`Advanced Commands:` (the remaining dispatchable commands), and the untouched
`Utility Commands:` / `Notes` sections. No command was added, removed, renamed,
aliased, or reordered in its description; only grouping/headings changed. All
38 `test/index.test.ts` cases pass and both required gates are green.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| `px --help` renders Core before Advanced before Utility | `test/index.test.ts`, `printUsage orders Core Commands before Advanced Commands before Utility Commands`; live `FORCE_COLOR=0 npx tsx src/entry/px.ts --help` shows `Core Commands:` (L4) < `Advanced Commands:` (L13) < `Utility Commands:` (L30) | PASS |
| Core section contains exactly the seven lifecycle commands in order | `test/index.test.ts`, `printUsage Core Commands contains exactly the seven lifecycle commands in order`; live `px --help` lines 5–11: mission-start, draft, active, checkpoint, review, handoff, integrate | PASS |
| Each documented command present exactly once; none dropped | `test/index.test.ts`, `printUsage documents every KNOWN_COMMANDS exactly once across all sections` (22 KNOWN_COMMANDS, each once) | PASS |
| `px --help` and installed `px --help` exit 0, retain Usage and Notes | `test/index.test.ts`, `printUsage prints the command help text` asserts `/Usage: px <command> \[args\]/` and `/No npm dependencies/`; `test/task-2285-pack-install-smoke.test.ts`, `task-2285 install: SC3 — px --help prints the command surface` asserts status 0 + `/Usage: px <command> \[args\]/` | PASS |
| No command registration / parsing / alias / suggestion / handler change outside help | ESLint + tsc clean; `test/index.test.ts` `resolveAlias`, `suggestCommand`, `buildSuggestionSuffix`, `levenshteinDistance`, `KNOWN_COMMANDS includes aliases` unchanged and passing; `./scripts/verify-local.sh all` (2505 tests) green | PASS |
| Live docs reproducing the listing match new headings; none found → no change | docs/ + root README audit found no verbatim `px --help` listing (no `Core Commands:` / `mission-start` / `printUsage` reproduction in live docs) | PASS (no change) |
| Required gates succeed on final tree | `./scripts/verify-local.sh all` → 2505 pass / 0 fail; `./scripts/verify-local.sh static-analysis` → all stages PASSED | PASS |

## Next action
Mission complete: all three checkpoints committed, both gates green, no
uncommitted mission files. Ready for Parallix lifecycle transition.
