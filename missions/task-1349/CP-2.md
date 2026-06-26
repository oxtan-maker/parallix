# CP-2: Fix attribution — syncPrimaryBaseline on existing-PR path predates mission

## Work Done

The `syncPrimaryBaseline` call at `forgejo.js:435-442` (before the branch push at `forgejo.js:456` and before the existing-PR check at `forgejo.js:484`) was introduced in the **Initial commit `17e0b1c7`** (2026-06-22), which is an ancestor of `main`. This predates task-1349 creation (2026-06-25).

`git log -S "Sync primary branch baseline" --oneline -- lib/tools/forgejo.js` → `17e0b1c7 Initial commit`

The existing-PR path (forgejo.js:492-499) returns early after the sync has already completed. Both paths share this single invocation — no separate inline force-push exists anywhere in `createPr`.

The verification proof is captured at `forgejo.js:429` and passed through to `syncPrimaryBaseline` at `forgejo.js:436`, preserved on both paths. `syncPrimaryBaseline` calls `assertVerifiedTreeProofFn` at `forgejo.js:739`, preserving the verification gate.

## Goal Check

| Criterion | Evidence | Status |
|-----------|----------|--------|
| SC1: syncPrimaryBaseline called on existing-PR path | forgejo.js:435-442 (sync before branch push at 456, before PR check at 484) | PASS |
| SC2: Single shared invocation, no duplicate sync path | forgejo.js:435-442 (one call); git diff main..HEAD -- forgejo.js is empty | PASS |
| SC3: Forgejo review/main SHA equals local main SHA after --push | forgejo.js:753 (`git push --force main:main`) | PASS |
| SC5: Verification gate preserved | forgejo.js:429 (proof), forgejo.js:739 (assertVerifiedTreeProofFn) | PASS |

## Attribution

- **Fix commit**: `17e0b1c7` (2026-06-22, Initial commit)
- **Task created**: 2026-06-25 (3 days after fix landed in main)
- **Conclusion**: The mission's success criteria were already satisfied in main before this task was created. The task describes a bug that did not exist in the codebase at time of assignment.

## Next action: CP-3 — Verify regression test falsifiability
