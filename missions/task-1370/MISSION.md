# Mission: Convert draft, active, checkpoint, handoff commands to TypeScript (task-1370)

## Goal
Convert the four remaining JavaScript command files — `lib/commands/draft.js` (1043 lines), `lib/commands/active.js` (671 lines), `lib/commands/checkpoint.js` (78 lines), and `lib/commands/handoff.js` (689 lines) — to TypeScript (`.ts`) while preserving all exported symbols, JSDoc annotations, function signatures, helper internals, formatting, and comments. Each file must remain a faithful rename (git diff --find-renames ≥ 50% similarity) with no behavioral changes.

## Why Now
- All dependency modules (`lib/core/*`, `lib/agents/*`, `lib/review/*`, `lib/tools/*`) are already converted to TypeScript, so the import graph for these four files now targets `.js` compiled output.
- Simpler commands (`status`, `diff`, `review`, `rebase`, `resolve-conflict`, `coverage-gate`, `stats`, `stats-backfill`, `config`) and integration commands (TASK-1371) are already `.ts`.
- `lib/commands/*.js` is currently blocked from ESLint by `.eslintignore`; converting these files enables the static-analysis gate to lint the entire `lib/commands/` directory.
- These four files represent the heaviest command files in the codebase (~2500 combined lines) with the most cross-subsystem dependencies, making this the critical path for completing the JS→TS migration.

