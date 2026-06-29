# Mission: Convert review subsystem from CommonJS to TypeScript (task-1375)

## Goal
Convert all 10 `.js` files in `lib/review/` to TypeScript (`.ts`) with ES module syntax (`import`/`export`), add explicit type annotations derived from existing JSDoc, and remove the `.js` files from git tracking and lint gates. The public API surface of every converted module must remain byte-compatible with callers in `test/` and workflow commands.

## Why Now
This is Mission 9 in the CJS→TS migration wave. All upstream dependency missions (TASK-1366 core, TASK-1372 agents, TASK-1374 tools) are already converted, so the review subsystem can be migrated without unresolved cross-imports. The review directory is the largest remaining JS subtree (~4,000+ lines across 10 files) and contains the autonomous review loop — the highest-risk conversion in the codebase. Completing it removes the last major blocker before the repo can ship with `allowJs: false` in tsconfig.

## Refinement Signals
- Predicted NEL bucket: Large (235+)
- Confidence: Medium (heavy internal circular dependencies require careful import restructuring)
- Selection note: activate as-is
- Main drivers: largest remaining JS subtree, autonomous review loop is highest-risk path, upstream deps are cleared

## Scope
- Convert these 10 files from `lib/review/*.js` to `lib/review/*.ts`: (first git mv so history becomes correct)
  1. `review.js` — re-export hub / main entry point
  2. `review-adapter.js` — provider boundary (Forgejo/product-config)
  3. `review-artifacts.js` — artifact path I/O and normalization
  4. `review-commands.js` — command dispatcher and CLI handlers (1,471 lines)
  5. `review-events.js` — event persistence and classification
  6. `review-loop.js` — autonomous review loop orchestration (~1,100 lines)
  7. `review-polling.js` — polling utilities
  8. `review-prompts.js` — prompt assembly from template files
  9. `review-state.js` — reviewer-family state persistence (304 lines)
  10. `rebase.js` — pre-review rebase helpers
- Replace all `require()` with ES `import` from converted sibling modules using relative `.js` extensions (e.g., `import { foo } from './review-state.js'`)
- Replace all `module.exports` with named ES `export` statements
- Derive TypeScript types from existing JSDoc `@param`/`@returns`/`@typedef` annotations — do not drop or weaken existing type contracts
- Preserve the `review.js` re-export hub pattern by exporting named bindings from sibling modules and assigning `module.exports = review` with property assignments (or the ES equivalent: re-export via `export { ... } from './review-*.js'` then `export { review }` as default)
- Add `lib/review/*.js` to `.gitignore` and `.eslintignore` with `!lib/review/<file>.js` negation lines for any file not converted in this mission; delete negations as each file is converted
- Ensure compiled `.js` output from `npm run build:cjs` is ignored by ESLint (via `.eslintignore` negation removal)
- Update test imports where tests reference `lib/review/*.js` to `lib/review/*.ts` (tests use `require()` which works with compiled output, but source-level references should point to `.ts`)
- ensure the .ts is >=50% similar so git history shows it as a git mv

## Out of Scope
- Modifying any file outside `lib/review/` (no changes to `lib/core/`, `lib/agents/`, `lib/tools/`, `lib/commands/`, `test/`, or `prompts/`) unless minimally needed for the in-scope ts migration
- Adding new functionality, refactoring logic, or changing behavior
- Converting test files under `test/` (tests continue to `require()` the compiled `.js` output)
- Changing `tsconfig.json` compiler options
- Updating ADRs or documentation beyond what is necessary to reflect the review directory's status in the migration
- Addressing the lazy `require()` in `review-loop.js:141` (`maybeUpdateGraphifyBeforeReview`) — this is a real circular dependency that can be resolved with a lazy dynamic `import()` during execution, but the functional behavior must remain identical

## Success Criteria
> **Falsifiability rule (ADR 0039 Part 2):** Each criterion must be falsifiable.

