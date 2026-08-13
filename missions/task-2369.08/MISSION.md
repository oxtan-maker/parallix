# Mission: Split static review evidence helpers from review commands (task-2369.08)

## Goal
Move the adapter-side static-review goal-check evidence functionality out of `review-commands.ts` into `src/adapters/review/review-static-evidence.ts`, leaving `review-commands.ts` as a compatible consumer and re-export surface.

## Why Now
`review-commands.ts` currently combines command orchestration with static evidence collection and formatting. Task-2369.07 and this mission jointly reduce that file below the established 1200-line boundary; separating the static-review seam now makes later review-command maintenance less coupled while task-2369.13 handles the distinct application-side deduplication.

## Refinement Signals
- Predicted NEL bucket: Small (0–80)
- Confidence: High
- Selection note: activate as-is after TASK-2369.07 is available
- Main drivers: extract eight cohesive static-evidence helpers, preserve the existing adapter import/re-export contract, and reduce `review-commands.ts` below 1200 lines after the paired split.

## Scope
- Create `src/adapters/review/review-static-evidence.ts` containing `collectGoalCheckEvidenceRows()`, `collectRepoTestNames()`, `canonicalSourceContainsFile()`, `evidenceCellHasVerifiableReference()`, `findUnverifiableGoalCheckRow()`, `performStaticReview()`, `formatStaticReviewFindings()`, and `formatStaticReviewSuccess()`.
- Remove those eight helper implementations from `src/adapters/review/review-commands.ts` and re-export their public API there when existing callers rely on that module path.
- Preserve each extracted helper's current inputs, outputs, static-review findings, success formatting, and evidence-validation behaviour.
- Add or update fast, dependency-mocked unit coverage for the extracted module and its compatibility surface as needed.

## Out of Scope
- Deduplicating the application-side goal-check evidence functions in `handoff-command-use-case.ts`; that belongs to TASK-2369.13.
- Changing review policy, evidence acceptance rules, static-review output text, CLI command behaviour, or mission lifecycle behaviour.
- Extracting helpers beyond the eight functions named in this contract.

## Success Criteria
> **Falsifiability rule (ADR 0039 Part 2):** Each criterion must be falsifiable. Forbidden: subjective adjectives ("easy, fast, simple, intuitive, user-friendly, responsive, quick, efficient" without an attached metric) and vague quantifiers ("multiple, several, some, many, few, various"). For refactor / condense / migration missions, the criterion must enumerate the specific elements (rules, files, behaviours) that must survive — generic phrases like "preserve critical content" are not sufficient.

- `src/adapters/review/review-static-evidence.ts` defines all eight named helpers: `collectGoalCheckEvidenceRows`, `collectRepoTestNames`, `canonicalSourceContainsFile`, `evidenceCellHasVerifiableReference`, `findUnverifiableGoalCheckRow`, `performStaticReview`, `formatStaticReviewFindings`, and `formatStaticReviewSuccess`.
- `src/adapters/review/review-commands.ts` no longer contains the eight helper implementations and continues to export every extracted helper that was exported from it before the extraction.
- For representative valid and invalid goal-check evidence inputs, static review returns the same pass/failure decision and findings formatting as before the extraction, including repository test-name recognition, canonical source-file recognition, and unverifiable-row detection.
- `src/adapters/review/review-commands.ts` contains fewer than 1200 lines after TASK-2369.07 and this mission are complete.
- `./scripts/verify-local.sh static-analysis` and `./scripts/verify-local.sh all` complete successfully on the final tree.

## Risks and Assumptions
- TASK-2369.07 lands first or is already present in the mission baseline; otherwise the combined sub-1200-line criterion cannot be evaluated fairly.
- Helper visibility or imports may be consumed by direct unit tests; preserve exports and avoid changing call signatures unless tests demonstrate they are private.
- Static-review evidence rules are workflow-critical: extraction must be behavior-preserving, not an opportunity to relax validation.

## Checkpoints
- CP 1: Map the existing exports, callers, dependencies, and tests for the eight named helpers; record the compatibility contract and the baseline line count of `review-commands.ts`.
- CP 2: Extract the eight helpers into `review-static-evidence.ts`, wire the required imports and re-exports, and add focused mocked unit coverage for valid and invalid evidence paths.
- CP 3: Run the static-analysis and general verification gates, confirm the required line-count reduction, and record goal-check evidence for every success criterion.

### Checkpoint Documentation Requirements
Every checkpoint document (CP-N.md) MUST lead its evidence with durable forms Parallix verifies today: exact test names, ADR references, test file paths, and recognized repository commands or paths such as `npm ...`, `node ...`, `git ...`, `px ...`, or `./...`. File:line references are accepted when needed but discouraged because line numbers rot.

Every checkpoint document (CP-N.md) MUST include:
- A summary of work done.
- The exact heading `## Goal Check`.
- The exact 3-column pipe-delimited table `| Criterion | Evidence | Status |` with at least one row for every success criterion.
- Evidence using an exact test name, an existing test file path, an ADR reference, or a recognized repository command/path; raw `stat`/`ls` output or generic prose alone is not enough, so pair any shell output with one of those accepted references.
- A non-generic `Next action:` line at the bottom.

Example Goal Check table:

| Criterion | Evidence | Status |
|---|---|---|
| Extracted helper coverage | `test/...`, exact test name | PASS |
| Static analysis | `./scripts/verify-local.sh static-analysis` | PASS |

## Gates
- [ ] ./scripts/verify-local.sh static-analysis
- [ ] ./scripts/verify-local.sh all

## Restricted Areas
- Do not modify application-side goal-check evidence logic in `handoff-command-use-case.ts`.
- Do not alter review-policy semantics, user-facing review output, mission lifecycle state transitions, or unrelated CLI composition.
- Keep unit tests dependency-mocked; they must not contact Forgejo or launch real agents or heavy CLI commands.

## Stop Rules
- Stop and reassess if TASK-2369.07 is absent and the line-count criterion cannot be evaluated against the intended combined baseline.
- Stop before changing an extracted helper's public signature, review-policy decision, or formatted message; obtain an explicit contract update if compatibility cannot be preserved.
- Stop if focused unit tests require real Forgejo access, a real agent, or an expensive CLI invocation; replace that approach with mocked dependencies.
