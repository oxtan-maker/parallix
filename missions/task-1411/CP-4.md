# CP-4: Verification gate and final proof

## Summary

Ran the mission's required integration gate and confirmed all stages pass on the final tree:

```
$ ./scripts/verify-local.sh static-analysis
=== Static Analysis Gate ===
[1/3] Running ESLint...
PASS: ESLint clean
[2/3] Running npm run typecheck...
PASS: tsc typecheck clean
[3/3] Running test-hygiene check...
PASS: no test-hygiene violations
PASS: test-hygiene clean
=== Static Analysis Gate: ALL STAGES PASSED ===
```

Also re-ran the full unit-test file covering this change directly:

```
$ npm run build:cjs && node --test test/agents.test.js
ℹ tests 92
ℹ pass 91
ℹ fail 0
ℹ cancelled 0
ℹ skipped 1
ℹ todo 0
```

(The single skipped test is pre-existing and unrelated to this mission; no `.only` or bare `.skip` was introduced — the only test file edit was rewriting the assertions inside an existing `test(...)` block at `test/agents.test.js:345`.)

## Change summary

- `lib/agents/agents.ts:290-296` — `getMainWorktreePath()` now returns `null` immediately, without calling `warn`, when `commonDir` (from `git rev-parse --git-common-dir`) is falsy, i.e. `cwd` isn't attached to a git repository at all. This is the exact condition that produced the reported noisy warning `Could not inspect git worktrees while looking for main-worktree agents.local.json; skipping that lookup (git exited with status 128).` for callers running outside a git worktree.
- `test/agents.test.js:345-357` — the pre-existing regression test for this path was renamed from "warns when main-worktree lookup cannot inspect git worktrees" to "does not warn when main-worktree lookup runs outside a git repo" and its assertion changed from expecting one warning matching `/main-worktree agents\.local\.json/` to expecting zero warnings.
- `lib/agents/agents.js` is a gitignored build artifact (confirmed via `git check-ignore -v lib/agents/agents.js` → `.gitignore:17`), not tracked in git, regenerated from `agents.ts` by `npm run build:cjs` (also runs via the `pretest` npm script). No manual edit or commit of this file was needed or made.
- `missions/task-1411/MISSION.md` was updated by the workflow harness during checkpointing (transition metadata); no scope content was altered by this work beyond what the harness manages.
- Backlog task file `backlog/tasks/task-1411 - I-get-these-errors-a-lot.md` was left untouched — not renamed, moved, or deleted, and its `assignee` field was not edited.

## Goal Check

| Goal Check | Evidence | Status |
|---|---|---|
| SC 1: no warnings for the expected non-repo `getMainWorktreePath` path | `lib/agents/agents.ts:290-296` (early `return null` guard added before the warn-producing `spawnSync` call) | PASS |
| SC 1 (test proof): `readAgentConfig` from a non-repo temp dir records zero warnings | `test/agents.test.js:345-357` — test `readAgentConfig does not warn when main-worktree lookup runs outside a git repo`, asserts `assert.deepEqual(warnings, [])` | PASS |
| SC 2: existing regression test updated to assert corrected no-warning behavior | `test/agents.test.js:345-357` — previously asserted `warnings.length === 1` and a message match; now asserts `warnings` is empty | PASS |
| SC 3: diagnostics remain for unexpected lookup failures | `lib/agents/agents.ts:296-301` (in-repo `worktree list` non-zero exit still warns) and `lib/agents/agents.ts:335-342` (`catch` block for thrown exceptions still warns) — both unmodified by this change | PASS |
| SC 4: local-config merge still works with a supplied/determined main worktree path | `test/agents.test.js:187-197` (`readAgentConfig migrates blocklist from workflow/config/agents.local.json`), `test/agents.test.js:199-207` (project-root variant), `test/agents.test.js:332-343` (main-worktree variant) — all passing | PASS |
| SC 5: required gate `./scripts/verify-local.sh static-analysis` passes | Command output above: `=== Static Analysis Gate: ALL STAGES PASSED ===` (ESLint clean, tsc typecheck clean, test-hygiene clean) | PASS |
| Full regression suite green after change | `node --test test/agents.test.js` → `ℹ tests 92`, `ℹ pass 91`, `ℹ fail 0`, `ℹ skipped 1` (pre-existing, unrelated skip) | PASS |

## Round 1 follow-up: "e2e tests fail" (PR #95 review 1361)

The reviewer's terse follow-up comment `e2e tests fail` refers to the `workflow` integration gate (`config/integration-pipelines.json`: `node test/e2e-mission-lifecycle.test.js`), which applies here because `gateMatchesChangedAreas('workflow', changedAreas)` (`lib/commands/integrate.ts:335-337`) treats a `lib` change as also triggering the `workflow` gate. This gate was not covered in the original CP-4 evidence above (only `static-analysis` was), which was the actual gap — not a defect in the mission's diff.

Root cause of the failure: `test/e2e-mission-lifecycle.test.js` shells out directly to the compiled `px.js` CLI. Since the `workflow` gate command is a bare `node test/e2e-mission-lifecycle.test.js` (no `npm test`), the `pretest` script (`npm run build:cjs`) never runs, so the gate can execute against a stale compiled `lib/agents/agents.js`/`px.js` that predates this mission's `agents.ts` change. Reproduced directly: running the gate against the stale build failed the `configured post-integrate hook runs exactly once ... (SC2/SC3)` case; rebuilding first (`npm run build:cjs`) and re-running made all 6 cases pass. This is a pre-existing self-hosting gap in the integration pipeline (nothing rebuilds JS before the `workflow` gate runs), not something introduced by this mission — filed as `task-1413` to fix generally (add a post-execute/act-on-review rebuild hook).

For this mission, the fix is to make sure the gate is proven on a freshly built tree before integrating:

```
$ npm run build:cjs && node test/e2e-mission-lifecycle.test.js
✔ feature-branch lifecycle drafts from the recorded base and integrates back into that feature branch
✔ primary-branch lifecycle integrates cleanly to main and marks the task done
✔ configured post-integrate hook runs exactly once with slug/base-worktree/base-branch/variant env vars (SC2/SC3)
✔ a failed integration gate aborts before the post-integrate hook can run (SC4)
✔ a repo with no post-integrate hook configured runs px integrate with unchanged behavior (SC1)
✔ artifact-focused run produces mission, checkpoint, milestone, and review artifacts with the expected structure
ℹ tests 6
ℹ pass 6
ℹ fail 0
```

| Goal Check | Evidence | Status |
|---|---|---|
| `workflow` integration gate passes on a freshly built tree | `node test/e2e-mission-lifecycle.test.js` output above: `tests 6`, `pass 6`, `fail 0` | PASS |
| Root cause of the reported e2e failure identified as stale build artifacts, not a code defect in `lib/agents/agents.ts:290-296` | Reproduced failure against stale build, reproduced pass after `npm run build:cjs`; systemic gap tracked separately in `task-1413` | PASS |

Next action: Commit `lib/agents/agents.ts`, `test/agents.test.js`, and the mission checkpoint documents under `missions/task-1411/`, then hand off to review.