1. All 10 files in `lib/review/` exist as `.ts` files. `git ls-files lib/review/*.js` returns empty (zero lines).
2. `tsc --noEmit` reports zero errors against the converted `lib/review/*.ts` files with zero warnings.
3. `npm test` passes with the same pass/fail count as baseline (no regressions from conversion).
4. `grep -r 'module\.exports' lib/review/*.ts` returns zero matches across all 10 converted files.
5. `grep -r 'require(' lib/review/*.ts` returns zero matches (no remaining CommonJS require calls; dynamic `import()` is acceptable only where a real circular dependency exists).
6. Every test file that imports from `lib/review/` continues to pass: `test/review-state-class.test.js`, `test/review-prompts.test.js`, `test/review-events.test.js`, `test/review-commands.test.js`, `test/review-commands-additional.test.js`, `test/review-commands-supplemental.test.js`, `test/review-identity.test.js`, `test/review-identity-placeholder.test.js`, `test/review-autoderive.test.js`, `test/review-loop.test.js` (task-1209), `test/rebase.test.js`, `test/rebase_diagnostics.test.js`, `test/rebase_hardening.test.js`, `test/task-1036-review-fallback.test.js`, `test/task-1079-review-blocked-fallback.test.js`, `test/task-1107-repro.test.js`, `test/task-1109.test.js`, `test/task-1209-consume-artifacts.test.js`, `test/task-1219-fallback.test.js`, `test/task-1221-stale-blocked-relaunch.test.js`, `test/task-1272-standalone-rebase.test.js`, `test/task-1272-standalone-cycle.test.js`.
7. `./scripts/verify-local.sh static-analysis` passes all three stages (ESLint clean, tsc clean, test-hygiene clean) with compiled `lib/review/*.js` present in the worktree.
8. `npm run prepublishOnly && npm pack --dry-run | grep 'lib/review/'` shows compiled `.js` files in the tarball for all 10 review modules.
9. `node -e "const r = require('./lib/review/review'); console.log(typeof r.review, typeof r.reviewStateFile, typeof r.pollForReview)"` prints `function function function` (exports are intact).
10. The `review.js` re-export hub retains all 40+ exported symbols: `review`, `POLL_TIMEOUT`, `delay`, `resolvePollIntervalMs`, `resolvePollTimeoutMs`, `formatElapsed`, `isPollTimeout`, `pollForReview`, `pollForDisposition`, `buildMetadataFooter`, `reviewArtifactPath`, `readArtifactFile`, `deleteArtifactFile`, `normalizeReviewVerdict`, `normalizeDisposition`, `postWorkflowComment`, `postWorkflowReview`, `consumeReviewerArtifacts`, `consumeImplementerArtifacts`, `recordStageStatsSafe`, `maybeUpdateGraphifyBeforeReview`, `commitSafeMissionArtifacts`, `rebaseBeforeReviewRound`, `applyAgentFallback`, `persistNormalizedPhaseRepair`, `startReviewLoop`, `flagValue`, `readTextFlag`, `formatStaticReviewFindings`, `formatStaticReviewSuccess`, `postStaticReviewComment`, `performStaticReview`, `verifyReview`, `submitForReview`, `readComments`, `pushRound`, `showReviewStatus`, `commentRound`, `submitReviewRound`, `closeMissionPr`, `createEventHandler`, `importLegacyHandler`.

## Risks and Assumptions
- **Circular dependencies**: The review files have heavy internal cycles (e.g., `review-loop.js` imports from `review-adapter`, `review-state`, `review-artifacts`, `review-prompts`; `review-artifacts` imports from `review-state`, `review-adapter`, `review-events`). ES modules do not support circular `import` at the top level. We will use dynamic `import()` or restructured named exports to break cycles where needed.
- **Lazy require in review-loop.js:141**: `maybeUpdateGraphifyBeforeReview` uses `require('../core/mission-utils').updateGraphifyKnowledgeGraph` as a lazy import to break a cycle. This must be preserved as a dynamic `import()` call.
- **review.js re-export hub**: The `module.exports = review` pattern with property assignments (lines 48-97) must be replicated in ES module form. The simplest approach is named exports from sibling modules plus a default export of the `review` function.
- **JSDoc type preservation**: The review files have extensive JSDoc (especially `review-state.js`, `review-loop.js`, `review-commands.js`). Conversion must preserve these annotations and derive corresponding TypeScript types.
- **Assumption**: All dependency missions (core, agents, tools) are already converted and their `.ts` files export ES module syntax.
- **Assumption**: Existing tests cover the review subsystem sufficiently to detect regressions from the conversion.

