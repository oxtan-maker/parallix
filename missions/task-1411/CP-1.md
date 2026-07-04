# CP-1: Confirm reported warning path and identify expected-vs-unexpected condition

## Summary

Traced the reported warning `Could not inspect git worktrees while looking for main-worktree agents.local.json; skipping that lookup (git exited with status 128).` to `getMainWorktreePath()` in `lib/agents/agents.ts:283-350`, called from `readAgentConfig()` at `lib/agents/agents.ts:249-254` whenever `mergeLocal` is true and no explicit `mainWorktreePath` is supplied.

`getMainWorktreePath()` first calls `getGitPath(cwd, ['rev-parse', '--path-format=absolute', '--git-common-dir'])` (`lib/agents/agents.ts:286`). `getGitPath` (`lib/agents/agents.ts:360-370`) silently returns `null` on any non-zero git exit — this is the existing, already-quiet path for "not in a git repo". If that call fails (`commonDir === null`), the code previously fell through unconditionally into a second `git worktree list --porcelain` spawnSync call (`lib/agents/agents.ts:291-302`), which fails for the identical reason (cwd not attached to a git repo, exit 128) and *does* warn.

So the "expected, not warn-worthy" condition is: `commonDir` is `null`, meaning the initial `rev-parse --git-common-dir` already determined cwd isn't part of a git repository. In that case, running `git worktree list --porcelain` is redundant and its failure is not new information — it should be skipped quietly, returning `null` (main-worktree merge is skipped, matching existing tolerant behavior).

Genuinely unexpected failures remain covered:
- `git worktree list --porcelain` failing with non-zero status *while inside a real repo* (`commonDir` truthy) still warns at `lib/agents/agents.ts:296-301` (now reached only when `commonDir` is truthy).
- The `catch` block (`lib/agents/agents.ts:335-342`) covering spawn-level exceptions (e.g., git binary missing, ENOENT) is untouched and still warns.

Existing test reproducing this exact scenario: `test('readAgentConfig warns when main-worktree lookup cannot inspect git worktrees', ...)` at `test/agents.test.js:345-359`, using `withTempAgentConfigTree()` (`test/agents.test.js:163-185`), which creates a temp directory tree that is never `git init`'d — i.e., not a git worktree at all. This is exactly the case the mission describes and confirms the assumption in the mission's Risks section.

## Goal Check

| Item | Evidence |
|---|---|
| Warning call site located | `lib/agents/agents.ts:296-301` (non-repo path) and `lib/agents/agents.ts:335-342` (catch path) |
| Caller path confirmed | `readAgentConfig()` → `getMainWorktreePath()`, `lib/agents/agents.ts:249-254` |
| Expected-vs-unexpected condition identified | `commonDir === null` after `getGitPath(cwd, ['rev-parse', ..., '--git-common-dir'])` at `lib/agents/agents.ts:286` signals "not a git repo at all" (expected); non-zero exit from `worktree list` while `commonDir` is truthy, or a thrown exception, remain unexpected |
| Existing regression test located | `test/agents.test.js:345-359` (`readAgentConfig warns when main-worktree lookup cannot inspect git worktrees`), fixture `withTempAgentConfigTree` at `test/agents.test.js:163-185` (non-git temp dir) |

Next action: Implement the warning-suppression change in `getMainWorktreePath()` (CP-2) so the `commonDir === null` branch returns `null` without calling `warn`, then update the CP-1-identified test in `test/agents.test.js:345-359` to assert no warnings (CP-3).
