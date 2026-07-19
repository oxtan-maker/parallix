# CP-2: Owned temporary-writer cleanup

## Summary

Completed the in-scope writer inventory and moved capture cleanup to ownership-scoped directories.

| Writer | Artifact / owner | Cleanup and retention |
|---|---|---|
| Real-agent smoke fixture (`setupRepository`) | `parallix-real-agent-*` directory, owned by one smoke invocation | `runRealAgentSmoke` finally block removes it; `PARALLIX_E2E_KEEP_TMP=1` retains that invocation only. |
| Real-agent smoke command capture (`runWorkflowAllowFail`) | `parallix-real-agent-capture-*` directory with stdout/stderr files, owned by one workflow command | finally block removes the owned directory on normal, launch, command-failure, and timeout paths; the same explicit smoke retention option retains it. |
| OpenCode export capture (`captureOpencodeExport`) | `opencode-export-*` directory with `stdout.json`, owned by one export capture | `finish` removes only the mkdtemp directory on clean, launch-error, child-error, oversize, and timeout paths; `PARALLIX_KEEP_TEMP_ARTIFACTS=1` or `retainTemp` is explicit opt-in. |
| Integration backlog-noise patch (`prepareNoisePatchForSquash`) | `parallix-integrate-noise-*` directory and `backlog-noise.patch`, owned by that integration invocation | the returned `cleanup` removes only its mkdtemp directory after the squash path; the reset-failure path removes the same owned directory before returning an error; no retention option. |
| Red/green proof helper (`runReproAtRef`) | `redgreen-*` directory and detached `wt` worktree, owned by the proof invocation | `finally` first removes its worktree, then its mkdtemp root, on success, test failure, and Git/worktree errors; no retention option. |
| Mutation gate | `mutation-gate-*` scratch directory and Stryker config, owned by one gate invocation | `finally` removes only the mkdtemp directory after success, runner error, missing report, or threshold failure; no retention option. |
| Coverage gate and test fixtures | Coverage owns `coverage-gate-tmp-*`, `node-coverage-*`, and `graphify-*`; test helpers own mkdtemp fixture roots beneath the gate-owned `TMPDIR` | coverage tracks and removes its per-run roots; fixture helpers remove their own roots in `finally`/test cleanup. No default retention. |

The focused tests cover the smoke writer’s normal, command-failure, timeout, second-open launch-error, retention, and unrelated/concurrent path behavior. OpenCode export coverage covers clean, launch-error, timeout, child-error, oversize, and opt-in retention behavior.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC1 inventory identifies artifact, owner, cleanup, and retention | `lib/commands/integrate.ts:57`, `lib/tools/redgreen.ts:63`, `lib/commands/mutation-gate.ts:239`, `lib/commands/coverage-gate.ts:146`, `lib/agents/opencode-export.ts:95`, `test/e2e-real-agent-smoke.test.js:521` | PASS |
| SC2 cleanup covers success and failures, with retention coverage | `"prepareNoisePatchForSquash cleans only its owned patch directory when reset fails"`, `"real-agent smoke captures clean up after normal, command-failure, and timeout runs"`, `"captureOpencodeExport removes its owned temporary directory after launch error and timeout"` | PASS |
| SC3 smoke stdout/stderr captures clean on normal, launcher failure, and timeout | `test/e2e-real-agent-smoke.test.js:521`, `"real-agent smoke capture removes its first stdout file when stderr capture setup fails"` | PASS |
| SC4 only current-run-owned paths are removed | `lib/commands/integrate.ts:72`, `"prepareNoisePatchForSquash cleans only its owned patch directory when reset fails"`, `"real-agent smoke capture retention is opt-in and never deletes operator or concurrent paths"` | PASS |
| SC5 repeated-run residue assertion | `test/task-2241-tmp-cleanup-repro.test.js` | PENDING CP-3 |
| SC6 capacity preflight emits environment/resource result | `test/e2e-real-agent-smoke.test.js:240` | PENDING CP-3 |
| SC7 Git storage detail is preserved and classified | `lib/commands/handoff.ts:676` | PENDING CP-3 |
| SC8 final required gate passes | `./scripts/verify-local.sh all` | PENDING CP-3 |

Next action: add and verify the smoke capacity/resource branch and Git index/lock diagnostic preservation, then run the required repository gate.
