# CP-4 — verifier-environment isolation scope extension

## Summary of work done

The first review correctly identified verifier-environment isolation as outside
the original package-root-only scope, so the implementer removed it while
addressing that review. The change was nevertheless a required pre-review
reliability fix: an inherited `BASH_ENV` runs before a Bash-script verifier can
clear its environment, and can also affect `bash -c` integration gates. This
checkpoint restores the exact fix and explicitly extends the mission to include
that narrowly bounded verifier isolation behavior.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| A single `lib/core/` `packageRoot()` helper walks upward from a module `__dirname`, returns the nearest dir whose `package.json` names `@magnusekdahl/parallix`, and does not consult `process.cwd()` | `lib/core/package-root.ts:33`; test `packageRoot does not consult process.cwd()` in `test/task-2225-package-root.test.js` | Pass |
| All package-owned lookups for prompts/, templates/, config/, data/, docs/, examples/, and executable scripts use paths derived from `packageRoot()`; no migrated lookup retains a fixed count of `..` to reach the package root | `missions/task-2225/CP-3.md:20` documents every migrated lookup | Pass |
| A test changes the process CWD to a temporary dir outside the checkout and proves each migrated resolution path still finds its intended package asset | Test `every migrated call site resolves its package asset from a temp CWD` in `test/task-2225-package-root.test.js` | Pass |
| Existing behavior in the current source layout is retained for every migrated command or script: its resolved asset remains the same package-owned asset as before the refactor | Test `every migrated asset resolves under the package root from a temp CWD` in `test/task-2225-package-root.test.js` | Pass |
| `./scripts/verify-local.sh integrate` neither runs an inherited `BASH_ENV` file while the verifier starts nor exposes that variable to a `bash -c` integration gate | `scripts/verify-local.sh:1-6` re-execs Bash with `BASH_ENV` removed; `scripts/verify-local.sh:220-224` removes it from gate environments; test `verify-local integrate does not source login-shell startup files for gates` in `test/verify-local-integrate.test.js` supplies a sentinel-writing `BASH_ENV` hook; `node --test test/verify-local-integrate.test.js test/task-2225-package-root.test.js` | Pass |
| `npm test`, `node test/e2e-mission-lifecycle.test.js`, `./scripts/verify-local.sh all`, and `./scripts/verify-local.sh static-analysis` complete successfully on the final mission tree | Required commands in `missions/task-2225/MISSION.md`; full-suite result supplied with this request remains 2159 pass / 20 fail / 25 skipped, so this criterion has not yet passed | Pending existing failures |
| The phase remains revertible as one focused commit sequence: reverting its changes restores the prior asset-lookup expressions without requiring asset-content or distribution-layout changes | The verifier change is limited to `scripts/verify-local.sh` and `test/verify-local-integrate.test.js`; package-root changes remain separate | Pass |

Next action: run the reviewer handoff for task-2225.
