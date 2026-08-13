# CP-2: Bubblewrap invocation builder

## Summary

Added a shared argument-array builder for Bubblewrap. It resolves and validates
the worktree and permitted writable paths, makes the host root read-only, and
re-binds only workflow-authorized writable locations. Review receives a
read-only worktree plus its artifact directory and `/tmp`; implementer steps
receive their worktree read/write.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Implementer invocations have a writable worktree over a readonly root | `src/adapters/process/bubblewrap.ts`; `"buildBubblewrapArgs binds the worktree read-write for implementer steps"` | PASS |
| Review keeps the worktree readonly while permitting artifact and temporary writes | `"buildBubblewrapArgs keeps review worktree read-only and binds an outside artifact directory"` | PASS |
| Invalid permitted paths fail without widening mounts | `"buildBubblewrapArgs rejects an unusable permitted path without widening a bind"` | PASS |
| Type checking and focused tests pass | `npx tsc --noEmit`; `node --import tsx --test test/bubblewrap-guard.test.ts` | PASS |

Next action: connect the shared profile to the common agent launch path and the spawn-and-tee invocation seam.
