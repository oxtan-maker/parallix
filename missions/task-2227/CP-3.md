# CP-3: Final verification and rollback proof

Completed the T4 cutover verification on the final `dist/` runtime layout. The
remaining sibling-path test references were moved to built runtime modules (or
to `.ts` sources for source-inspection assertions). Static analysis now creates
temporary declarations only while typechecking tests, then removes them so ADR
0044's no-declarations distribution contract remains unchanged. The final
runtime, static-analysis, mutation, and lifecycle gates all pass.

Rollback was verified before the final rebase in a disposable worktree at the
then-current T4 tip `b4050dc9`: reverting the two T4 commits, running
`npm run build:cjs`, and then running `node index.js --help` completed
successfully. The rebase rewrote those equivalent phase commits to `16d63f0a`
and `5a4427f0`; the disposable worktree was removed after the check.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Tests build and execute the `dist/` runtime | `package.json:58-61`; `test/fmt-enforcement.test.js`; `npm test` → 884 passed, 0 failed | PASS |
| Verification, coverage, and publish entry points use `dist/` | `package.json:55`, `package.json:61`, `scripts/verify-local.sh:38-45`; `./scripts/verify-local.sh static-analysis` → all four stages passed | PASS |
| TypeScript diffs map to built mutation targets | `lib/core/mutation-scoper.ts:43-56`; `./scripts/verify-local.sh mutation-gate --dry-run` selected seven `dist/lib/**/*.js` targets | PASS |
| No tracked sibling runtime remains and generated output stays isolated | `git ls-files 'lib/**/*.js' 'index.js' 'px.js'` → no output; `eslint.config.mjs:9-15`, `eslint.config.mjs:74-77` | PASS |
| Required runtime and lifecycle gates pass | `npm test` → 884/884 passed; `./scripts/verify-local.sh all` → 884/884 passed; `node test/e2e-mission-lifecycle.test.js` → 6/6 passed | PASS |
| ADR 0049 records the T4 layout correction | `docs/adr/0049-diff-scoped-mutation-testing-with-ratchet-enforcement.md:152` | PASS |
| Sibling rollback path remains functional | `package.json:54`; isolated revert of the two T4 phase commits (now `16d63f0a` and `5a4427f0`), followed by `npm run build:cjs` and `node index.js --help` | PASS |

Next action: Commit CP-3 and hand the completed mission to review.
