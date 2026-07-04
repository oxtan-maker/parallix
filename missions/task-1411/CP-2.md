# CP-2: Implement the warning-suppression change

## Summary

Modified `getMainWorktreePath()` in `lib/agents/agents.ts` to return `null` immediately, without calling `warn`, when `commonDir` is falsy (i.e. `git rev-parse --path-format=absolute --git-common-dir` already indicated `cwd` isn't attached to a git repository). This is checked right after the existing cache lookup and before the `git worktree list --porcelain` spawnSync call that previously always ran and warned on any non-zero exit, including the redundant "not a repo" case.

Change (`lib/agents/agents.ts:283-302`):

```ts
const commonDir = getGitPath(cwd, ['rev-parse', '--path-format=absolute', '--git-common-dir']);
if (commonDir && MainWorktreeDetector.byCommonDir.has(commonDir)) {
  return MainWorktreeDetector.byCommonDir.get(commonDir);
}

if (!commonDir) {
  // cwd isn't attached to a git repo at all (rev-parse already failed
  // silently above), so `git worktree list` would fail for the same
  // expected reason. Skip it quietly instead of warning.
  return null;
}

const result = spawnSync('git', ['-C', cwd, 'worktree', 'list', '--porcelain'], { ... });
if (result.status !== 0) {
  warn(...);   // unchanged: still fires when commonDir is truthy (real repo) but worktree list fails
  return null;
}
```

Behavior preserved:
- `readAgentConfig()` (`lib/agents/agents.ts:238-281`) is otherwise untouched: it still returns usable config and still skips the main-worktree merge when `getMainWorktreePath()` returns `null`.
- The `catch` block (`lib/agents/agents.ts:335-342`) for spawn-level exceptions is untouched and still warns for genuinely unexpected failures (e.g. git binary missing).
- The in-repo, non-zero-exit branch (`lib/agents/agents.ts:296-301`, now only reached when `commonDir` is truthy) still warns — this preserves diagnostics for unexpected failures while actually inside a git repository (SC 3).
- Detection logic for a real main worktree (fallback searches, `MainWorktreeDetector` caching) is unchanged.

`lib/agents/agents.js` is a gitignored build artifact (`.gitignore:17`), not tracked in git (`git ls-files lib/agents/` shows only `.ts` sources). It is regenerated from `agents.ts` by `npm run build:cjs`, which also runs automatically via the `pretest` script. Ran `npm run build:cjs` to keep the local artifact in sync for testing; no `.js` changes need to be committed.

## Goal Check

| Item | Evidence |
|---|---|
| Warning suppressed for expected non-repo case | `lib/agents/agents.ts:290-295` (`if (!commonDir) return null;`, added before the `spawnSync('git', [...'worktree','list'...])` call) |
| `readAgentConfig` still returns usable config, still skips merge when no main worktree found | `lib/agents/agents.ts:238-281` unchanged |
| Unexpected in-repo `worktree list` failure still warns | `lib/agents/agents.ts:296-301` (unchanged code, now gated behind `commonDir` truthy) |
| Unexpected thrown exceptions still warn | `lib/agents/agents.ts:335-342` (`catch` block, unchanged) |
| Build artifact regenerated, not committed | `npm run build:cjs` ran cleanly; `git status --porcelain lib/agents/agents.js` empty (gitignored, confirmed via `git check-ignore -v lib/agents/agents.js` → `.gitignore:17`) |

Next action: Update/confirm the focused regression test in `test/agents.test.js` proving no warning fires for the non-repo case, and verify unrelated tests still pass (CP-3).
