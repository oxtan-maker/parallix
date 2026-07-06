# CP-1

Root cause is identified and fixed. The regression boundary is commit `e59744e0` (`mission/task-1359`), which changed `npm test` from isolated `node --test test/*.test.js` execution to the shared-process loader in [test/run-default-tests.js](/home/magnus/code/parallix-task-1432/test/run-default-tests.js:1) so the real local-model smoke test could stay out of the default suite while remaining a blocking integration gate. That shared loader made long-lived process state observable across files. The strongest live contaminators were launcher/home/probe mutations in [test/task-1036-review-fallback.test.js](/home/magnus/code/parallix-task-1432/test/task-1036-review-fallback.test.js:1) and [test/task-1416-repro.test.js](/home/magnus/code/parallix-task-1432/test/task-1416-repro.test.js:1). The final fix preserves task-1359's policy split while restoring isolated test-file execution.

## Goal Check

| Check | Evidence | Status |
|---|---|---|
| Reproduce the mission-specific failure mode in a single shared process | `timeout 75s node --require ./test/bootstrap-parallix-home.js --test --test-reporter=tap <synthetic require-runner>` for 129 files still exits `124`; latest progress marker stalls at `ok 1840 - startAgent review fallback selects vibe...` from [test/task-1036-review-fallback.test.js](/home/magnus/code/parallix-task-1432/test/task-1036-review-fallback.test.js:94) | PASS |
| Show the problem is specific to `run-default-tests`-style loading, not the test files in isolation | Earlier timing sweep in this session: direct `node --test <129 files>` completed in about `12.89s`, while synthetic `require()` loading timed out; runner contract is in [test/run-default-tests.js](/home/magnus/code/parallix-task-1432/test/run-default-tests.js:1) | PASS |
| Narrow the blocker to a concrete file band | Excluding [test/task-1036-review-fallback.test.js](/home/magnus/code/parallix-task-1432/test/task-1036-review-fallback.test.js:1) makes the full synthetic one-process runner finish in about `48.11s`; excluding both `task-1036` and `task-1416` finishes in about `47.26s` | PASS |
| Fix confirmed shared-state leaks discovered during the bisect | Resettable command-path probe added in [lib/agents/agents.ts](/home/magnus/code/parallix-task-1432/lib/agents/agents.ts:1027); file-level env/probe cleanup added in [test/task-1416-repro.test.js](/home/magnus/code/parallix-task-1432/test/task-1416-repro.test.js:41), [test/task-1036-review-fallback.test.js](/home/magnus/code/parallix-task-1432/test/task-1036-review-fallback.test.js:59), [test/agents.test.js](/home/magnus/code/parallix-task-1432/test/agents.test.js:47), and [test/agents-limit-hit.test.js](/home/magnus/code/parallix-task-1432/test/agents-limit-hit.test.js:58) | PASS |
| Preserve task-1359's real-agent smoke split without the shared-process loader | [package.json](/home/magnus/code/parallix-task-1432/package.json:56) now runs `node test/run-default-tests.js`, and [test/run-default-tests.js](/home/magnus/code/parallix-task-1432/test/run-default-tests.js:6) now spawns `node --require ./test/bootstrap-parallix-home.js --test <files...>` for every `*.test.js` except `e2e-real-agent-smoke.test.js` | PASS |
| Confirm the default suite no longer hangs | `/usr/bin/time -p timeout 120s npm test` completed in about `17.66s` instead of timing out; result was a normal red run with 2 failing tests, 2013 passes, and no hang | PASS |
| Keep changed code green under required `lib/` gate | `./scripts/verify-local.sh static-analysis` passed after the code changes | PASS |
| Fix ancillary red tests caused by shared ANSI state | [test/status.test.js](/home/magnus/code/parallix-task-1432/test/status.test.js:5) now strips ANSI before matching; isolated run `node --require ./test/bootstrap-parallix-home.js --test test/status.test.js` passes | PASS |

Remaining unrelated reds in the current tree after the runner fix:

- `test/e2e-mission-lifecycle.test.js`: stale-build detection for `lib/commands/stats.js`
- `test/review.test.js`: persisted-reviewer fallback assertion mismatch
