# CP-2 (Root Cause)

## Decision point

The write happens at `lib/agents/agents.ts:909-916`, inside `startAgent`'s
non-limit launch-failure branch:

```ts
// lib/agents/agents.ts:909
if (shouldPersistLaunchFailureBlock(chosen || '', result)) {
  const blockUntil = formatBlockUntil(new Date(Date.now() + DEFAULT_FALLBACK_HOURS * 60 * 60 * 1000));
  const blockResult = updateAgentBlockFn(chosen || '', blockUntil);
  ...
}
```

`shouldPersistLaunchFailureBlock` (`lib/agents/agents.ts:171-181`) is the actual
branch condition:

```ts
function shouldPersistLaunchFailureBlock(agent: string, result: LaunchResultLike | null | undefined) {
  if (!result || agent === 'custom') {return false;}
  const combined = [result.stderr || '', result.stdout || '', result.error?.message || '', result.error?.code || ''].join('\n');
  if (!combined.trim()) {return true;}
  return !NON_BLOCKING_LAUNCH_ERROR_PATTERNS.some(pattern => pattern.test(combined));
}
```

For `mistral`, this defaults to `true` (persist a block) unless the failure text
happens to match one of the eight generic patterns in
`NON_BLOCKING_LAUNCH_ERROR_PATTERNS` (`agents.ts:113-123`, e.g. "invalid model",
"unauthorized", "api key"). A tool-approval-required message is none of those,
so every non-interactive `vibe` launch that needs a tool call is unconditionally
persisted to `agents.local.json` for `DEFAULT_FALLBACK_HOURS` (1h). Once that
block expires, the exact same condition recurs on the next `mistral` launch —
this is the "unblocked, but ends up in blocklist all the time" loop.

## Upstream cause: mistral.ts is the only launcher without a non-interactive bypass

The reason `vibe` produces this failure at all (rather than succeeding, like
`claude`/`custom`/`codex` do under the same non-interactive conditions) is that
`buildMistralInvocation` (`lib/agents/mistral.ts:41-65`) never passes the
CLI's documented non-interactive tool-approval bypass:

- `lib/agents/claude.ts:74` — `--dangerously-skip-permissions`
- `lib/agents/opencode.ts:142` — `--dangerously-skip-permissions`
- `lib/agents/codex.ts:188,192` — `trust_level = "trusted"` in generated config
- `lib/agents/mistral.ts:44` — only `['--prompt', prompt, '--trust', '--output', 'text']`

`vibe --help` documents `--trust` as scoped to the working-directory trust
prompt only ("Trust the working directory for this invocation only ...").
Tool-call approval is a *separate* mechanism gated by `--auto-approve`/`--yolo`
("Approves all tool calls without prompting"), which `mistral.ts` never sets.
This is the actual root cause: `mistral` is missing the equivalent of the
bypass flag every other family already has, so any real (non-trivial) prompt
that needs a tool call fails outside a TTY, and `shouldPersistLaunchFailureBlock`
faithfully (if overly conservatively) persists that as a block.

## Prior theory: ruled out

The mission's original draft (`missions/task-1398/MISSION.md` git history,
commit `fcda2a87`) proposed importing `isHardOpencodeFailure` from
`lib/agents/opencode.ts` into `agents.ts` and expanding
`NON_BLOCKING_LAUNCH_ERROR_PATTERNS` with `resource_exhausted` /
auth-credential-token / model-endpoint patterns, on the theory that task-1392's
fix was dropped.

This is **ruled out** as the cause of the reproduced symptom:

- `isHardOpencodeFailure`'s pattern set (`lib/agents/opencode.ts:193-200`:
  "model not found", "no such model", "invalid api key", "401 unauthorized",
  "authentication failed/error") does not match the actual failure text
  (`"Tool call requires approval but no interactive terminal is available."`).
  Wiring it in would not have prevented the reproduced block write.
- The `resource_exhausted` pattern the draft wanted to add to
  `NON_BLOCKING_LAUNCH_ERROR_PATTERNS` is already handled correctly — but on
  the *limit-hit* path, not the launch-failure path: `PATTERN_SETS.mistral`
  (`lib/agents/limit-hit.ts:37-38`) already contains
  `/\bresource[_ ]has[_ ]been[_ ]exhausted\b/i` and `/\bresource_exhausted\b/i`,
  so a genuine resource-exhausted error is classified as a real limit hit by
  `detectLimitHit` before `shouldPersistLaunchFailureBlock` is ever reached.
  Adding it again in the launch-failure patterns would have been redundant,
  not corrective.
- The draft's own "Risk" section already flagged this: *"Some opencode-specific
  patterns ... may not appear in mistral ... output, making the guard
  effectively a no-op for those families."* That risk materializes here — for
  this reproduction, the guard is a no-op.

## Goal Check

| Criterion | Evidence |
|---|---|
| Responsible file/branch condition documented | `lib/agents/agents.ts:909` (write site) + `lib/agents/agents.ts:171-181` (`shouldPersistLaunchFailureBlock`) |
| Prior theory explicitly confirmed or ruled out | Ruled out — see "Prior theory: ruled out" above, with pattern-by-pattern comparison against the reproduced failure text |
| Actual root cause tied to reproduced path | `lib/agents/mistral.ts:44` missing `--yolo`/`--auto-approve`, contrasted with `lib/agents/claude.ts:74`, `lib/agents/opencode.ts:142`, `lib/agents/codex.ts:188` |

Next action: CP-3 — add `--yolo` to `buildMistralInvocation`'s args in `lib/agents/mistral.ts`, then re-run `test/agents.test.js:1939` to confirm it goes green, plus the full agent/limit-hit/mistral suites to confirm real limit-hit blocking is untouched.
