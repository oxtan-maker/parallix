# CP-3 (Green): Fix

## Summary

Applied the smallest fix identified in CP-2: `buildMistralInvocation`
(`lib/agents/mistral.ts:41-72`) now passes `--yolo` alongside the existing
`--prompt`/`--trust`/`--output text` flags, so `vibe` approves its own tool
calls non-interactively — matching the equivalent bypass every other launcher
family already passes (`--dangerously-skip-permissions` for claude/opencode,
`trust_level = "trusted"` for codex).

```
lib/agents/mistral.ts (pre-fix line 44, post-fix line 51 — a comment block
explaining the flag was inserted above the `const args` line)
- const args = ['--prompt', prompt, '--trust', '--output', 'text'];
+ const args = ['--prompt', prompt, '--trust', '--yolo', '--output', 'text'];
```

No changes were made to `lib/agents/limit-hit.ts` pattern sets,
`shouldPersistLaunchFailureBlock`, block duration, or the blocklist file
schema — the fix is scoped to the actual root cause (missing bypass flag on
the mistral invocation), per the mission's restricted areas.

## Reproduction: red → green

`test/agents.test.js:1939` (`mistral without a non-interactive tool-approval
bypass gets re-blocklisted on every launch`):

- **Before fix (CP-1):** failed with `All eligible agents exhausted for step
  "active". Tried: mistral. Errors: mistral: exit 1 (Tool call requires
  approval but no interactive terminal is available.)` — persistent blocklist
  entry written for `mistral`.
- **After fix:** passes — `result.agent === 'mistral'`, `blockCalls` is empty
  (no blocklist write).

Added unit coverage tying the fix to the exact flag:
`test/mistral.test.js:58` (`buildMistralInvocation includes --yolo flag for
non-interactive tool-call approval`) asserts `inv.args.includes('--yolo')`.

## Genuine limit-hit blocking still works

Unchanged, still passing: `test/agents-limit-hit.test.js` and
`test/limit-hit.test.js` (all `PATTERN_SETS.mistral` cases, e.g. `findLimitHitMatch
finds mistral quota exceeded`, `findLimitHitMatch finds mistral rate limit`),
plus `test/agents.test.js` end-to-end cases exercising real limit-hit blocking
through `startAgent` (e.g. `startAgent launch failure does not retry when
limit-hit is detected`). None of these depend on the invocation args changed
here — `detectLimitHit` only inspects `stdout`/`stderr`/`status`/`signal`, not
the launcher's argv.

## Test run

```
$ npm run build:cjs && FORCE_COLOR=0 node --test test/agents.test.js test/agents-limit-hit.test.js test/mistral.test.js test/limit-hit.test.js
...
ℹ tests 151
ℹ pass 150
ℹ fail 0
ℹ cancelled 0
ℹ skipped 1
ℹ todo 0
```

(The 1 `skipped` is pre-existing and unrelated to this change — not introduced
here; confirmed no `.only`/bare `.skip` added by this mission via `git diff`.)

## Goal Check

| Criterion | Evidence |
|---|---|
| Reproduced case passes after fix | `test/agents.test.js:1939` green post-fix (see run above) |
| No incorrect persistent blocklist entry for mistral | Same test: `assert.deepEqual(blockCalls, [])` passes |
| Real limit-hit handling still works | `test/agents-limit-hit.test.js`, `test/limit-hit.test.js`, and `startAgent launch failure does not retry when limit-hit is detected` (`test/agents.test.js`) all pass unchanged |
| Fix tied to root cause, not the ruled-out theory | `lib/agents/mistral.ts:51` (flag added), no changes to `lib/agents/opencode.ts` or `NON_BLOCKING_LAUNCH_ERROR_PATTERNS` |
| No `.only`/bare `.skip` introduced | `git diff` on `test/agents.test.js`, `test/mistral.test.js` — no `.only`/`.skip` added |

Next action: CP-4 — run `./scripts/verify-local.sh all` (and `static-analysis` since `lib/agents/mistral.ts` changed) and record the results.
