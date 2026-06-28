# Mission: Convert 2 core utility modules from CJS to ESM/TypeScript — mission-utils, verification (task-1368)

## Goal

Convert the 2 remaining core `lib/core/` modules from CommonJS (`require`/`module.exports`) to ES Module syntax (`import`/`export`) with TypeScript interfaces. Files are renamed `.js` → `.ts`. Both modules have good JSDoc coverage that maps cleanly to TypeScript types. The injectable-dependency pattern (gitRunner, fsModule, pathModule) is preserved. All conversions preserve runtime behavior, public APIs, and test pass rates.

## Why Now

This mission follows Wave 1 (task-1366) which converted the 6 lowest-level leaf modules (`fmt`, `git`, `gitignore`, `spawn-tee`, `product-config`, `state-map`). Both `mission-utils.js` and `verification.js` depend exclusively on those already-converted modules (`fmt.ts`, `git.ts`, `product-config.ts`), so the dependency chain is now ready. Converting these two removes the last CJS barrier among the foundational core modules that every workflow command imports. The remaining JS files in `lib/core/` (`storage.js`, `persistent-data-migration.js`, `nels.js`, `subagent-limit.js`) are higher-level or have more complex internal dependencies, making them better suited for later waves. The no-committed-`.js` / deterministic-publish infrastructure was established by TASK-1367 — this mission inherits it and must follow the same guardrails.

## Refinement Signals

- Estimated agent % usage limit: 25-50%
- Confidence: High
- Selection note: activate as-is
- Main drivers: dependency-wave heuristic (ADR 0036), mission-utils.js is the largest non-command file in the repo (1027 lines), both modules have excellent JSDoc coverage that maps directly to TypeScript interfaces

## Scope

### Files converted

1. **`lib/core/verification.js` → `lib/core/verification.ts`** (166 lines)
   - Imports: `./git` (already `.ts`), `./product-config` (already `.ts`), `node:fs`, `node:child_process` (via `./git`)
   - Exports: `runWorkflow` (default), `DEFAULT_AREA`, `NO_GATE_NOTICE`, `formatVerificationCommand`, `resolveVerificationAdapter`, `runVerificationGate`, `readPublishedTreeState`, `captureVerifiedTreeProof`, `assertVerifiedTreeProof`
   - Test coverage: `test/verification.test.js` (9 tests visible, ~10 total)
   - Complexity: Low — straightforward CJS→ESM conversion, no dynamic requires inside functions

2. **`lib/core/mission-utils.js` → `lib/core/mission-utils.ts`** (1027 lines)
   - Imports: `./fmt` (already `.ts`), `./product-config` (already `.ts`), `./git` (already `.ts`), `node:fs`, `node:os`, `node:path`
   - Exports: 43 named exports including `resolveMissionAdapter`, `missionBaseDir`, `missionBranchName`, `inferSlug`, `getConflictFiles`, `findMissionDir`, `updateGraphifyKnowledgeGraph`, `isMissionArtifact`, and many more
   - Test coverage: `test/mission-utils.test.js` (979 lines, many tests)
   - Complexity: High — largest non-command file; contains dynamic `require()` calls inside functions (e.g., `require('./git')` inside `getPrimaryBranch`, `detectLaunchBaseBranch`, `readRecordedBaseBranch`, `resolveMissionBaseBranch`, `resolveBaseWorktree`, `resolveWorktree`, `inferSlug`, `getConflictFiles`, `findLastNonNoiseCommit`, `squashTrailingBacklogNoiseIntoPreviousMission`, `softResetTrailingBacklogNoise`, `findMissionDocInBranches`, `probeGraphifyAvailability`, `updateGraphifyKnowledgeGraph`) that must become either static top-level imports or dynamic `import()` calls
   - Injectable dependencies pattern: `gitRunner`, `commandRunner`, `gitFn` parameters must be preserved with proper TypeScript signatures

### Conversion rules