## Checkpoints
- CP 1: Add `lib/review/*.js` to `.gitignore` and `.eslintignore` with negation lines for all 10 files. Run baseline `npm test` and `tsc --noEmit` to confirm pre-conversion state.
- CP 2: Convert `review-polling.js` (161 lines, simplest — no internal cycles, only imports from `core/fmt` and `review-adapter`). Verify `tsc --noEmit` clean.
- CP 3: Convert `review-state.js` (304 lines, well-annotated JSDoc, imports from `core/git`, `core/mission-utils`, `core/fmt`). Verify `tsc --noEmit` clean.
- CP 4: Convert `review-prompts.js` (243 lines, imports from `core/mission-utils` and `review-artifacts`). Verify `tsc --noEmit` clean.
- CP 5: Convert `review-events.js` (1,058 lines, imports from `core/git`, `core/mission-utils`, `core/fmt`, `review-state`). Verify `tsc --noEmit` clean.
- CP 6: Convert `rebase.js` (171 lines, imports from `core/fmt`, `core/git`, `core/mission-utils`, `review-adapter`). Verify `tsc --noEmit` clean.
- CP 7: Convert `review-adapter.js` (222 lines, imports from `core/product-config`, `tools/forgejo`). Verify `tsc --noEmit` clean.
- CP 8: Convert `review-artifacts.js` (685 lines, imports from `core/fmt`, `core/mission-utils`, `review-state`, `review-adapter`, `review-events`). Verify `tsc --noEmit` clean.
- CP 9: Convert `review.js` — the re-export hub. Replace `require()` re-exports with ES `export { ... } from` statements and a default export. Verify all 40+ symbols are accessible.
- CP 10: Convert `review-commands.js` (1,471 lines, heavy aggregator). Remove negation lines from `.gitignore`/`.eslintignore`. Verify `tsc --noEmit` clean.
- CP 11: Convert `review-loop.js` (~1,100 lines, most complex). Handle the lazy `require()` for `updateGraphifyKnowledgeGraph` as dynamic `import()`. Remove negation lines. Verify `tsc --noEmit` clean.
- CP 12: Remove all negation lines from `.gitignore` and `.eslintignore` for `lib/review/`. Run `npm test`, `tsc --noEmit`, `./scripts/verify-local.sh static-analysis`, and `npm pack --dry-run`. Final gate.

## Gates
- [ ] `tsc --noEmit` — zero TS errors
- [ ] `npm test` — same pass/fail count as baseline
- [ ] `./scripts/verify-local.sh static-analysis` — all three stages pass
- [ ] `git ls-files lib/review/*.js` — empty
- [ ] `grep -rc 'module\.exports' lib/review/*.ts` — zero
- [ ] `node -e "require('./lib/review/review')"` — loads with exports intact

## Restricted Areas
- Do not modify any file outside `lib/review/` except `.gitignore` and `.eslintignore` (for negation line management)
- Do not alter the logic, behavior, or exported API of any review module
- Do not change test files — tests import compiled `.js` output, which the build pipeline generates from `.ts` sources
- Do not modify `tsconfig.json`, `package.json`, or any configuration files

## Stop Rules
- If `tsc --noEmit` produces errors that cannot be resolved by type inference from JSDoc (e.g., missing type definitions from dependencies), pause and escalate — do not add `@ts-ignore` or `any` bypasses
- If `npm test` introduces new failures that correlate with the review conversion (not pre-existing flaky tests), stop and investigate before continuing
- If a circular dependency cannot be broken with dynamic `import()` without changing observable behavior, pause and propose a restructuring plan
- If the review.js re-export hub cannot expose all 40+ symbols via ES module syntax, stop and propose an alternative approach
