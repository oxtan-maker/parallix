# CP-4 — follow-up plan and stop

CP-4 completes the reconciliation mission without implementing a persistence
cutover. The next slice is documented in `NEXT-PERSISTENCE-SLICE.md`: it starts
with a repository-local adapter for the existing Mission aggregate and leaves
operator-local SQLite, worktree session markers, and Attempt modeling outside
its scope.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC1 — authority inventory | `missions/task-2322/CP-1.md`; `src/application/mission-authority.ts:16-36` | COMPLETE |
| SC2 — accepted ADR text is internally consistent | ADR 0044, `docs/adr/0044-workflow-distribution-model.md:116-146`; ADR 0051, `docs/adr/0051-ui-neutral-application-boundary.md:38-50`; ADR 0052, `docs/adr/0052-task-catalog-authority-and-board-authorship.md:31-48` | COMPLETE |
| SC3 — ADR 0052 disposition is explicit in the ADR set | `docs/adr/0052-task-catalog-authority-and-board-authorship.md:1-5`; `docs/adr/index.md` | COMPLETE — superseded for mission authority. |
| SC4 — repository design notes align on aggregate, authority, closure, review, and sessions | `src/domain/README.md:12-20`; `src/domain/README.md:106-131`; `src/domain/README.md:168-178` | COMPLETE |
| SC5 — next implementation slice is concrete and states Attempt disposition | `missions/task-2322/NEXT-PERSISTENCE-SLICE.md`; `docs/adr/0044-workflow-distribution-model.md:118-137` | COMPLETE — repository-local MissionStore; Attempt deferred. |
| SC6 — automated/type-level proof anchors authority | `test/domain-authority.test.ts`; "mission reads prefer repository truth and label cache fallback stale" | COMPLETE |
| SC7 — no premature production persistence implementation | `src/adapters/sqlite/adapter-factory.ts:43-76`; `./scripts/verify-local.sh docs` | COMPLETE — this mission changed documentation and plans only. |

Next action: create and lock a new implementation mission using
`missions/task-2322/NEXT-PERSISTENCE-SLICE.md` as its scope, then implement the
repository-local MissionStore without reopening the aggregate, database-scope,
or Attempt decisions made here.

## Review round 1 resolution

Finding 1 was issued against the superseded implementation-first mission
contract. It is now fixed by the revised authority-reconciliation mission:
ADR 0052 is superseded for mission authority, ADR 0044 defines the
repository-local MissionStore/operator-local SQLite split, and this mission
stops with a bounded follow-up plan instead of claiming an unimplemented
`Repository -> Mission -> Attempt` cutover.

Next action: request a new review decision against the current mission contract
and CP-1 through CP-4, rather than the superseded CP-1 stop record.

## Review round 1 follow-up

The Claude review correctly identified an unrelated committed change that
disabled the real PTY consequential-action smoke test. The test has been
restored to its `main` state; therefore SC7's documentation-only claim is again
accurate. ADR 0051's `Related:` header is retained as historical linkage; its
body records ADR 0052's supersession.

Next action: review the restored `test/tui-pty-smoke.test.ts` alongside the
documentation reconciliation; no TUI behavior change belongs to this mission.
