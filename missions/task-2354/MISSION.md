# Mission: Purge stale lib/ references and strip evidence paths from use-cases.md (task-2354)

## Goal
Bring the scoped documentation in line with the post-ESM repository layout by removing obsolete `lib/` and `dist/` references, while making `docs/use-cases.md` a capability inventory without source-coordinate evidence citations.

## Why Now
Task-2328 moved production source to `src/` and the bundle to `build/px.mjs`; the old `lib/` and `dist/` trees no longer exist. Stale paths now misdirect maintainers and agents, and the line-number evidence in `docs/use-cases.md` will keep rotting after refactors.

## Refinement Signals
- Predicted NEL bucket: Small (0–80)
- Confidence: High
- Selection note: activate as-is
- Main drivers: five bounded Markdown documents, a known ESM layout migration, removal rather than replacement of use-case evidence citations, and the existing documentation verifier.

## Scope
- `docs/use-cases.md`: remove every `lib/` and `index.js` code reference and every `(E)` citation that points to a `lib/` path; retain each use case's capability description, confidence level, measured value, caveat, and red-team analysis without introducing `src/` evidence paths.
- `docs/authority-reference.md`: replace the stale `lib/tools/backlog.js` and `lib/commands/draft.js` references with their current `src/` locations.
- `docs/real-agent-smoke.md`: replace stale `lib/agents/` and `lib/core/` references with the current `src/adapters/agents/` and `src/adapters/` locations.
- `docs/doc-standards.md`: replace the obsolete `lib/README.md` reference with `src/README.md` when that file exists, otherwise remove that reference.
- `docs/adr/0049-diff-scoped-mutation-testing-with-ratchet-enforcement.md`: update stale `lib/` references to `src/` and stale `dist/` references to `build/px.mjs` inline.
- Run `graphify update .` after the documentation changes.

## Out of Scope
- Changes to `docs/npm-package-major-migration.md`; its `dist/` references intentionally describe the pre-migration state in the comparison table.
- Source-code, test, build, packaging, or ESM-cutover changes.
- Adding source-path or line-number evidence citations to `docs/use-cases.md`.
- ADR addenda or historical annotations for removed path references.

## Success Criteria
> **Falsifiability rule (ADR 0039 Part 2):** Each criterion must be falsifiable. Forbidden: subjective adjectives ("easy, fast, simple, intuitive, user-friendly, responsive, quick, efficient" without an attached metric) and vague quantifiers ("multiple, several, some, many, few, various"). For refactor / condense / migration missions, the criterion must enumerate the specific elements (rules, files, behaviours) that must survive — generic phrases like "preserve critical content" are not sufficient.

- `docs/use-cases.md` contains no `lib/` path, no `index.js` code reference, and no `(E)` evidence citation to a source-file path; its use-case descriptions, confidence levels, measured values, caveats, and red-team analysis remain present.
- `docs/authority-reference.md` contains neither `lib/tools/backlog.js` nor `lib/commands/draft.js`; its replacements identify the corresponding current `src/` locations.
- `docs/real-agent-smoke.md` contains no stale `lib/agents/` or `lib/core/` path and uses `src/adapters/agents/` and `src/adapters/` for the affected references.
- `docs/doc-standards.md` contains no `lib/README.md`; it either names existing `src/README.md` or omits the obsolete README reference.
- `docs/adr/0049-diff-scoped-mutation-testing-with-ratchet-enforcement.md` contains no stale `lib/` or `dist/` path reference; applicable references name `src/` or `build/px.mjs` inline, with no addendum.
- `./scripts/verify-local.sh docs` exits successfully after the scoped documentation edits.
- `graphify update .` completes after the documentation edits.

## Risks and Assumptions
- Assumption: the backlog task's stated `src/` replacements accurately reflect the ESM layout; verify exact target paths before editing each reference.
- Risk: removing use-case citations could remove adjacent substantive prose. Mitigation: restrict deletions to source-coordinate citations and compare each use-case section for the required retained elements.
- Risk: historical `dist/` text can be intentional. Mitigation: leave `docs/npm-package-major-migration.md` unchanged and update only the ADR named in scope.
- Risk: the `src/README.md` replacement may not exist. Mitigation: remove the obsolete `lib/README.md` reference rather than creating a new README.

## Checkpoints
- CP 1: Read `docs/doc-standards.md`, inventory every scoped stale reference, and record the exact intended disposition for each reference before editing.
- CP 2: Update `docs/use-cases.md` by deleting source-coordinate evidence citations only; then update the four remaining scoped documents with verified current paths or the specified removal.
- CP 3: Run `graphify update .` and the documentation verifier, inspect the diff for scope compliance, and document goal-check evidence.

### Checkpoint Documentation Requirements
Every checkpoint document (CP-N.md) MUST include:
- A concise summary of the references inventoried, removed, or replaced.
- The exact heading `## Goal Check`.
- The exact 3-column table header `| Criterion | Evidence | Status |`, with one evidence row for every Success Criterion.
- Evidence must use forms Parallix already verifies today: file:line references, exact test names, ADR references, test file paths, or recognized repository commands and paths such as backticked `npm ...`, `node ...`, `git ...`, `px ...`, or `./...`.
- For this mission, cite the changed document locations for content criteria, `ADR 0049` for the ADR criterion, and the exact `./scripts/verify-local.sh docs` and `graphify update .` commands for verification criteria.
- Raw `stat`/`ls` output or generic prose alone is not enough: if included, pair shell output with an accepted file:line reference, exact test name, ADR reference, test file path, or recognized command/path.
- A non-generic `Next action:` line at the bottom that names the next scoped document or verification command.

Example Goal Check table:

| Criterion | Evidence | Status |
|---|---|---|
| Draft prompt defines checkpoint evidence rules | `prompts/draft.md:28` | PASS |
| Repair loop has targeted incomplete-evidence coverage | `test/repair-handoff.test.ts`, `"buildRelaunchPrompt returns string containing Goal Check table and mission slug"` | PASS |
| Verification gate ran | `./scripts/verify-local.sh docs` | PASS |

## Gates
- [ ] ./scripts/verify-local.sh docs

## Restricted Areas
- Do not modify source code, tests, package/build configuration, or files outside the five scoped documentation files.
- Do not modify `docs/npm-package-major-migration.md`.
- Do not add `src/` paths, line numbers, or replacement evidence citations to `docs/use-cases.md`.
- Do not add an ADR addendum; edit the scoped ADR's stale paths inline only.

## Stop Rules
- Stop and request direction if a required current replacement path cannot be verified from the repository.
- Stop and request direction if removing a use-case evidence citation would also remove a required capability description, confidence level, measured value, caveat, or red-team analysis.
- Stop and request direction if a stale `dist/` reference appears to be deliberate historical comparison text outside the explicitly excluded migration document.
- Stop and request direction if `./scripts/verify-local.sh docs` fails for a pre-existing or unrelated documentation issue that cannot be isolated from this mission.
