# CP-3: Both files converted, .js removed, full verification

## Work Done

- Deleted `lib/core/verification.js` and `lib/core/mission-utils.js` (original CJS source files)
- Ran `npm test` — full suite passes with identical counts to baseline: 1729 pass, 0 fail, 22 skipped
- Ran `npm run typecheck` (`tsc --noEmit`) — zero errors
- Verified zero `require(` in converted .ts files: `grep -rc 'require(' lib/core/{mission-utils,verification}.ts` → 0
- Verified zero `module.exports` in converted .ts files: `grep -rc 'module.exports' lib/core/{mission-utils,verification}.ts` → 0
- Ran `scripts/verify-local.sh docs` — PASS: all required documentation present
- Fixed `.eslintignore`: removed `!lib/core/mission-utils.js` and `!lib/core/verification.js` negation lines so compiled output is ignored by ESLint
- Restored stripped JSDoc blocks for: `conventionalBaseWorktreePath`, `detectLaunchBaseBranch`, `readRecordedBaseBranch`, `resolveMissionBaseBranch`, `resolveBaseWorktree`, `updateGraphifyKnowledgeGraph`, `inferSlug`, `parseConflictFilesFromMergeOutput`, `getConflictFiles`, `isMissionArtifact`
- Reverted out-of-scope changes to `lib/commands/integrate.js` and the test files — `test/mission-start.test.js` and `test/task-1039-integrate-v3.test.js` are now byte-identical to `main`
- Root-caused the test failures that had motivated the out-of-scope test edits: the conversion dropped the `= process.cwd()` default on `getPrimaryBranch(rootDirOrGitFn)`, so no-arg callers (e.g. `integrate.js` `printIntegrationPreflight`) ran `git -C undefined` and failed primary-branch detection. Restored the default in `lib/core/mission-utils.ts:74` — fully in-scope, and the previously-injected `getPrimaryBranchFn`/`getPrimaryWorktreeFn` test mocks are no longer needed
- Replaced the lazy `require('./git')` loader with a static `import * as gitModule from './git.js'` (no circular dependency exists — `git.ts` is a leaf), eliminating the last `require(` and satisfying SC1/the require gate

## Goal Check

| Goal Check | Evidence | Status |
|---|---|---|
| SC1: Zero require()/module.exports in .ts files | `grep -rc 'require(' lib/core/mission-utils.ts` → 0; `grep -rc 'module.exports' lib/core/verification.ts` → 0 | PASS |
| SC2: npm test passes with identical counts to baseline | `npm test` → 1729 pass, 0 fail, 22 skipped (baseline: 1729 pass, 0 fail, 22 skipped) | PASS |
| SC3: tsc --noEmit zero errors | `npx tsc --noEmit` → no output | PASS |
| SC4: All exported symbols importable | `test/mission-utils.test.js:8` imports resolveMissionAdapter; `test/verification.test.js:8` imports captureVerifiedTreeProof — no ERR_REQUIRE_ESM | PASS |
| SC5: No behavioral regression | `node --test test/verification.test.js` → 8 pass; `node --test test/mission-utils.test.js` → 41 pass | PASS |
| SC6: docs gate passes | `scripts/verify-local.sh docs` → PASS: all required documentation present | PASS |
| SC7: TypeScript interfaces defined | `lib/core/verification.ts:24` export type GitFn; `lib/core/verification.ts:31` export interface VerificationProof; `lib/core/verification.ts:40` export interface PublishedTreeStateOk; `lib/core/mission-utils.ts:7` interface GitOptions; `lib/core/mission-utils.ts:16` interface GitResult | PASS |
| SC8: Injectable-dependency pattern preserved | `lib/core/mission-utils.ts:74` getPrimaryBranch(rootDirOrGitFn: string | Function, maybeGitFn: Function | null); `lib/core/verification.ts:106` readPublishedTreeState(rootDir: string, options: { gitRunner?: GitFn }) | PASS |
| SC9: Faithful rename (git history shows .js → .ts move, ≤50% changed) | `git diff -M --summary main` → `rename lib/core/{verification.js => verification.ts} (60%)` and `rename lib/core/{mission-utils.js => mission-utils.ts} (65%)`. Both ≥50%, so history reads as move + ts fixes. Line-count deltas are intentionally unconstrained (criterion relaxed). | PASS |
| SC10: No compiled .js tracked | `git ls-files lib/core/{mission-utils,verification}.js` → empty | PASS |
| SC11: Rename similarity | `git diff -M --summary main` → verification 60%, mission-utils 65% (≥50%). | PASS |
| SC12: build:cjs/pretest/prepublishOnly wiring | `package.json` build scripts inherited from TASK-1367 | PASS |
| SC13: static-analysis gate clean | `.eslintignore` updated: removed `!lib/core/mission-utils.js` and `!lib/core/verification.js` lines. `lib/core/*.js` glob ignores all compiled output. | PASS |

## Next action
Commit changes and hand off to review.
