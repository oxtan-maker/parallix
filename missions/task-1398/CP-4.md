# CP-4 (Verification)

## Summary

Ran the mission-declared gates on the final tree (post-CP-3 fix). Both pass
cleanly.

### `./scripts/verify-local.sh all`

```
$ ./scripts/verify-local.sh all
...
ℹ tests 1779
ℹ pass 1757
ℹ fail 0
ℹ cancelled 0
ℹ skipped 22
ℹ todo 0
ℹ duration_ms 18488.930435
```

Exit code `0`. The 22 skipped tests are pre-existing (unrelated to this
mission — no `.skip`/`.only` added by this branch's changes, confirmed by
`git diff` on `test/agents.test.ts` and `test/mistral.test.ts`).

### `./scripts/verify-local.sh static-analysis` (required — `lib/agents/mistral.ts` changed)

```
$ ./scripts/verify-local.sh static-analysis
[1/3] Running ESLint...
✖ 244 problems (0 errors, 244 warnings)
PASS: ESLint clean
[2/3] Running npm run typecheck...
PASS: tsc typecheck clean
[3/3] Running test-hygiene check...
PASS: no test-hygiene violations
PASS: test-hygiene clean
=== Static Analysis Gate: ALL STAGES PASSED ===
```

Exit code `0`. The 244 warnings are pre-existing `no-unused-vars` warnings in
unrelated files (`lib/review/review-loop.ts`, `lib/review/review-polling.ts`,
`lib/review/review-state.ts`, `px.ts`, etc.) — 0 errors, and none touch
`lib/agents/mistral.ts` or `lib/agents/agents.ts`.

## Goal Check

| Success criterion (from MISSION.md) | Evidence | Status |
|---|---|---|
| Focused reproduction fails pre-fix, demonstrates the symptom | `test/agents.test.ts:2103` `mistral without a non-interactive tool-approval bypass gets re-blocklisted on every launch` — failed pre-fix with `All eligible agents exhausted ... mistral: exit 1 (Tool call requires approval but no interactive terminal is available.)` (CP-1) | PASS |
| Fix tied to reproduced path with concrete file references | `lib/agents/mistral.ts:51` (`--yolo` added to `buildMistralInvocation`'s `args`); write site traced to `lib/agents/agents.ts:909` via `shouldPersistLaunchFailureBlock` at `lib/agents/agents.ts:171-181` (CP-2) | PASS |
| Reproduced case passes after fix, no incorrect persistent write | `test/agents.test.ts:2103` green post-fix; `blockCalls` asserted empty (CP-3) | PASS |
| Genuine usage-limit handling for mistral still works | `test/agents-limit-hit.test.ts` and `test/limit-hit.test.ts` (all `PATTERN_SETS.mistral` cases) plus `test/agents.test.ts` `startAgent launch failure does not retry when limit-hit is detected` — all pass unchanged | PASS |
| No `.only`/bare `.skip` introduced | Verified via `git diff -- test/agents.test.ts test/mistral.test.ts`; test-hygiene stage of `static-analysis` gate passes | PASS |
| `./scripts/verify-local.sh all` passes | Exit 0, `tests 1779 / pass 1757 / fail 0` (this checkpoint, above) | PASS |
| `./scripts/verify-local.sh static-analysis` passes (lib/ changed) | Exit 0, ESLint 0 errors / tsc clean / test-hygiene clean (this checkpoint, above) | PASS |
| Final checkpoint evidence cites real file:line + test names | This table and CP-1/CP-2/CP-3 cite `lib/agents/mistral.ts:44` (pre-fix) / `:51` (post-fix), `lib/agents/agents.ts:171-181,909`, `lib/agents/claude.ts:74`, `lib/agents/opencode.ts:142`, `lib/agents/codex.ts:188`, and test names `test/agents.test.ts:2103`, `test/mistral.test.ts:73` | PASS |

Next action: none — mission complete. Ready for handoff/review; no further checkpoints required by MISSION.md.

## Round-3 addendum: branch synced with main

Review rounds 1-3 repeatedly surfaced "regressions" (px.ts ESM guard,
`mistral-telemetry.ts` CJS, `package.json`/`package-lock.json` version,
`test/px-runner.test.ts`/`test/px-shell-init.test.ts` reverts) that were not
introduced by this mission's changes — `mission/task-1398` forked from `main`
before task-1395/task-1400/task-1402 merged, and the review tooling diffs
directly against `main`'s continuously-advancing tip. Resolved by merging
`main` (commit `992690b5`), which brings the branch current and eliminates
this entire class of findings at once — confirmed via
`git diff main...HEAD --stat` showing only task-1398-scoped files plus the
justified `lib/commands/active.ts` fix (13 files, 510 insertions, 12
deletions). Re-verified both gates pass post-merge: `verify-local.sh all`
(1758/1780 pass, 0 fail) and `verify-local.sh static-analysis` (0 errors, tsc
clean, test-hygiene clean).

Added a regression test pinning the `lib/commands/active.ts:433`
`repairHandoff.default` accessor: `test/active.test.ts` `repair-handoff
module exposes its default export as callable under CJS
require+importStar interop` — proves empirically that `.default` is the only
accessor that resolves to a callable function under the compiled CJS runtime
`bin.px` ships (bare namespace object is non-callable; `.repairHandoff` is
`undefined`).
