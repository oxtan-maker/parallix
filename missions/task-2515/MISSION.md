# Mission: Lead attention queue ignores persisted integration lifecycle when backlog task is completed (task-2515)

## Goal
Repair the board read/projection authority boundary so a mission whose SQLite `Mission` aggregate is in a non-terminal lifecycle (`integration`, or any other non-terminal `MissionStatus`) is projected into that lane and exposed on the board attention queue, even when its backlog task file in `backlog/completed/` carries `status: done`. The attention queue must derive its lane from the same DB-backed `Mission` projection the rest of the board uses, per ADR 0053 rule 4, instead of reconstructing lifecycle from a stale/completed task record. Preserve the human-only integration rule: the queue exposes the `integrate-lane`/`integrate:merge` item for the operator/recovery path but never performs the integration itself.

## Why Now
TASK-2508 landed its squash commit and Forgejo merged its review PR, but integration stopped before the SQLite `Mission` aggregate transitioned out of `integration` and before worktree cleanup. That leaves task-2508 in `backlog/completed/` with `status: done` while the persisted Mission lifecycle is still `integration`. Because the board materializes the completed Markdown record and derives the lane from that materialized `mission.status`, the authoritative persisted lifecycle is masked: the board never emits an `integrate-lane` attention item and `px lead` has nothing to run its recovery flow on. This is a direct violation of ADR 0053 rule 4 ("Current Mission state is read from Mission rows, not reconstructed from events, usage, task files, UI caches, or provider projections") and strands a shipped task with a retained worktree.

