# CP 3 — Attention queue + human-only integration rule; SC4 observation boundary corrected

## Work done

Confirmed the human-only integration rule holds, and ran the mission-declared gate.

- Attention queue (the shared `BoardProjection` output that `px lead` consumes): the
  regression test asserts the integration mission is enqueued with
  `{ kind: 'integrate-lane', detail: 'Awaiting integration' }` and
  `{ kind: 'integrate:merge', display: 'px integrate <id>' }`, and that the card's
  `integrate` command is enabled — SC2.
- Human-only rule preserved: `src/application/projections/board.ts::attentionAction`
  only resolves an `action.display` string the operator runs; the projection never
  executes the integration. The actual `px integrate` lives in the restricted
  `src/adapters/cli/commands/integrate*.ts`, which this mission did not touch. No
  automatic merge/closeout path was added.
- SC3 holds: the board cards and the attention queue read `mission.status` from the one
  shared projection (`board-readers.ts::build` → `loadAllMissions`); no queue-only
  `rawStatus`/task-file lane reconstruction exists.

## Premise re-check (correction of prior CP-3)

A prior checkpoint stated there was "no operator SQLite store seeded with a TASK-2508
row here." That is false. The real operator database is
`~/.local/state/parallix/parallix.db` (`src/adapters/sqlite/database-path-resolver.ts`,
`src/adapters/storage/storage.ts::resolveParallixHome`) and it holds:

```
missions row: id='task-2508', repository_id='parallix',
              status='active', raw_status='backlog', closed_at=NULL, version=33
```

The persisted lifecycle is `active` (non-terminal), not `integration` as the mission's
premise assumed. The board materialises this same aggregate through the shared
projection, so the attention queue the operator would consume is verified through that
shared projection output (the same path the regression test exercises), not through a
second materialisation.

## Observation boundary for SC4

`px lead --once` is not a runnable CLI in this worktree (the attention queue is a TUI/board
projection, not a standalone command), so SC4's "lead queue observed via `px lead`" half
was **not** executed. It is therefore recorded `UNVERIFIED`, not `PASS` — the honest
disclosure in the prose governs the table, and no lead outcome was fabricated. SC4's
human-only half (no automatic merge/closeout path added) is verifiable from the diff and
holds.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC1 integration mission projects despite completed Markdown | Premise false: real store holds `task-2508` `status='active'`, not `integration` | NOT REPRODUCIBLE — premise false |
| SC2 attention queue exposes integrate-lane / integrate:merge, card integrate enabled | `test/task-2515-integration-lifecycle-not-masked.test.ts`; `src/application/projections/board.ts` | Holds in hermetic invariant test |
| SC3 single DB-backed projection, no backlog reconstruction | `src/composition/board-projection.ts`; `ADR 0053` rule 4 | PASS (verified) |
| SC4 lead queue observed via shared projection; human-only integrate rule intact | `src/application/projections/board.ts::attentionAction`; `src/adapters/cli/commands/integrate.ts` (untouched); `px lead --once` not runnable here | SC4 = UNVERIFIED (lead half); human-only rule = PASS |
| SC5 regression test red-on-parent | `test/task-2515-integration-lifecycle-not-masked.test.ts` green on `9e8d656b9` | FALSIFIED (green on parent) |
| SC6 full gate | `./scripts/verify-local.sh all` — 2596 pass, 0 skipped | PASS |

## SC4 follow-up: stranded active missions are invisible in the attention queue

The SC4 trace against the real operator store (`~/.local/state/parallix/parallix.db`,
`task-2508` `status='active'`) found a defect **distinct from the (false) integration
premise**, and it is a real, reproducible bug.

An `active`-lane card with **no live work** — no fresh published `current-work` fact
and no live session — projects to the `active` lane but yields `{ kind: 'none' }` in
`attentionReason`, so the attention queue silently omits it. The mission dwells in
the queue forever with no human handoff. This is exactly the SC4 failure mode the
mission's Scope names (a mission "silently omitted" from the queue), and it is
unrelated to the integration-vs-Markdown premise, which was never reproducible.

### The fix (single shared projection, ADR 0053 rule 4)

`attentionReason` now returns `{ kind: 'orphaned-active', detail: 'Active mission has
no live work' }` for an `active` card with no live work; `attentionAction` maps it to
`{ kind: 'recover:mission', display: 'px recover <id>' }`. The reason declares
`mission-store` as its source so the item flags the DB-backed lane authority, never
the task file it must never reconstruct its lane from. `attentionRank` promotes a
stranded active card to rank 2 (before in-review); `availableBoardCommands` enables
`recover` on the card so the item clears the enabled-command gate.

`recover:mission` is wired as a **CLI-only** command: `BoardCommandKind` /
`WebBoardCommandKind` add `recover:mission`, `WebAttentionReasonKind` adds
`orphaned-active`, the web transport command/reason maps and the TUI reason text +
accent follow. The board surfaces `$ px recover <id>` marked `unavailable`; the
operator runs the CLI. The human-only integration rule is preserved — `px integrate`,
`px review`, and the human-only integration rule are untouched, no automatic
integration added.

### Verification

`test/attention-orphaned-active-observable.test.ts` (new, hermetic):
- stranded active (no live work) → enqueued with `orphaned-active` / `recover:mission`,
  `recover` command enabled, source `mission-store`
- active mission with a live-work fact → NOT enqueued (negative control)
- done mission → NOT enqueued (negative control)

The regression was confirmed red-before-fix (the branch was reverted and the new
test failed) and green-after. `./scripts/verify-local.sh all`: 2596 pass, 0 skipped;
ESLint, tsc, test-hygiene, and docs all clean. Existing attention-queue tests were
updated to the corrected ranking (stranded active = rank 2) and pass.

## Parked follow-up (residual path)

The only remaining path where a completed-Markdown `done` can win is the
`loadByRepository` "row absent" branch (`loadBoardMissions`), i.e. a non-terminal
mission whose SQLite row is missing so the board falls back to Markdown. That is a
store-data condition, not a projection reconstruction, and is out of scope (no new
authority, no second lifecycle source per the mission's Stop Rule). Recorded as a
Backlog follow-up so the concern is tracked, not lost.

Next action: commit CP-1.md, CP-2.md, CP-3.md, the regression test, the orphaned-active
fix, and the follow-up backlog task; leave the mission in draft phase (no
review/execute/integrate advance) per the Stop Rule. Both the not-reproducible
integration outcome and the new stranded-active finding are committed locally; the
orphaned-active fix is committed per operator instruction on 2026-09-14. The
not-reproducible integration outcome is handed to the reviewer for a formal
decision; the orphaned-active fix is a separate, verified defect.
