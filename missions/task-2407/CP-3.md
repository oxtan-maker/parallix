# CP-3: Regression + board coverage + verification gate for task-2407

## Summary — STOP RULE FIRED (mission premise unreproducible)

The mission premise — a static ESM cycle in the `board-projection.ts` →
`worktree.ts` path that makes `snapshotWorktreeTopology` unavailable at runtime —
cannot be reproduced on this tree and admits no production repair:

- No production diff: `git diff --stat 2ccf98f9..HEAD -- src/` is empty. The full
  mission diff is `missions/task-2407/{MISSION,CP-1,CP-2,CP-3}.md` plus the new
  regression test (0 deletions, 260 insertions).
- No ESM cycle exists: a DFS over the value-import graph finds **0 cycles** across
  1067 edges; 0 cycles touch `src/adapters/git/worktree.ts` or
  `src/composition/board-projection.ts`.
- The focused regression test is green on the parent tree as well as HEAD
  (`src/` byte-identical): `npx tsx --test test/task-2407-snapshot-worktree-topology-runtime-repro.test.ts` →
  `pass 2, fail 0` at both.
- The shipped CLI is a single flattened esbuild bundle (`build/px.mjs`), so a
  Node named-export *link* error across module boundaries cannot occur there
  (`grep -c "^import .*from ['"]\.\." build/px.mjs` = 0; `snapshotWorktreeTopology`
  is inlined). The reported step-1.7 failure therefore came from another loader/
  tree, not from this tree's source.

The added regression test is hermetic, correct, and safe as a standing guard
against a *future* cycle; it is not a red-on-parent reproduction of this
mission's premise. No production file was changed and none should be (the
restricted areas and Stop Rules are honored).

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Focused regression test fails on parent, then passes after repair | STOP RULE FIRED: `git diff --stat 2ccf98f9..HEAD -- src/` empty; test green at parent and HEAD (`npx tsx --test test/task-2407-snapshot-worktree-topology-runtime-repro.test.ts` → `pass 2, fail 0`); 0 value-import cycles across 1067 edges touch `worktree.ts`/`board-projection.ts` | NOT MET (unsatisfiable by construction; Stop Rule invoked) |
| Loading handoff path resolves `snapshotWorktreeTopology` as callable named export | `test/task-2407-snapshot-worktree-topology-runtime-repro.test.ts` — test `task-2407 CLI composition graph provides snapshotWorktreeTopology as a callable named export`; asserts `../src/composition/production-capabilities.js` + `../src/application/handoff-command-use-case.js` + `../src/adapters/git/worktree.js` load without named-export error | PASS (standing guard; already green on parent — not a repair) |
| Board projection worktree-amplification coverage passes (topology behavior retained) | `test/board-readers.worktree-amplification.test.ts` — `board projection worktree-list count is O(1) vs mission count`, `board projection reads each distinct task document once for metadata`, `board projection does not scan or materialize backlog archive` | PASS |
| Shipped CLI cannot throw the reported named-export error | verified against `build/px.mjs:1`; `grep -c "^import .*from ['"]\.\." build/px.mjs` returns 0 (single flattened esbuild bundle, `snapshotWorktreeTopology` inlined) — Node named-export link errors cannot occur in a flattened bundle; explains why the real failure came from another loader/tree | PASS |
| `captureNelAtHandoff` reachable via the resolved composition graph | `src/application/handoff-command-use-case.ts:508` reached through `application-services.ts` → `production-capabilities.ts` → `board-projection.ts` | PASS |
| NEL domain rules unchanged | `src/domain/net-engineering-lines.ts:1`; `git diff 2ccf98f9..HEAD -- src/domain/net-engineering-lines.ts` returns no diff (file present, 144 lines, untouched this mission) | PASS |
| No .only / bare .skip introduced | `./scripts/verify-local.sh static-analysis` test-hygiene stage clean | PASS |
| Static-analysis gate passes | `./scripts/verify-local.sh static-analysis` — ESLint clean, `npm run typecheck` clean, test-hygiene clean | PASS |
| Docs gate passes | `node scripts/verify-docs.mjs` PASS | PASS |
| Full verification gate passes | `./scripts/verify-local.sh all` — 2059 tests pass, 0 fail (suite budget 180 s) | PASS |

## Next action
This is a Stop-Rule report, not completion. Recommend the coordinator **rescope
or close** the mission: the premise (a static ESM cycle in the
`board-projection` → `worktree` path) does not reproduce on the parent tree and
admits no production repair. The hermetic regression test is retained as a
standing guard against a future cycle. Commit this checkpoint on the mission
branch (local only, not pushed to origin).
