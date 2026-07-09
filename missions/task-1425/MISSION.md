# Mission: Refactor mission-utils into focused internal modules behind a stable facade (task-1425)

## Goal

Refactor `lib/core/mission-utils.ts` into smaller, domain-focused internal modules while preserving the current external API and runtime behavior that commands, review flows, tools, and tests depend on today. The final tree must keep `lib/core/mission-utils.ts` as the stable entrypoint, reduce the amount of unrelated logic co-located in one file, and leave the existing mission/worktree/graphify/helper behavior unchanged.

## Why Now

`lib/core/mission-utils.ts` is currently 998 lines and `test/mission-utils.test.js` is 979 lines. The file mixes at least five separate concerns:

- adapter and mission-path resolution
- branch and worktree resolution
- mission document/checkpoint helpers
- graphify probing/update helpers
- merge-noise / conflict / artifact classification helpers

That concentration is now a maintenance risk. The module is imported by many workflow entrypoints (`draft`, `handoff`, `integrate`, `review`, `status`, `rebase`, `gatekeeper`, Forgejo helpers, and multiple tests), so every change to one concern forces engineers to scan a nearly 1,000-line utility file and a nearly 1,000-line test file. Refactoring now lowers the cost of follow-on mission work in the workflow core without changing user-visible behavior.

## Refinement Signals
- Predicted NEL bucket: Medium (81–235)
- Confidence: High
- Selection note: activate as-is
- Main drivers: `lib/core/mission-utils.ts` and `test/mission-utils.test.js` are both near 1,000 lines; the module has wide cross-command usage; responsibilities are already separable by domain without requiring product behavior changes

## Scope
- Split `lib/core/mission-utils.ts` into focused internal modules under `lib/core/` or `lib/core/mission-utils/`, with clear domains such as mission path/document helpers, branch/worktree helpers, graphify helpers, and merge/artifact/noise helpers
- Keep `lib/core/mission-utils.ts` present as the public facade and re-export layer used by existing callers
- Preserve the current behavior of mission adapter resolution, year-tier mission lookup, branch prefix/base-branch helpers, worktree resolution, checkpoint discovery, verify-area detection, graphify probing/update, merge-conflict parsing, backlog-noise cleanup helpers, and mission artifact classification
- Reorganize `test/mission-utils.test.js` into smaller focused test files or clearly segmented suites that mirror the new module boundaries, while preserving coverage for the existing behaviors already locked by the repo
- Update any internal imports or test setup needed to support the refactor, but do not change user-facing commands, mission document formats, or gate semantics

## Out of Scope
- Adding new mission/worktree features, flags, environment variables, or config keys
- Changing the public import path that callers use today (`../core/mission-utils.js` / `./core/mission-utils.js`)
- Rewriting command, review, Forgejo, or gate logic beyond what is strictly required to keep imports working after the refactor
- Changing mission document semantics such as `Base-Branch:`, `Reproduction-Test:`, gate parsing, or checkpoint naming rules
- Altering graphify behavior, git command behavior, or integration-pipeline policy as a feature change
- Converting this area to a different module system or introducing new dependencies

## Success Criteria
> **Falsifiability rule (ADR 0039 Part 2):** Each criterion must be falsifiable. Forbidden: subjective adjectives ("easy, fast, simple, intuitive, user-friendly, responsive, quick, efficient" without an attached metric) and vague quantifiers ("multiple, several, some, many, few, various"). For refactor / condense / migration missions, the criterion must enumerate the specific elements (rules, files, behaviours) that must survive — generic phrases like "preserve critical content" are not sufficient.

1. `lib/core/mission-utils.ts` remains in place and continues to export the symbols currently consumed by repo callers, including at minimum `findMissionDir`, `findCheckpoints`, `getFirstLine`, `resolveWorktree`, `inferSlug`, `getMissionYear`, `missionDirForSlug`, `missionPathForSlug`, `findMissionArea`, `resolveMainRepo`, `getPrimaryWorktree`, `getPrimaryBranch`, `missionBaseDir`, `missionBranchPrefix`, `missionBranchName`, `conventionalWorktreePath`, `detectLaunchBaseBranch`, `resolveMissionBaseBranch`, `resolveBaseWorktree`, `parseConflictFilesFromMergeOutput`, `getConflictFiles`, `findMissionDocInBranches`, `isMissionArtifact`, `updateGraphifyKnowledgeGraph`, and `softResetTrailingBacklogNoise`, with existing command/review/tool call sites still resolving successfully.
2. The refactor creates at least four focused internal module boundaries separating these domains: mission path/document helpers, branch/worktree/base-branch helpers, graphify helpers, and merge/artifact/noise helpers. `lib/core/mission-utils.ts` becomes a facade/re-export entrypoint rather than remaining the primary home of all implementation logic.
3. Existing behavior remains locked for the current high-risk scenarios already covered in the repo: year-tier mission lookup, adapter-aware mission path resolution, mission branch slug inference, base-branch recording/resolution, base-worktree auto-create, graphify availability/update handling, merge-conflict parsing, exact branch matching in `findMissionDocInBranches`, and adapter-aware mission artifact detection.
4. The test surface is reorganized to match the refactor: either the current `test/mission-utils.test.js` is split into focused files or its suites are restructured so each major helper domain is isolated and traceable to one of the module boundaries in Criterion 2, without dropping any of the behavior coverage named in Criterion 3.
5. The final tree passes `./scripts/verify-local.sh static-analysis` and `./scripts/verify-local.sh all` with no newly introduced `.only`, bare `.skip`, or changed-file lint/typecheck failures.

