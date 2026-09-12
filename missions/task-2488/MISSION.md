# Mission: Split px --help into core and advanced sections (task-2488)

## Goal
Make `px --help` lead with the four commands required to complete a normal mission lifecycle—`draft`, `active`, `review`, and `integrate`—and place every other dispatchable command in an Advanced Commands section without changing command availability or behavior.

## Why Now
The flat 25-command list makes the first-run surface harder to understand than the small lifecycle it replaces. The trust-layer repositioning work makes that first impression a product concern now, while the help text is still centralized and has focused coverage.

## Refinement Signals
- Predicted NEL bucket: Small (0–80)
- Confidence: High
- Selection note: activate as-is
- Main drivers: one centralized usage formatter, seven explicit core lifecycle commands, direct unit and install-smoke help coverage, and a documentation audit limited to pages that reproduce this output.

## Scope
- Reorder and relabel the command groups emitted by `px --help` in `src/interfaces/cli/runtime.ts`.
- Put `draft`, `active`, `review`, and `integrate` under the first heading, `Core Commands:`.
- Put every remaining dispatchable command currently shown in the old Core Commands list under a subsequent `Advanced Commands:` heading; retain the existing Utility Commands and Notes sections. This moves `mission-start`, `checkpoint`, and `handoff` out of Core Commands into Advanced Commands.
- Update direct help-output assertions and the installed-package smoke assertion where their expected headings or command placement change.
- Search authored documentation for verbatim help-output reproductions and update only a current reproduction, if one exists.

## Out of Scope
- Adding, removing, renaming, aliasing, or changing the behavior of any `px` command.
- Changing command parsing, `KNOWN_COMMANDS`, suggestions, setup behavior, lifecycle rules, or the terminal UI.
- Rewriting documentation that merely mentions `px --help` or individual commands rather than reproducing its command listing.
- Altering help text outside group headings, order, and whitespace required by the new grouping.

## Success Criteria
> **Falsifiability rule (ADR 0039 Part 2):** Each criterion must be falsifiable. Forbidden: subjective adjectives ("easy, fast, simple, intuitive, user-friendly, responsive, quick, efficient" without an attached metric) and vague quantifiers ("multiple, several, some, many, few, various"). For refactor / condense / migration missions, the criterion must enumerate the specific elements (rules, files, behaviours) that must survive — generic phrases like "preserve critical content" are not sufficient.

- `px --help` renders `Core Commands:` before `Advanced Commands:`, and renders `Advanced Commands:` before `Utility Commands:`.
- The Core Commands section contains exactly `draft`, `active`, `review`, and `integrate`, in that lifecycle order.
- `mission-start`, `checkpoint`, and `handoff` now appear only under Advanced Commands; no dispatchable command is dropped or duplicated across sections.
- Each dispatchable command currently documented by `printUsage` remains present exactly once across Core Commands, Advanced Commands, and Utility Commands; no command is dropped.
- `px --help` and the installed package's `px --help` continue to exit successfully and retain the Usage and Notes content covered by the existing help tests.
- No command registration, parsing, alias, suggestion, or command-handler behavior changes outside help presentation.
- Any current authored documentation that reproduces the command listing matches the new section headings and membership; if the audit finds no such reproduction, no authored documentation is changed.
- `./scripts/verify-local.sh all` and `./scripts/verify-local.sh static-analysis` succeed on the final tree.

## Risks and Assumptions
- Risk: a test or installation fixture may assert the former flat group heading or order. Mitigation: update focused help assertions and preserve the complete command surface in a membership test.
- Risk: a documentation search may find archived or historical output that should not be rewritten. Assumption: only live authored documentation is in scope; leave completed-mission and archive records intact.
- Assumption: the defined seven-command lifecycle is the intended first-mission path; setup and diagnostic commands remain advanced because they are situational or installation-specific.

## Checkpoints
- CP 1: Add or update focused `test/index.test.ts` assertions that prove the three heading order, the exact four-command Core Commands membership and order (`draft`, `active`, `review`, `integrate`), that `mission-start`, `checkpoint`, and `handoff` now live only under Advanced Commands, and continued one-time presence of every documented command before changing the help formatter.
- CP 2: Change only `printUsage` grouping/order in `src/interfaces/cli/runtime.ts`; move `mission-start`, `checkpoint`, and `handoff` to Advanced Commands and reorder the core list to the four-command lifecycle; update affected install-smoke expectations, then audit live authored documentation for a verbatim help listing and update it only if found.
- CP 3: Run the required verification gates and record final evidence that the seven core commands, advanced remainder, complete command surface, and documentation audit meet every success criterion.

### Checkpoint Documentation Requirements
Every checkpoint document (CP-N.md) MUST include:
- At least one evidence row for every success criterion, led by durable evidence Parallix verifies today: exact test names, ADR references, test file paths, and recognized repository commands or paths such as `npm ...`, `node ...`, `git ...`, `px ...`, or `./...`. Use `test/index.test.ts`, `test/task-2285-pack-install-smoke.test.ts`, and the exact changed test names where applicable; use `./scripts/verify-local.sh all` and `./scripts/verify-local.sh static-analysis` for final gates. File:line references are accepted but discouraged because line numbers rot.
- A summary of work done
- A `## Goal Check` section using exactly this 3-column table header: `| Criterion | Evidence | Status |`
- Raw `stat`/`ls` output or generic prose alone is not enough; pair shell output with one of the accepted references above.
- A non-generic `Next action:` line at the bottom

Example Goal Check table:

| Criterion | Evidence | Status |
|---|---|---|
| Core section has exact lifecycle membership and order | `test/index.test.ts`, exact changed test name | PASS |
| Installed help retains the command surface | `test/task-2285-pack-install-smoke.test.ts`, exact changed test name | PASS |
| Final verification gates ran | `./scripts/verify-local.sh all`, `./scripts/verify-local.sh static-analysis` | PASS |

## Gates
- [ ] ./scripts/verify-local.sh all
- [ ] ./scripts/verify-local.sh static-analysis

## Restricted Areas
- Do not modify command registration, dispatch, parsing, aliases, lifecycle services, terminal UI code, or installed-package build configuration.
- Do not edit archived backlog tasks, completed missions, or historical review/checkpoint records that contain old help output.
- Before editing a live root-level or `docs/` Markdown file, consult `docs/doc-standards.md`; only update a verbatim current help reproduction.

## Stop Rules
- Stop and return the mission for refinement if the requested grouping requires a command addition, removal, rename, alias change, parser change, or lifecycle behavior change.
- Stop and return the mission for refinement if a live documentation reproduction cannot be updated without changing its independent user-facing meaning rather than its copied help text.
- Stop before integration, release, or changes outside the restricted help formatter, direct tests, and qualifying live documentation.
