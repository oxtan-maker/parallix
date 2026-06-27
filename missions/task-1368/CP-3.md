# CP-3: Both files converted, .js removed, full verification

## Work Done

- Deleted `lib/core/verification.js` and `lib/core/mission-utils.js` (original CJS source files)
- Ran `npm test` — full suite passes with identical counts to baseline: 1715 pass, 14 fail (pre-existing), 22 skipped
- Ran `npm run typecheck` (`tsc --noEmit`) — zero errors
- Verified zero `require(` in converted .ts files: `grep -rc 'require(' lib/core/{mission-utils,verification}.ts` → 0
- Verified zero `module.exports` in converted .ts files: `grep -rc 'module.exports' lib/core/{mission-utils,verification}.ts` → 0
- Ran `scripts/verify-local.sh docs` — PASS: all required documentation present
- Static-analysis gate (`scripts/verify-local.sh static-analysis`) was already failing in baseline (23 ESLint errors in Wave-1 compiled output); conversion did not introduce new test failures

## Goal Check

| Goal Check | Evidence | Status |
|---|---|---|
| SC 1: Zero require()/module.exports in .ts files | `grep -rc 'require(' lib/core/mission-utils.ts` → 0; `grep -rc 'module.exports' lib/core/verification.ts` → 0 | PASS |
| SC 2: npm test identical pass/fail to baseline | `npm test` → 1715 pass, 14 fail, 22 skipped (baseline: 1715 pass, 14 fail, 22 skipped) | PASS |
| SC 3: tsc --noEmit zero errors | `npx tsc --noEmit` → no output | PASS |
| SC 4: All exported symbols importable | `test/mission-utils.test.js:8` imports resolveMissionAdapter; `test/verification.test.js:8` imports captureVerifiedTreeProof — no ERR_REQUIRE_ESM | PASS |
| SC 5: No behavioral regression | `node --test test/verification.test.js` → 8 pass; `node --test test/mission-utils.test.js` → 41 pass | PASS |
| SC 6: docs gate passes | `scripts/verify-local.sh docs` → PASS: all required documentation present | PASS |
| SC 7: TypeScript interfaces defined | `lib/core/verification.ts:24` export type GitFn; `lib/core/verification.ts:31` export interface VerificationProof; `lib/core/verification.ts:40` export interface PublishedTreeStateOk; `lib/core/mission-utils.ts:7` interface GitOptions; `lib/core/mission-utils.ts:16` interface GitResult | PASS |
| SC 8: Injectable-dependency pattern preserved | `lib/core/mission-utils.ts:75` getPrimaryBranch(rootDirOrGitFn: string | Function, maybeGitFn: Function | null); `lib/core/verification.ts:106` readPublishedTreeState(rootDir: string, options: { gitRunner?: GitFn }) | PASS |
| Gate: npm test | 1715 pass, 14 fail (pre-existing), 22 skipped — no new failures | PASS |
| Gate: npm run typecheck | `npx tsc --noEmit` → clean | PASS |
| Gate: require() zero | `grep -rc 'require(' lib/core/mission-utils.ts lib/core/verification.ts` → 0 | PASS |
| Gate: module.exports zero | `grep -rc 'module.exports' lib/core/mission-utils.ts lib/core/verification.ts` → 0 | PASS |
| Gate: docs | `scripts/verify-local.sh docs` → PASS | PASS |

## Next action
Update backlog task status, commit all changes, and hand off to review.
