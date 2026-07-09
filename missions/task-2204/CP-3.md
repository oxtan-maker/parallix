Summary of work done

Ran the required verification commands after the Variant A removal work. `docs`, `static-analysis`, and the mission-focused regression suites passed. `graphify update .` could not run because the `graphify` CLI is not installed in this environment, and `./scripts/verify-local.sh all` still fails because `test/px-runtime-smoke.test.js` is broken under the current Node runtime (`v22.22.2`) with `ERR_UNKNOWN_FILE_EXTENSION` for `px.ts`. I did not attempt to fix that unrelated gate failure.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Mission-focused regression coverage passes after the change | `node --test test/task-2204-integrate-no-variant-a.test.js test/task-1109.test.js test/integrate.test.js test/post-integrate-hook.test.js`, `node --test test/review-commands.test.js test/task-1219-fallback.test.js` | PASS |
| Documentation gate passes on the final tree | `./scripts/verify-local.sh docs` | PASS |
| Required `lib/` static-analysis gate passes on the final tree | `./scripts/verify-local.sh static-analysis` | PASS |
| Full repo gate was executed and the remaining blocker is unrelated to task-2204 | `./scripts/verify-local.sh all`, `node --test test/px-runtime-smoke.test.js`, `test/px-runtime-smoke.test.js` | FAIL |
| Final-tree evidence shows merged PRs now fail preflight with recovery guidance | `lib/commands/integrate.ts:1024`, `lib/commands/integrate.ts:1181`, `"integrate rejects merged Forgejo PRs during preflight with recovery guidance"` | PASS |
| Graph update was attempted after code changes | `graphify update .`, `lib/commands/integrate.ts:674`, `lib/commands/integrate.ts:795` | FAIL |

Next action: resolve the unrelated `test/px-runtime-smoke.test.js` failure under Node `v22.22.2` or run the full gate in an environment where `node px.ts` is supported, then rerun `./scripts/verify-local.sh all`.