## Refinement Signals
- Predicted NEL bucket: Large (235+)
- Confidence: High
- Selection note: activate as-is
- Main drivers: dependency-chain complexity (draft.js imports from active, agents, core/*, stats, verification, crypto, gitignore, product-config, backlog), file size (draft.js 1043 lines, active.js 671 lines, handoff.js 689 lines), and integration-gate impact (removes `lib/commands/*.js` from ESLint ignore).

## Scope
- Convert `lib/commands/draft.js` → `lib/commands/draft.ts` (1043 lines, 25+ exported members)
- Convert `lib/commands/active.js` → `lib/commands/active.ts` (671 lines, 10+ exported members)
- Convert `lib/commands/checkpoint.js` → `lib/commands/checkpoint.ts` (78 lines, default export)
- Convert `lib/commands/handoff.js` → `lib/commands/handoff.ts` (689 lines, 6+ exported members)
- Replace `const X = require('...')` with ES `import` from corresponding `.ts` modules (using `.js` extension to reference compiled output)
- Replace `module.exports = ...` / `module.exports.X = ...` with ES `export` / `export =`
- Preserve all JSDoc `@param`, `@returns`, `@type` annotations as valid TypeScript types or retain as JSDoc
- Preserve all internal helper functions, variable names, formatting, and comments
- Convert `@ts-nocheck` pattern where used (e.g., stats.ts) for consistency on large files
- Preserve `.eslintignore`'s `lib/commands/*.js` blanket ignore so compiled `build:cjs` output stays out of ESLint while this directory still contains hand-written `.js` commands owned by other missions
- Preserve `.gitignore`'s `lib/commands/*.js` entry so compiled `build:cjs` output remains untracked; rename detection comes from tracked `.js` removals plus tracked `.ts` additions, not from leaving generated `.js` visible in the worktree
- Remove `git rm --cached lib/commands/{draft,active,checkpoint,handoff}.js` (compiled output removed from tracking)
- All existing tests in `test/draft.test.js`, `test/active.test.js`, `test/handoff.test.js` must continue to pass via `require()` of the compiled `.js` output

## Out of Scope
- Converting `lib/commands/mission-start.js`, `lib/commands/verify.js`, `lib/commands/setup.js`, `lib/commands/setup-review.js`, `lib/commands/repair-handoff.js` (handled by other tasks)
- Modifying `px.js` CLI entry point (still uses `require()` for these commands; acceptable as-is since `px.js` is not in scope)
- Modifying `lib/core/subagent-limit.js` or `lib/core/nels.js` (already `.js`, excluded from ESLint)
- Rewriting or refactoring command logic — purely a faithfulness-preserving language conversion
- Updating `test/*.test.js` files (they `require()` the compiled output; no source changes needed)
- Creating new tests or modifying existing test assertions

## Success Criteria
> **Falsifiability rule (ADR 0039 Part 2):** Each criterion must be falsifiable. Generic phrases are not sufficient.

1. **Faithful rename per file:** `git diff -M --summary <parent-commit> -- lib/commands/{draft,active,checkpoint,handoff}.js lib/commands/{draft,active,checkpoint,handoff}.ts` reports each file as a `rename` with ≥ 50% similarity.
2. **No `module.exports` remaining:** `grep -rc 'module\.exports' lib/commands/{draft,active,checkpoint,handoff}.ts` returns zero matches across all four files.
3. **No `require()` from converted modules:** `grep -rc "require('\.\./\|require('lib/" lib/commands/{draft,active,checkpoint,handoff}.ts` returns zero matches for internal project imports (node builtins like `fs`, `path`, `child_process` are permitted).
4. **All exports preserved:** Every symbol exported from the original `.js` files is still exported from the `.ts` equivalents. Specifically:
   - `draft.ts`: `draft`, `runDraftCommand`, `recordDraftStats`, `buildDraftPrompt`, `recordDraftImplementer`, `enforceDraftCommitSafety`, `fallbackDraftCommitMessage`, `bootstrapBacklogTask`, `ensureGraphifyWorkspace`, `ensureGraphifyIgnore`, `ensureMissionBranch`, `ensureMissionBaseBranchRecorded`, `ensureWorktree`, `ensureMissionFile`, `ensureDraftRepoConfigCommitted`, `ensureRepoExists`, `classifyDraftEntries`, `isUnmergedStatus`, `isDeletedStatus`, `isMissionTaskPath`, `isExpectedDraftPath`, `validateDraftClassification`, `normalizeDraftClassification`, `buildRestartPrompt`, `restartDraftAgent`
   - `active.ts`: `active`, `buildExecutePrompt`, `buildCheckpointContext`, `selectLaunchAndRecord`, `enforceExecuteCommitSafety`, `runHandoffAndReview`, `applyExecuteFallback`, `unquoteGitStatus`
   - `checkpoint.ts`: default export `checkpoint`
   - `handoff.ts`: `verifyHandoff`, `performHandoff`, `gatekeeper`, `runDeclaredGates`, `captureNelAtHandoff`
5. **TypeScript compilation clean:** `npm run typecheck` (i.e., `tsc --noEmit`) produces zero errors on the four new `.ts` files.
6. **Tests pass:** `npm test` completes with all existing tests passing, including `test/draft.test.js`, `test/active.test.js`, and `test/handoff.test.js`.
7. **Static-analysis gate clean:** `./scripts/verify-local.sh static-analysis` passes all three stages (ESLint, tsc, test-hygiene).
8. **Compiled output loads:** `node -e "require('./lib/commands/draft')"`, `node -e "require('./lib/commands/active')"`, `node -e "require('./lib/commands/checkpoint')"`, and `node -e "require('./lib/commands/handoff')"` each load without errors and expose the same exports as the original `.js` files.
9. **ESLint ignore preserved:** `.eslintignore` still contains the `lib/commands/*.js` blanket ignore so compiled output and still-hand-written command `.js` files stay out of ESLint during this wave. This mission must not add command-specific negations that make unrelated legacy `.js` block the gate.
10. **Gitignore preserved:** `.gitignore` still contains `lib/commands/*.js`, and `git status --short` shows generated `lib/commands/*.js` as ignored rather than untracked after `npm run build:cjs` or `npm test`.

## Risks and Assumptions
- **Assumption:** All imported modules (`lib/core/*.ts`, `lib/agents/*.ts`, `lib/tools/*.ts`, `lib/review/*.ts`) export their symbols in a compatible way (default or named exports) for ES `import` syntax.
- **Risk:** `draft.js` has 25+ exports with circular-ish references (e.g., `draft.js` imports from `active.js` and vice versa via `unquoteGitStatusPath`). The ES module import graph may surface circular-dependency issues; mitigated by using `export =` patterns where needed.
- **Risk:** `active.js` accepts an `options` object with injection points for testing (mockable dependencies). The `.ts` conversion must preserve this injection pattern exactly.
- **Risk:** `handoff.js` references `gatekeeper` as `module.exports.gatekeeper = gatekeeper` — a named export of a module-level variable. This must translate to a proper ES export.
- **Assumption:** The `@ts-nocheck` pattern (used in `stats.ts`) is acceptable for very large files where full type annotation would be mechanical and error-prone. Each converted file will carry `@ts-nocheck` if it exceeds ~1500 lines or has 50+ callback-heavy functions.
- **Assumption:** `px.js` CLI will continue to `require()` the compiled `.js` output; no changes to `px.js` are needed for this mission.
- **Risk:** Adding command-specific `.eslintignore` negations in this wave would make unrelated hand-written `lib/commands/*.js` fail ESLint and break the required static-analysis gate. Mitigation: keep the existing `lib/commands/*.js` blanket ignore untouched in this mission.

## Checkpoints
- CP 1: Convert `lib/commands/checkpoint.ts` (78 lines, simplest — default export, no dependencies on other commands). Verify: `tsc --noEmit`, `npm test`, rename ≥ 50%.
- CP 2: Convert `lib/commands/handoff.ts` (689 lines, moderate complexity — imports from core, tools, review). Verify: same gates.
- CP 3: Convert `lib/commands/active.ts` (671 lines — imports from handoff, mission-start, review, agents, core, tools). Verify: same gates.
- CP 4: Convert `lib/commands/draft.ts` (1043 lines, most complex — imports from active, agents, core/*, stats, verification, crypto, gitignore, product-config, backlog). Verify: same gates.
- CP 5: Restore the canonical `lib/commands` ignore posture: keep `lib/commands/*.js` in both ignore files, ensure the four converted `.js` files are removed from git tracking, run the full static-analysis gate, and confirm generated `lib/commands/*.js` stay ignored rather than untracked.

## Gates
- [ ] `npm run typecheck`
- [ ] `npm test`
- [ ] `./scripts/verify-local.sh static-analysis`
- [ ] `git diff -M --summary <parent-commit> -- lib/commands/{draft,active,checkpoint,handoff}.js lib/commands/{draft,active,checkpoint,handoff}.ts`
- [ ] `grep -c 'module\.exports' lib/commands/{draft,active,checkpoint,handoff}.ts`
- [ ] `node -e "require('./lib/commands/draft')"`
- [ ] `node -e "require('./lib/commands/active')"`
- [ ] `node -e "require('./lib/commands/checkpoint')"`
- [ ] `node -e "require('./lib/commands/handoff')"`

## Restricted Areas
- **Do not modify** `px.js` — the CLI entry point remains unchanged; it uses `require()` which works with compiled output.
- **Do not modify** `test/*.test.js` — tests import compiled output via `require()`; no source changes needed.
- **Do not modify** `lib/core/*.ts`, `lib/agents/*.ts`, `lib/review/*.ts`, `lib/tools/*.ts` — these are already converted and are dependencies, not targets.
- **Do not modify** `lib/commands/mission-start.js`, `lib/commands/verify.js`, `lib/commands/setup.js`, `lib/commands/setup-review.js`, `lib/commands/repair-handoff.js` — handled by other tasks.
- **Do not modify** `lib/core/subagent-limit.js` or `lib/core/nels.js` — intentionally left as `.js`.
- **Do not rewrite** any command logic — this is a language conversion, not a refactor. Preserve function names, parameter order, control flow, and side effects exactly.

## Stop Rules
- Stop converting a file if `tsc --noEmit` surfaces structural type errors that cannot be resolved by adding `@ts-nocheck` or JSDoc typedefs without rewriting logic. Escalate to the review team.
- Stop if `git diff -M` shows < 50% similarity for any file, indicating a rewrite rather than a faithful rename. Investigate and revert to a closer translation.
- Stop if `npm test` regression is detected that cannot be traced to a change in test expectations (i.e., behavioral change in the command). Do not proceed until the regression root cause is understood.
- Stop if ESLint reports errors on the new `.ts` files that indicate missing type definitions for imported modules — this suggests a dependency was not properly converted.
