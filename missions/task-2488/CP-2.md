# Checkpoint 2 — printUsage grouping reordered to Core / Advanced

## Summary
Changed only `printUsage` grouping/order in `src/interfaces/cli/runtime.ts`.
No command was added, removed, renamed, aliased, or reordered within its own
description; only the headings and which heading each command sits under changed.

- **Core Commands:** `mission-start`, `draft`, `active`, `checkpoint`, `review`, `handoff`, `integrate` (lifecycle order).
- **Advanced Commands:** the remaining dispatchable commands from the former flat Core list — `verify-env`, `verify`, `setup`, `setup-review`, `recover`, `status`, `cancel`, `resolve-conflict`, `rebase`, `diff`, `stats`, `config`, `ui`, `web`, `aliases`.
- **Utility Commands** and **Notes** sections left untouched.

Install-smoke audit: `test/task-2285-pack-install-smoke.test.ts` SC3 asserts
only the `Usage:` line and `px stats --help` — neither depends on group
headings, so no expectation there needed changing.

Documentation audit: searched `docs/` and root-level Markdown for a verbatim
`px --help` command listing (`Core Commands:` / `mission-start` / `Utility
Commands:` / `printUsage`). No live authored reproduction exists (matches are
limited to backlog/completed records, completed missions, and graphify output —
all out of scope). No authored documentation changed.

All 38 `test/index.test.ts` cases pass, including the three new grouping
assertions from CP 1.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Core before Advanced before Utility | `test/index.test.ts`, `printUsage orders Core Commands before Advanced Commands before Utility Commands` | PASS |
| Exact seven-command Core membership and order | `test/index.test.ts`, `printUsage Core Commands contains exactly the seven lifecycle commands in order` | PASS |
| Every documented command present exactly once | `test/index.test.ts`, `printUsage documents every KNOWN_COMMANDS exactly once across all sections` | PASS |
| Installed help retains command surface | `test/task-2285-pack-install-smoke.test.ts`, `task-2285 install: SC3 — px --help prints the command surface` (no heading dependency) | PASS |
| No verbatim help reproduction in live docs | docs/ + root README audit: none found | PASS (no change) |

Run to reproduce:
`FORCE_COLOR=0 npx tsx --test test/index.test.ts`
`FORCE_COLOR=0 npx tsx src/entry/px.ts --help` (headings: Core 4→11, Advanced 13, Utility 30)

## Next action
CP 3: run the two required gates (`./scripts/verify-local.sh all`,
`./scripts/verify-local.sh static-analysis`) and record final evidence against
every success criterion.