- Rename `.js` → `.ts` for each converted module via **`git mv` (or an equivalent faithful conversion)** so git records a rename, not a delete+add. The `.ts` must stay close enough to the original `.js` that `git diff -M` reports a rename **≥ 50% similarity** (git's default threshold). Concretely: preserve the original import names, helper functions, formatting, blank lines, and comments — change only what ESM/TS requires. The reviewer must see "`X.js` moved to `X.ts`, then changed for ts fixes," not a rewrite.
- Replace `const x = require('node:...')` with `import x from 'node:...';` (Node.js builtins use `node:` protocol)
- Replace `const x = require('relative/path')` with `import x from './path.js';` (ESM requires explicit `.js` extension even for `.ts` sources)
- Replace `module.exports = { ... }` with named `export` statements
- Replace `module.exports.foo = bar` / `module.exports.FOO = FOO` with `export const foo = bar; export const FOO = FOO;`
- Replace `module.exports.runWorkflow` (default export pattern in verification.js) with `export default function runWorkflow(...)`
- Preserve all JSDoc `@param`, `@returns`, `@type` annotations
- Convert JSDoc inline types to TypeScript types/interfaces:
  - `GitFn` → `type GitFn = (args: string[], options?: object) => import('child_process').SpawnSyncReturns<string>;`
  - Mission adapter config → `interface MissionAdapterConfig`
  - Verification adapter → `interface VerificationAdapterConfig`
  - Verification proof → `interface VerificationProof`
  - Published tree state → `interface PublishedTreeState`
  - Worktree entry → `interface WorktreeEntry`
- **No autogenerated `.js` in git:** follow the canonical "no-committed-`.js`" guardrails (shared with TASK-1367). Concretely:
  - `git rm --cached lib/core/mission-utils.js lib/core/verification.js` (delete on disk; regenerated by `npm run build:cjs`).
  - The `.gitignore` `lib/core/*.js` glob keeps the regenerated artifact untracked. **No TypeScript-compiled `.js` may be committed.**
  - In `.eslintignore`, **delete** the `!lib/core/mission-utils.js` and `!lib/core/verification.js` negation lines so their compiled output is ignored. The remaining `!lib/core/nels.js` and `!lib/core/subagent-limit.js` stay until those files are converted.
- `package.json` MAY be edited **only** to wire the deterministic build (`build:cjs`, and `pretest`/`prepublishOnly` pointing at it) if not already wired. Do NOT add `"type": "module"`.
- Compiled `.js` are produced deterministically by `npm run build:cjs` (used by both `pretest` and `prepublishOnly`), gitignored, and shipped only inside the npm package (`files: ["lib/"]`). parallix runs as plain Node CJS and `require()`s `lib/core/*.js` at runtime, so they must exist in the published package — just never in git.

## Out of Scope

- Converting `lib/core/storage.js`, `lib/core/persistent-data-migration.js`, `lib/core/nels.js`, `lib/core/subagent-limit.js` — these are higher-level modules with more complex internal dependencies
- Converting any `lib/commands/`, `lib/tools/`, `lib/forgejo/`, `test/`, or top-level files
- Writing new tests — only existing tests are preserved and must pass
- Modifying `index.js` (main entry point) or `px.js` (CLI entry point)
- Changing `tsconfig.json` — its current settings are the target configuration
- Modifying `config/agents.json`, `config/state-map.json`, or `workflow.config.json`
- Adding `"type": "module"` to `package.json` — this is deferred to a separate mission that flips the entire project

## Success Criteria

> **Falsifiability rule (ADR 0039 Part 2):** Each criterion must be falsifiable. Generic phrases are not sufficient.

- SC 1: Both `.js` source files are converted to ES module syntax (`import`/`export` replacing all `require()`/`module.exports`). Verified by grep: zero occurrences of `require(` and `module.exports` in `lib/core/mission-utils.ts` and `lib/core/verification.ts`.
- SC 2: `npm test` passes with identical pass/fail counts to baseline (1729 pass, 0 fail, 22 skipped). No new failures introduced by the conversion.
- SC 3: `npm run typecheck` (`tsc --noEmit`) reports zero errors across the entire project.
- SC 4: All exported symbols from both modules are still importable. Verified by confirming that `test/mission-utils.test.js` and `test/verification.test.js` load without `ERR_REQUIRE_ESM` or `MODULE_NOT_FOUND` errors.
- SC 5: No behavioral regression in the public APIs. Specifically:
  - `verification.js`: `runVerificationGate()`, `captureVerifiedTreeProof()`, `assertVerifiedTreeProof()`, `readPublishedTreeState()`, `formatVerificationCommand()`, `resolveVerificationAdapter()` return identical result shapes and values
  - `mission-utils.js`: `resolveMissionAdapter()`, `missionBaseDir()`, `missionBranchName()`, `inferSlug()`, `getConflictFiles()`, `findMissionDir()`, `updateGraphifyKnowledgeGraph()`, `isMissionArtifact()`, `parseConflictFilesFromMergeOutput()`, `findLastNonNoiseCommit()`, `squashTrailingBacklogNoiseIntoPreviousMission()`, `softResetTrailingBacklogNoise()` return identical result shapes and values
- SC 6: `scripts/verify-local.sh docs` passes (README.md, CHANGELOG.md, LICENSE, docs/adr/ all present).
- SC 7: TypeScript interfaces are defined for all externally consumed return shapes: `GitFn`, `MissionAdapterConfig`, `VerificationAdapterConfig`, `VerificationProof`, `PublishedTreeState`, `WorktreeEntry`.
- SC 8: The injectable-dependency pattern in `mission-utils.js` is preserved with typed signatures: `gitRunner?: Function`, `commandRunner?: Function`, `gitFn?: Function` parameters accept the same callable shapes as before.
- SC 9: Line counts of converted files differ from originals by at most ±15 lines (accounting for import statement restructuring and TypeScript interface additions). Original sizes: `verification.js` 166 lines, `mission-utils.js` 1027 lines.
- **SC 10 (no autogenerated `.js` in git):** `git ls-files lib/core/mission-utils.js lib/core/verification.js` does **not** list either file (only still-hand-written modules remain tracked). No TypeScript-compiled `.js` is committed anywhere in `lib/core/`.
- **SC 11 (clean rename history):** `git diff -M --summary main -- lib/core/mission-utils.js lib/core/mission-utils.ts` reports a `rename` (≥ 50%), and likewise for `verification`. History reads as move + ts fixes, not delete+add.
- **SC 12 (deterministic distribution):** From a tree with no compiled `.js`, `npm run prepublishOnly` regenerates `lib/core/mission-utils.js` and `lib/core/verification.js`, and `npm pack --dry-run` lists both compiled `.js` (they are required at runtime). `node -e "require('./lib/core/mission-utils'); require('./lib/core/verification')"` loads without error and exposes the same exports.
- **SC 13 (gate robustness):** `./scripts/verify-local.sh static-analysis` passes **even when compiled `lib/core/*.js` are present on disk** (i.e. after `npm test`), because `.eslintignore` excludes compiled output.

## Risks and Assumptions

- **Risk**: A non-faithful conversion would destroy git rename detection (git -M < 50%), making history read as delete+add instead of move+fixes. Mitigation: preserve original import names, helper functions, formatting, blank lines, and comments — change only what ESM/TS requires. Aim for `git diff -M` similarity ≥ 50%.
- **Risk**: `mission-utils.js` has ~15 dynamic `require('./git')` calls scattered inside individual functions. Static top-level `import` replaces these cleanly since `./git` is already `.ts` and ESM. However, if any dynamic require depends on conditional execution paths that affect module loading order, those paths must be verified. Mitigation: `./git` is already ESM, so static import is safe.
- **Risk**: `verification.js` exports `runWorkflow` as both a default export (`module.exports = runWorkflow`) and named properties (`module.exports.DEFAULT_AREA`, etc.). This dual export pattern must become `export default function runWorkflow(...)` with separate `export const DEFAULT_AREA` statements.
- **Risk**: `mission-utils.js` is 1027 lines — the largest non-command file. A single missed export or broken import would cascade. Mitigation: convert file-by-file (verification first, then mission-utils), verify each independently before proceeding.
- **Assumption**: Node.js `>=20` engine requirement supports ESM `import`/`export` in `.ts` files compiled via `tsc` with `module: NodeNext`.
- **Assumption**: Existing tests use `require()` to load modules under test. After conversion, since the compiled output is ESM, tests may need to use dynamic `import()` — but the pretest `tsc` hook compiles `.ts` to `.js` in the project root, and Node's test runner can handle the resulting files.
- **Assumption**: No other `lib/` files import from `mission-utils.js` or `verification.js` — confirmed by grep search. Only test files import from them.

## Checkpoints

- CP 1: `lib/core/verification.js` converted to `lib/core/verification.ts` — faithful rename (git -M ≥50%), all `require()` replaced with `import`, `module.exports` replaced with `export`/`export default`, TypeScript interfaces added for `GitFn`, `VerificationAdapterConfig`, `VerificationProof`, `PublishedTreeState`. Original `.js` deleted via `git rm --cached`. Individual test: `test/verification.test.js` passes. `tsc --noEmit` clean on the converted file.
- CP 2: `lib/core/mission-utils.js` converted to `lib/core/mission-utils.ts` — faithful rename (git -M ≥50%), all `require()` replaced with `import` (dynamic requires inside functions become static top-level imports since `./git` is already ESM), `module.exports` replaced with named exports, TypeScript interfaces added for `MissionAdapterConfig`, `WorktreeEntry`, and all return shapes consumed by callers. Original `.js` deleted via `git rm --cached`. Individual test: `test/mission-utils.test.js` passes. `tsc --noEmit` clean on the converted file.
- CP 3: Both files converted, original `.js` files removed from git. `.eslintignore` negation lines for `mission-utils.js` and `verification.js` deleted. Full `npm test` suite passes (1729 pass, 0 fail, 22 skipped). `tsc --noEmit` clean across entire project. `tsc` (full build) clean. `git ls-files lib/core/mission-utils.js lib/core/verification.js` — empty.

## Gates

- [ ] `npm test` — 1729 pass, 0 fail, 22 skipped (same as baseline, no new failures)
- [ ] `npm run typecheck` — `tsc --noEmit` reports zero errors
- [ ] `npm run build` — `tsc` compiles all `lib/**/*.ts` without errors
- [ ] `grep -c 'module.exports' lib/core/mission-utils.ts lib/core/verification.ts` — zero
- [ ] `grep -c 'require(' lib/core/mission-utils.ts lib/core/verification.ts` — zero (no permitted lazy requires expected)
- [ ] `git ls-files lib/core/mission-utils.js lib/core/verification.js` — empty (no compiled `.js` tracked) [SC10]
- [ ] `git diff -M --summary main -- lib/core/mission-utils.js lib/core/mission-utils.ts | grep -q rename` and same for `verification` [SC11]
- [ ] `npm run prepublishOnly && npm pack --dry-run | grep -E 'lib/core/(mission-utils|verification)\.js'` — both compiled `.js` present in the package [SC12]
- [ ] `./scripts/verify-local.sh static-analysis` passes with compiled `lib/core/*.js` present on disk [SC13]
- [ ] `scripts/verify-local.sh docs`

## Restricted Areas

- Do not modify `lib/core/storage.js`, `lib/core/persistent-data-migration.js`, `lib/core/nels.js`, or `lib/core/subagent-limit.js`.
- Do not modify `index.js`, `px.js`, or any file outside `lib/core/` (except verifying tests pass).
- Do not change test file extensions or add new test files.
- Do not modify `tsconfig.json` — its current settings (`allowJs: false`, `strict: true`, `module: NodeNext`) are the target configuration.
- Do not modify `config/agents.json`, `config/state-map.json`, or `workflow.config.json`.
- Do not add `"type": "module"` to `package.json` — deferred to a separate mission.
- Allowed file changes: `lib/core/mission-utils.ts`, `lib/core/verification.ts` (faithful renames of the originals), removal of the compiled `lib/core/mission-utils.js` / `verification.js` from git, `package.json` (build wiring only), and `.eslintignore` (remove the two negation lines for converted files).

## Stop Rules

- Stop if `npm test` introduces any new failures after conversion of a single file — investigate and fix before proceeding to the next file.
- Stop if `tsc --noEmit` reports more than 5 new errors attributable to the conversion — escalate for manual review.
- Stop if converting `mission-utils.js` requires changes to any file outside `lib/core/mission-utils.js` — this indicates scope creep.
- Stop if the dynamic `require('./git')` pattern in `mission-utils.js` cannot be cleanly converted to static `import` — this would indicate a fundamental incompatibility requiring a separate approach.
- Stop if any exported symbol from either module becomes inaccessible to importing test code — fix before continuing.
