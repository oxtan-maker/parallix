# CP-1: Publish surface mapped

## Summary

Mapped the repo-owned paths on this branch that can move standalone parallix state toward
published `main`, and tied each path to the new exact-tree verification hook points.

### In-scope publish/update paths

1. **`px integrate` Variant B squash path**: the ordinary mission integration flow creates the
   landed squash commit in the base worktree, then syncs that merged state outward.
   Evidence: `lib/commands/integrate.js:685-699`, `:701-725`.
2. **`finalizeVariantACloseout()` fast path**: the direct closeout path stages, commits, and
   pushes the primary branch to `review <baseBranch|main>`.
   Evidence: `lib/commands/integrate.js:1231-1307`.
3. **Forgejo baseline mirror sync inside `createPr()`**: before PR creation, the review remote's
   primary branch is force-pushed from the local primary checkout via `syncPrimaryBaseline()`.
   Evidence: `lib/tools/forgejo.js:429-441`, `:727-763`.

### Out-of-scope / not evidenced by this branch

- No additional repo-owned standalone publish/import/extract/sync entrypoint was changed in the
  `main...HEAD` diff beyond the three paths above.
- The branch does **not** introduce an external CI or deployment publisher; the guarded paths are
  local repo commands only.

## Goal Check

| Mission item | Status | Evidence |
|---|---|---|
| Enumerate ordinary integration publish path | Done | `lib/commands/integrate.js:685-699`, `:701-725` |
| Enumerate non-standard closeout path that still pushes primary state | Done | `lib/commands/integrate.js:1231-1307` |
| Enumerate review-remote baseline sync that can rewrite mirrored primary history | Done | `lib/tools/forgejo.js:429-441`, `:727-763` |
| Distinguish code paths updated by this mission branch from untouched surfaces | Done | `git diff --name-only main...HEAD` shows the publish-path code in `lib/commands/integrate.js`, `lib/tools/forgejo.js`, `lib/core/verification.js`, plus the baseline-fix surfaces `lib/review/review-loop.js` and `lib/review/review-commands.js`, along with tests, mission docs, and task artifacts |

## Next action

Record the exact-tree proof mechanism shared by these paths and show where they fail closed when
verification fails or goes stale.
