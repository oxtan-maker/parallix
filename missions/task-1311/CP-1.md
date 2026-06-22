# CP-1: Code location confirmed, existing behavior documented, test strategy defined

## Summary

Investigated the static-review findings branch in the `review()` dispatcher and confirmed every
dependency the implementer re-launch needs is already imported and injectable. Documented the
current behavior and defined the mock-injection test strategy. Surfaced one existing test that
encodes the *old* behavior and will require updating (intended behavior change, not collateral
breakage).

### Code location (confirmed)

- Target branch: `lib/review/review-commands.js:1215-1227` — the `staticResult.findings.length > 0`
  block inside the final `else` (no flags, no open PR). It currently calls `submitForReviewFn`,
  `postStaticReviewCommentFn`, then `startReviewLoopFn` — exactly the path to replace.
- The `ok: true` branch at `lib/review/review-commands.js:1228-1240` is out of scope (unchanged).

### Dependencies available (all confirmed)

- `startAgent` imported at `lib/review/review-commands.js:21`. Signature
  `async function startAgent(step, opts)` (`lib/agents/agents.js:568`) destructures
  `prompt`, `worktree`, `agent`, `slug` — matches the mission-declared call shape. **Stop-rule on
  signature mismatch cleared.**
- `getTaskImplementer` imported at `lib/review/review-commands.js:12`; returns a lowercased agent
  family string or `null` when the task file is missing/has no supported assignee
  (`lib/tools/backlog.js:454-462`) — gives the WARN+no-op fallback its trigger.
- `resolveTaskFile` imported at `lib/review/review-commands.js:12`; returns
  `{ ok, taskFile, matches }` (`lib/tools/backlog.js`), so `taskResolution.taskFile` feeds
  `getTaskImplementer`.
- `worktreeForStatic` already computed at `lib/review/review-commands.js:1213`.
- `startAgentFn` is **not yet** injectable in `review()` (DI block at lines 1087-1105); I will add
  `const startAgentFn = options.startAgentFn || startAgent;` plus injectable
  `resolveTaskFileFn`/`getTaskImplementerFn` for the new branch.

### Current behavior (documented)

On `px review <slug>` with no flags and no open PR, `performStaticReviewFn` runs. If it returns
findings: a log line "Auto-triggering review loop...", then `submitForReviewFn(slug, true, options)`
(when no open PR), then `postStaticReviewCommentFn(...)`, then
`await startReviewLoopFn(slug, { ...options, missionPath })`.

### Test strategy (defined)

- New test in `test/review-commands.test.js`: invoke `review([slug], opts)` with
  `getPrStatusFn: () => ({ exists: false })`,
  `performStaticReviewFn: () => ({ ok: false, findings: ['F1', 'F2'] })`, and mocked
  `startReviewLoopFn` + `startAgentFn`. Inject `resolveTaskFileFn`/`getTaskImplementerFn` so the
  implementer resolves to a known string. Assert: `startReviewLoopFn` call count `=== 0`;
  `startAgentFn` called once with `step === 'active'`; `opts.agent === implementer`;
  `opts.prompt` contains each finding as its own line; `opts.worktree` / `opts.slug` set.
- Second test: `getTaskImplementerFn: () => null` ⇒ `startAgentFn` NOT called, a WARN log emitted,
  `startReviewLoopFn` NOT called.
- Regression coverage: `ok: true` branch unchanged (already covered by the line-147 test).

### Existing test that must be updated (intended, not collateral)

`test/review-commands.test.js:194` — `no-PR + static review findings DOES trigger review loop`
asserts `startReviewLoopCalled === true`. This encodes the exact old contract the mission
replaces, so it will be rewritten to assert the new behavior (implementer re-launch, no review
loop). The Stop Rule about existing-test failure targets *collateral* breakage; this is the one
test that directly mirrors the changed branch, so updating it is the intended path rather than a
stop condition. Will document the before/after in CP-3.

## Goal Check

| Item | Status | Evidence |
| --- | --- | --- |
| Target branch identified | ✅ | `lib/review/review-commands.js:1215-1227` |
| `ok: true` branch out of scope identified | ✅ | `lib/review/review-commands.js:1228-1240` |
| `startAgent` signature accepts prompt/worktree/agent/slug | ✅ | `lib/agents/agents.js:568-587` |
| `getTaskImplementer` returns string or null | ✅ | `lib/tools/backlog.js:454-462` |
| `resolveTaskFile` returns `{taskFile}` | ✅ | `lib/tools/backlog.js:35`, returns shape grep |
| Existing behavior documented | ✅ | `lib/review/review-commands.js:1216-1227` |
| Test strategy + conflicting test identified | ✅ | `test/review-commands.test.js:194-225` |

Next action: implement CP-2 — add `startAgentFn`/`resolveTaskFileFn`/`getTaskImplementerFn` to the `review()` DI block and replace the `lib/review/review-commands.js:1215-1227` findings branch with the implementer re-launch + WARN-fallback logic.