## Risks and Assumptions
- Risk: this module is imported broadly across commands, review code, tools, and tests, so seemingly internal changes can break runtime import expectations or mocks. Assumption: keeping `lib/core/mission-utils.ts` as the stable facade is sufficient to avoid broad call-site churn.
- Risk: splitting helpers can accidentally change hidden coupling, especially around `process.cwd()`, adapter config defaults, and git runner injection. The refactor must preserve the current call signatures and default behaviors.
- Risk: large test-file movement can create noisy diffs without improving maintainability. The execution phase should prefer domain-focused moves that clearly map to the new module layout.
- Assumption: no product behavior change is required to make the refactor credible; existing tests already identify the important invariants that must survive.
- Risk: some callers may rely on module-level mocking of the facade. If direct imports from new internals make those tests weaker or more brittle, stop and keep the facade as the mocking seam.

## Checkpoints
- CP 1: Define the module split and establish the facade. Create the target internal module boundaries and convert `lib/core/mission-utils.ts` into a stable facade/re-export layer without changing external import paths.
- CP 2: Extract mission path/document and branch/worktree helpers. Move adapter resolution, mission directory/year/path logic, slug inference, base-branch parsing, and worktree helpers into focused modules while preserving current signatures and behavior.
- CP 3: Extract graphify and merge/artifact/noise helpers. Move graphify probe/update helpers, merge-conflict parsing, trailing-backlog-noise helpers, branch mission-doc lookup, and artifact classification into focused modules behind the same facade.
- CP 4: Reorganize tests to mirror the new boundaries. Split or restructure `test/mission-utils.test.js` so each helper domain in Scope has a traceable test home and the current behavior scenarios remain covered.
- CP 5: Run the required repo gates for `lib/` work. Finish with `./scripts/verify-local.sh static-analysis` and `./scripts/verify-local.sh all` passing on the final tree.

### Checkpoint Documentation Requirements
Every checkpoint document (CP-N.md) MUST include:
- A summary of work done
- A `## Goal Check` section
- A 3-column pipe-delimited markdown table with columns: `| Criterion | Evidence | Status |`
- At least one evidence row per success criterion using verifiable references. Parallix already accepts:
  1. **File:line references** — e.g., `lib/core/mission-utils.ts:1` or `lib/core/mission-utils/worktree.ts:42`
  2. **Test names** — exact test names from the repo, such as `"resolveBaseWorktree auto-creates a worktree on the base branch when none is checked out"`
  3. **Test file paths** — e.g., `test/mission-utils.test.js` or a split file such as `test/mission-utils-worktree.test.js`
  4. **ADR references** — e.g., `ADR 0039`
  5. **Recognized repo commands or paths** — backticked commands/paths such as `./scripts/verify-local.sh static-analysis`, `./scripts/verify-local.sh all`, `npm test -- test/mission-utils.test.js`, `node --test test/mission-utils.test.js`, `git diff --stat`, or `px review <slug> --verify`
- Raw `stat`/`ls` output or generic prose alone is not enough. If shell output is included, pair it with at least one accepted reference above.
- A non-generic `Next action:` line at the bottom that names the next concrete implementation step

Example Goal Check table:

| Criterion | Evidence | Status |
|---|---|---|
| Facade still exports mission utility entrypoints | `lib/core/mission-utils.ts:1` | PASS |
| Worktree/base-branch behavior stayed locked | `test/mission-utils-worktree.test.js`, `"resolveBaseWorktree auto-creates a worktree on the base branch when none is checked out"` | PASS |
| Required lib gate ran | `./scripts/verify-local.sh static-analysis` | PASS |

## Gates
- [x] `./scripts/verify-local.sh static-analysis`
- [x] `./scripts/verify-local.sh all`

## Restricted Areas
- Do not change the public mission utility import path used by repo callers; `lib/core/mission-utils.ts` must remain the stable facade
- Do not change mission command semantics, review-flow semantics, or integration-pipeline behavior as part of this refactor
- Do not add new dependencies, new workflow config keys, or new environment-variable-based behavior
- Do not delete coverage for existing mission-utils behavior scenarios in tests; re-home them if needed, but keep them locked
- Do not treat this as permission to refactor unrelated command/review/tool files beyond the import or test adjustments required by the split

## Stop Rules
- Stop if preserving the current facade API would require broad behavioral rewrites outside the mission-utils area rather than a focused internal extraction
- Stop if the refactor cannot keep the existing default behaviors around `process.cwd()`, adapter resolution, or git runner injection intact
- Stop if the only way to finish is to weaken or delete existing behavior tests instead of preserving them through the reorganization
- Stop if unrelated pre-existing failures appear in `./scripts/verify-local.sh static-analysis` or `./scripts/verify-local.sh all`; record them and do not conflate them with the refactor
