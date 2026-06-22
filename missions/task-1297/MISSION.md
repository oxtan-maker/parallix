# Mission: Fix regex permissiveness in detectMissionAreaFromContent (task-1297)

## Goal
Repair the regex in `lib/core/mission-utils.js:detectMissionAreaFromContent` (line 539) so it only matches verification-script invocations and no longer extracts area arguments from prose text that happens to contain a `./` or `../`-prefixed path. The fix must eliminate false-positive area extraction while preserving all eight existing test assertions in `test/mission-utils.test.js:121-135`.

## Why Now
Task-1284's autonomous review reached a `request-changes` verdict with F1 (HIGH): the regex contradicts its own documented risk mitigation by matching relative paths embedded in prose. The review artifacts were consumed and the verdict persisted, but the bug was never fixed. This task carries forward that review finding into the parallelix codebase for validation and remediation.

## Refinement Signals
- Estimated agent % usage limit: 25-50%
- Confidence: High
- Selection note: activate as-is
- Main drivers: persistent review finding, documented contradiction between comment and implementation, low-risk targeted regex fix with full test coverage

## Scope
- Tighten the regex in `lib/core/mission-utils.js:539` from `/(?:^|\s)\.{1,2}\/[\w./-]+\s+([a-zA-Z0-9_-]+)/m` to exclude prose-matched paths
- Add at least one regression test for a prose-matched path that currently produces a false positive (e.g. "We should run ./scripts/deploy.sh server before merging" must yield `'docs'`)
- Update the inline comment in `detectMissionAreaFromContent` to accurately describe the new matching criteria
- All 1556 existing tests in `npm test` must pass

## Out of Scope
- Changes to `normalizeVerifyArea` or `SUPPORTED_VERIFY_AREAS`
- Modifications to any other regex in the codebase
- Changes to the review subsystem, agent launchers, or Forgejo integration
- Adding new workflow commands or changing the task lifecycle states
- Rewriting `detectMissionAreaFromContent` into a full parser — only the regex needs tightening

## Success Criteria
1. The regex no longer matches `./` or `../`-prefixed paths that appear mid-sentence in prose (verified by a new test asserting such prose yields `'docs'`)
2. All eight existing assertions in `test/mission-utils.test.js:121-135` continue to pass unchanged (no regressions)
3. `npm test` reports 0 failures and the same pass count as baseline (1556 passed, excluding the one new test added)
4. The inline comment in `detectMissionAreaFromContent` accurately describes the matching criteria and no longer claims the relative-path prefix alone prevents prose matches
5. The fix resolves the F1 (HIGH) finding from task-1284's review verdict

## Risks and Assumptions
- Assumption: the eight existing test cases represent the full set of intentional invocation patterns; no undocumented callers rely on the current permissiveness
- Risk: tightening the regex could break a legitimate invocation pattern not covered by existing tests — mitigated by adding a regression test for the false-positive case
- Risk: the optional file-extension approach might not cover all script naming conventions — mitigated by keeping the pattern broad enough for common extensions (`.sh`, `.bash`, `.py`, `.rb`) and bare executable names like `gate`
- Assumption: `npm test` baseline of 1556 passing tests is stable and will remain so

## Checkpoints
- CP 1: Reproduce the false positive — confirm that prose containing `./scripts/deploy.sh server` currently yields `'server'` instead of `'docs'`
- CP 2: Design and implement the tightened regex, then run `npm test` to verify zero regressions
- CP 3: Add regression test for the prose false-positive case and confirm it fails with the old regex but passes with the new one

## Gates
- [ ] ./scripts/verify-local.sh docs

## Restricted Areas
- Do not modify any files under `lib/agents/`, `lib/review/`, `lib/tools/`, or `test/` other than `test/mission-utils.test.js`
- Do not alter `lib/core/mission-utils.js` outside of the `detectMissionAreaFromContent` function (lines 531-542)
- Do not change `workflow.config.json`, `package.json`, or any dependency versions

## Stop Rules
- Stop if the tightened regex causes any of the eight existing test assertions to fail — revert and reassess the approach
- Stop if `npm test` reveals unexpected regressions in other test files — investigate before proceeding
- Stop if the fix requires changes outside the restricted areas listed above
