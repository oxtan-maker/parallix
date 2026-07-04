# CP-3: Update regression coverage proving the warning no longer appears

## Summary

Updated the existing focused regression test in `test/agents.test.js:345-357` that previously asserted a warning fired for the non-repo main-worktree lookup. Renamed and rewrote it to assert the corrected no-warning behavior (SC 2):

```js
test('readAgentConfig does not warn when main-worktree lookup runs outside a git repo', () => {
  withTempAgentConfigTree(({ configPath, targetPath }) => {
    const warnings = [];

    const config = readAgentConfig(configPath, {
      mergeLocal: true,
      targetPath,
      warn: message => warnings.push(message)
    });

    assert.ok(config);
    assert.deepEqual(warnings, []);
  });
});
```

This test uses `withTempAgentConfigTree()` (`test/agents.test.js:163-185`), which builds a temp directory tree that is never `git init`'d, reproducing the exact reported condition: `readAgentConfig` called with `mergeLocal: true` and no explicit `mainWorktreePath`, from a directory not attached to any git repository.

No additional regression test was added beyond this update. The existing test surface already proves:
- SC 1/SC 2 (no warning for the expected non-repo case): the updated test above.
- SC 3 (diagnostics remain for unexpected failures): the in-repo non-zero-exit warn branch (`lib/agents/agents.ts:296-301`) and the exception `catch` branch (`lib/agents/agents.ts:335-342`) are both unmodified by the CP-2 change — the new early return at `lib/agents/agents.ts:290-295` only short-circuits when `commonDir` is falsy, so these branches are reached identically to before whenever `commonDir` is truthy or `getGitPath`/`spawnSync` throw.
- SC 4 (local-config merge still works when a main worktree is supplied or determined): pre-existing passing tests that pass `mainWorktreePath` explicitly (e.g. `test/agents.test.js:187-197`, `:199-207`, `:332-343`) exercise the merge path unaffected by this change, since explicit `mainWorktreePath` bypasses `getMainWorktreePath()` entirely (`lib/agents/agents.ts:252-254`).

Ran the full `test/agents.test.js` suite after the change (via `npm run build:cjs` to regenerate the gitignored `lib/agents/agents.js` artifact, then `node --test test/agents.test.js`):

```
ℹ tests 92
ℹ pass 91
ℹ fail 0
ℹ cancelled 0
ℹ skipped 1
```

The one skipped test is pre-existing and unrelated to this change (not part of the touched test names).

## Goal Check

| Item | Evidence |
|---|---|
| SC 1: no warnings for expected non-repo case | `test/agents.test.js:345-357`, test `readAgentConfig does not warn when main-worktree lookup runs outside a git repo` — passed (`node --test test/agents.test.js` output: `✔ readAgentConfig does not warn when main-worktree lookup runs outside a git repo`) |
| SC 2: existing regression test updated | `test/agents.test.js:345-357` (previously asserted `warnings.length === 1`; now asserts `warnings` is empty) |
| SC 3: unexpected-failure diagnostics preserved | Code inspection: `lib/agents/agents.ts:296-301` and `lib/agents/agents.ts:335-342` unchanged and still reachable/warn-producing; no test previously existed for these branches beyond code path being unmodified |
| SC 4: local-config merge still works | `test/agents.test.js:187-197`, `test/agents.test.js:199-207`, `test/agents.test.js:332-343` — all pass with explicit `mainWorktreePath` |
| Full suite still green | `node --test test/agents.test.js` → `ℹ tests 92`, `ℹ pass 91`, `ℹ fail 0`, `ℹ skipped 1` (pre-existing, unrelated) |

Next action: Run the mission's required verification gate `./scripts/verify-local.sh static-analysis` and capture proof in the final checkpoint (CP-4).