## Refinement Signals
- Predicted NEL bucket: Medium (81–235)
- Confidence: High
- Selection note: activate as-is
- Main drivers: ADR 0053 authority-boundary regression; stranded TASK-2508 lifecycle; single shared board projection contract (AC #3)

## Scope
- Trace the mission-read → board-projection authority boundary in `src/composition/board-projection.ts` (`loadBoardMissions` / `loadMission` / `withRepositoryTitle`), the `ConcreteMissionReadAdapter` in `src/adapters/backlog/concrete-mission-read-adapter.ts`, and `materializeBacklogMission` in `src/adapters/backlog/mission-materialization.ts`, and locate where a completed-backlog `status: done` can override or hide a non-terminal persisted `Mission.status`.
- Repair the projection so the DB-backed `MissionStore.load`/`loadByRepository` lifecycle wins over stale Markdown for any non-terminal state, without dropping missions that are genuinely `done` in both sources.
- Ensure `attentionReason`/`attentionAction` in `src/application/projections/board.ts` continue to emit the existing `integrate-lane` reason and `integrate:merge` action for the repaired mission, and that the item is enabled on its card.
- Add the smallest regression test at the projection/lead boundary that reproduces TASK-2508's completed-Markdown / stuck-SQLite combination.
- Verify the lead queue and the human-only integration rule together.

## Out of Scope
- Automatically running `px integrate` or changing the human-only integration safety rule.
- Changing Forgejo merge state, integration closeout behavior, or backlog task promotion rules.
- New persistence tables or a second lifecycle authority.
- Rebuilding, renaming, or moving the backlog task file for TASK-2508.

## Success Criteria
> **Falsifiability rule (ADR 0039 Part 2):** Each criterion is falsifiable and tied to a concrete repo command, test name, or file.

- SC1: A mission persisted as `integration` in the SQLite `MissionStore` appears in the `integration` board stage even when its `backlog/completed/` task file has frontmatter `status: done`. Falsified if the board card for that mission reports `lane !== 'integration'` or the mission is absent from the projection.
- SC2: The board attention queue contains that mission with reason `{ kind: 'integrate-lane' }` and action `{ kind: 'integrate:merge', display: 'px integrate <id>' }`, and the item's card has an enabled `integrate` command. Falsified if the queue omits the item or the action kind differs.
- SC3: The attention queue and board cards read lifecycle from one shared DB-backed projection. Falsified if any queue-only path reconstructs `MissionStatus` from a backlog `rawStatus`/task-file status instead of the `MissionStore` aggregate (e.g. a second materialization that reads task frontmatter for the lane).
- SC4: `px lead --once` observes the mission in the queue and records the human handoff instead of silently omitting it; no automatic integration is performed. Falsified if `px lead --once` exits without enqueuing the mission, or if it performs a merge/closeout write.
- SC5: The regression test in `test/` reproduces the completed-Markdown / stuck-SQLite combination and fails (red) on the parent commit `9e8d656b9` and passes (green) after the fix. Falsified if the test passes on the parent commit.
- SC6: `./scripts/verify-local.sh all` passes with no focused or unannotated skipped tests. Falsified if the gate exits non-zero or any skipped test lacks an annotating comment.

## Risks and Assumptions
- Assumes the SQLite `MissionStore` for TASK-2508 actually holds `status: 'integration'`; if the row is absent, the composition falls back to Markdown and the bug surfaces differently. Verify against the real store or assert the fixture matches the reported state.
- Assumes `loadBoardMissions` already prefers the persisted aggregate when `deps.missionStore` is present; the defect may be a narrower case (e.g. `loadByRepository` filtering, the `status !== 'done'` guard in the persisted loop, or `loadMission` fallback). Trace before editing.
- Preserving AC #3 means the fix must not introduce a parallel lane derivation; any reconciliation must live in the single materialization path.
- Changing `materializeBacklogMission` or `loadBoardMissions` can affect `px status <slug>` and web board cards; regression coverage must hold those stable.
- Assumption that `px lead --once` reads the same `BoardProjectionBuilder` output as the board; if lead has a separate read path, it must be routed through the shared projection.

## Checkpoints
- CP 1: Reproduce the bug with a failing test that locks the completed-Markdown / stuck-SQLite combination (red on parent commit).
- CP 2: Repair the projection/lead authority boundary so the DB-backed Mission lifecycle wins for non-terminal states.
- CP 3: Verify the lead queue and human-only integration behavior together; run the full gate.

### Checkpoint Documentation Requirements
Every checkpoint document (CP-N.md) MUST include:
- A summary of work done
- A `## Goal Check` section
- A 3-column pipe-delimited markdown table with columns: Criterion | Evidence | Status
- At least one evidence row per criterion using durable, verifiable references. Parallix already accepts:
  1. **Recognized repo commands or paths** — e.g., `` `npm test -- test/task-2515-integration-lifecycle-not-masked.test.ts` ``, `` `./scripts/verify-local.sh all` ``, `` `git rev-parse 9e8d656b9` ``
  2. **Test names** — must match a test name in the repo, e.g. `"task-2515 integration lifecycle not masked by completed backlog task"`
  3. **Test file paths** — e.g., `test/task-2515-integration-lifecycle-not-masked.test.ts` (must be an existing test file)
  4. **ADR references** — e.g., `ADR 0053` (must correspond to an existing file under `docs/adr/`)
  5. **File:line references** — accepted when needed, but line numbers eventually rot; prefer the forms above
- Raw `stat`/`ls` output or generic prose may appear as supplemental context, but pair them with one of the accepted references above. In particular, raw `npm test` output or a `git log` listing is NOT sufficient on its own: it must be tied to the exact test name, test file path, or ADR reference.
- A non-generic `Next action:` line at the bottom

Example Goal Check table:

| Criterion | Evidence | Status |
|---|---|---|
| Reproduction test fails on parent commit | `test/task-2515-integration-lifecycle-not-masked.test.ts`, `"task-2515 integration lifecycle not masked by completed backlog task"` | PASS |
| Integration mission projected despite completed Markdown | `./scripts/verify-local.sh all`; `src/composition/board-projection.ts` | PASS |
| Attention queue exposes integrate-lane item | `test/task-2515-integration-lifecycle-not-masked.test.ts` | PASS |
| Shared DB-backed projection, no backlog reconstruction | `ADR 0053`; `src/application/projections/board.ts` | PASS |

## Gates
- [ ] ./scripts/verify-local.sh all

## Restricted Areas
- Do not modify Forgejo integration/closeout logic (`src/adapters/forgejo/`, `src/adapters/cli/commands/integrate*.ts`), integration gate configuration, or backlog task promotion rules.
- Do not alter the human-only integration rule or add any automatic merge/closeout path.
- Do not delete, rename, or move `backlog/completed/task-2508 - Make-interrupted-landed-integrations-idempotently-closeable.md`, and do not change its `status: done` frontmatter.
- Do not add new SQLite tables or a second lifecycle authority.
- Do not introduce focused or unannotated skipped tests.

## Stop Rules
- Stop before implementing if the SQLite store for TASK-2508 does not actually hold `integration`; re-check the premise and restate the scope rather than guessing.
- Stop if the repair would require a second lane-derivation path; instead route all callers through the single shared projection.
- Stop if `px lead --once` cannot be observed in this worktree; document the observation boundary in the checkpoint and do not fabricate the lead outcome.
- Stop after the single `./scripts/verify-local.sh all` gate passes; do not advance to review/execute/integrate (draft phase only).

Reproduction-Test: test/task-2515-integration-lifecycle-not-masked.test.ts
