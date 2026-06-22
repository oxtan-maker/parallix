# Mission: Fix stats-backfill regex crash in workflow command registry (task-1304)

## Goal
Restore `lib/commands/stats-backfill.js` to a syntactically valid state so that the `parallix` command tree boots without a SyntaxError, and add a regression test that asserts the module loads cleanly.

## Why Now
The invalid regex literal in the workflow-pattern classification block (`inferHistoricalClassificationFromMissionDoc`) causes `node parallix/index.js` to throw a SyntaxError at parse time, blocking every other command in the workflow registry from loading. This halts stats backfill runs and any downstream command that transitively requires the command registry.

## Refinement Signals
- Estimated agent % usage limit: 25-50%
- Confidence: High
- Selection note: activate as-is
- Main drivers: command tree boot failure, regression risk on classification logic

## Scope
- Locate and fix the invalid regex literal in `lib/commands/stats-backfill.js` (within the `productSurfacePatterns` or `workflowPatterns` array used by `inferHistoricalClassificationFromMissionDoc`)
- Ensure `require('./lib/commands/stats-backfill')` succeeds with zero SyntaxError
- Ensure `node parallix rebase <slug>` reaches the rebase logic without aborting at parse time
- Preserve the existing workflow-pattern matching semantics: `node parallix/index.js` must still match as a workflow pattern
- Add a regression test that verifies the module loads without a SyntaxError (mirroring the existing test pattern in `test/stats-backfill.test.js`)

## Out of Scope
- Changes to the stats CSV schema or backfill data pipeline
- Modifications to other command modules in `lib/commands/`
- Changes to the command registry boot logic itself (only the stats-backfill regex)
- Performance tuning or refactoring of the classification heuristics

## Success Criteria
> **Falsifiability rule (ADR 0039 Part 2):** Each criterion must be falsifiable.

- `node -e "require('./lib/commands/stats-backfill')"` exits with code 0 and produces no output
- All existing tests in `test/stats-backfill.test.js` pass (6 test suites, no failures)
- `npm test` completes with 0 failures across the full suite (1519 tests, 0 fail)
- The `workflowPatterns` array in `inferHistoricalClassificationFromMissionDoc` still contains the pattern `/node parallix\/index\.js/g` (literal string match in source)
- A new or updated regression test in `test/stats-backfill.test.js` asserts that `require('../lib/commands/stats-backfill')` does not throw

## Risks and Assumptions
- The fix must not alter the matching behaviour of any other regex in the `productSurfacePatterns` or `workflowPatterns` arrays
- The existing test suite already covers the classification heuristics; the fix must not break any existing assertions
- The `node parallix/index.js` string is a literal path used as a keyword pattern, not an executable command reference
- Assumption: the invalid regex is a single-character escaping issue (e.g. unescaped `/` or `.`) within one of the pattern literals

## Checkpoints
- CP 1: Identify the exact invalid regex token and its line number in `stats-backfill.js`
- CP 2: Apply the minimal escaping fix and confirm `require()` succeeds
- CP 3: Run `npm test` and confirm all 1519 tests pass with 0 failures
- CP 4: Add regression test for module-load safety and verify it passes

## Gates
- [ ] `npm test` passes with 0 failures
- [ ] `./scripts/verify-local.sh docs` passes (if present)

## Restricted Areas
- Do not modify any files outside `lib/commands/stats-backfill.js` and `test/stats-backfill.test.js`
- Do not touch `lib/commands/stats.js` or any other command module
- Do not modify the CSV schema, stats pipeline, or `parallix/index.js` entry point

## Stop Rules
- If the invalid regex cannot be isolated to a single token within 30 minutes, escalate for manual review
- If fixing the regex causes any existing test in `test/stats-backfill.test.js` to fail, revert and reassess the matching semantics
- If `npm test` reports more than 0 failures after the fix, stop and investigate the cascade
