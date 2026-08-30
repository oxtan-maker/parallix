# Mission: Attention queue: real ranks, reason-only entries, runnable actions, settled sourceFacts identity (task-2444)

Reproduction-Test: test/task-2444-attention-queue-repro.test.ts

## Goal
Make the board projection's `attentionQueue` a true ranked work list. After this
mission, `buildBoardProjection` (`src/application/projections/board.ts`) emits a
queue where:

1. `rank` values are a contiguous `1..N` sequence (no duplicates), in the
   queue's own priority order (existing `attentionRank` bucket, then
   `missionId` tie-break).
2. An entry exists only when its `reason.kind` is not `'none'`; an
   all-backlog repository yields an empty queue.
3. No queued entry advertises an action the same snapshot reports as not
   runnable (the `task-2337` shape: `active:execute` while the card's
   `active` command is not `enabled`).
4. Every queued entry carries non-empty `dependsOnSources`.
5. `sourceFacts` has a defined, documented identity: deduplicated per
   `(source, status, value)` tuple, documented in the transport contract.

## Why Now
A live `px web` read of an 8-mission repository (5 backlog, 2 integration,
1 done) returned 8 attention entries, 6 of them rank-less (`3, 3, 4, 4, 4, 4,
4, 4`), reason-less (`reason.kind === 'none'`, `detail === null`),
source-less (empty `dependsOnSources`), and one of them (`task-2337`)
recommending `active:execute` in state `ineligible` — the queue told the
operator to run a command the same payload says cannot run. The same
snapshot carried 380 `sourceFacts` for 8 missions, almost all repeats of
`task-markdown · fresh · <path>`. The browser board (TASK-2434) renders
`attentionQueue` verbatim by contract and cannot filter or renumber — the
fix belongs in the projection, which every board consumer (web, TUI shell)
inherits.

## Refinement Signals
- Predicted NEL bucket: Medium (81–235)
- Confidence: Medium
- Selection note: activate as-is
- Main drivers: bounded fix in `buildBoardProjection` (`src/application/projections/board.ts`) plus small touch to `src/application/projections/mission-board.ts` and doc comments in `src/interfaces/web/transport.ts`; one new repro test file and additions to `test/board-projections.test.ts`. Test-authoring volume is the swing factor — it can push the bucket to Large.

## Scope
- `buildBoardProjection` in `src/application/projections/board.ts`:
  - build `attentionQueue` from reason-bearing entries only (drop
    `reason.kind === 'none'`);
  - assign contiguous `1..N` `rank` ordinals in the existing priority order
    (`attentionRank` bucket, then `missionId`); the internal bucket function
    `attentionRank` keeps its `0..4` semantics;
  - drop any entry whose advertised action is not `enabled` in the entry's
    own card `commands` list from the same snapshot;
  - guarantee `dependsOnSources.length >= 1` for every queued entry
    (cover any reason kind that can reach the queue);
  - deduplicate `sourceFacts` per `(source, status, value)` tuple.
- Document the `sourceFacts` identity rule ("one fact per
  `(source, status, value)` tuple; repeats collapsed") in the
  `BoardProjection.sourceFacts` doc comment in `src/application/projections/board.ts`
  and in the `WebSourceFact` / snapshot doc in
  `src/interfaces/web/transport.ts`.
- `Reproduction-Test: test/task-2444-attention-queue-repro.test.ts` — the
  failing repro authored first (CP 1).
- Tests in `test/board-projections.test.ts` (and the repro file) covering:
  all-backlog empty queue, rank contiguity/uniquity on a mixed-lane
  repository, no non-runnable action, non-empty `dependsOnSources`, no
  duplicate `sourceFacts` tuples.

## Out of Scope
- Browser client (`web/`) and TUI (`src/interfaces/tui/shell.tsx`): they
  render the projection verbatim by contract; no client-side filtering,
  renumbering, or re-styling.
- Changing `attentionRank` bucket semantics or its existing unit tests in
  `test/board-projections.test.ts` (`"attentionRank returns 0 for blocking
  reason present"` etc.); the queue `rank` field becomes an ordinal while
  the bucket stays the internal priority input.
- Web transport schema changes or a `BOARD_PROJECTION_VERSION` bump: dedup
  changes values, not shape.
- Domain lifecycle changes (`src/domain/**`), `px` command behavior, and
  the card-level `attentionQueue(cards)` helper's public contract beyond
  what the projection fix requires (verify TUI consumption during
  execution; if the TUI relies on bucket values in the list order, it
  already does via the same sort — no separate change expected).

## Success Criteria
> **Falsifiability rule (ADR 0039 Part 2):** Each criterion must be falsifiable. Forbidden: subjective adjectives ("easy, fast, simple, intuitive, user-friendly, responsive, quick, efficient" without an attached metric) and vague quantifiers ("multiple, several, some, many, few, various"). For refactor / condense / migration missions, the criterion must enumerate the specific elements (rules, files, behaviours) that must survive — generic phrases like "preserve critical content" are not sufficient.

- SC1: For every input card set, `buildBoardProjection` emits
  `attentionQueue[i].rank === i + 1` for all `i` — contiguous `1..N`, no
  duplicates — in the existing priority order. Locked by a new test in
  `test/board-projections.test.ts` and by the repro test
  `test/task-2444-attention-queue-repro.test.ts`.
- SC2: No `attentionQueue` entry has `reason.kind === 'none'`; a card set
  whose missions are all backlog (gate passed, no blocker, no current
  work, no review/integration lane) produces an empty `attentionQueue`.
- SC3: For every queued entry, the advertised action's command appears in
  that entry's card `commands` with `enabled === true`; an entry whose
  action is not enabled (task-2337 shape) is absent from the queue.
- SC4: Every queued entry has `dependsOnSources.length >= 1`, asserted for
  each queue-reachable reason kind (`blocking`, `gate-failed`,
  `stale-work`, `review-lane`, `integrate-lane`).
- SC5: The projection's `sourceFacts` contains at most one fact per
  `(source, status, value)` tuple, and the identity rule is documented in
  `BoardProjection.sourceFacts` (`src/application/projections/board.ts`)
  and at `WebSourceFact` (`src/interfaces/web/transport.ts`), with no
  transport schema change.
- SC6: The existing bucket tests (`"attentionRank returns 0 for blocking
  reason present"`, `"attentionQueue sorts by rank then missionId
  ascending"`, and `test/domain-projections.test.ts` attention tests) still
  pass, with assertions updated only where the queue `rank` field
  legitimately changed from bucket to ordinal.

## Risks and Assumptions
- Existing tests pin both `attentionRank` buckets and queue shape
  (`test/board-projections.test.ts`, `test/domain-projections.test.ts`);
  the ordinal `rank` change forces assertion updates. Updated assertions
  must replace the old expectations, not delete coverage.
- Dropping entries whose action is not runnable could hide a genuine
  human-decision blocker whose reason is `blocking` but has no `px` command
  expressing it (e.g. `done`-lane or review-lane cards with a blocker).
  The queue is a command work list: such entries are dropped, and CP 2 must
  flag it if a real reason kind loses visibility.
- Assumption: deduplicating `sourceFacts` by `(source, status, value)`
  loses nothing a rebuildability consumer needs. `src/application/projections/board-subscription.ts`
  diffing must keep working after dedup — verify in CP 3.
- Assumption: the five defects reproduce at the projection level from
  `MissionCard` inputs alone (no web-transport involvement). If CP 1 cannot
  go red at that level, the defect sits higher and this mission stops.

## Checkpoints
- CP 1: Reproduction test locks the bug (red). Author
  `test/task-2444-attention-queue-repro.test.ts` before any fix. Build
  `MissionCard` inputs (local factory mirroring `makeCard` in
  `test/board-projections.test.ts`) and call `buildBoardProjection`.
  Five scenarios, each an assertion that fails at the mission's parent
  commit and passes after the fix:
  1. All-backlog repository (backlog cards, gate passed, no blocker, no
     current work) → `assert projection.attentionQueue.length === 0`
     (today: one reasonless entry per card).
  2. Mixed-lane repository (blocking, gate-failed, review, integration,
     active-with-agent, backlog) → assert ranks are exactly `1..N`
     contiguous and unique (today: duplicated `0..4` buckets).
  3. Task-2337 shape: a card whose reason is queue-bearing but whose
     advertised action's command is not `enabled` in the card's
     `commands` → assert the entry is absent from the queue (today:
     present with a non-runnable action).
  4. Every queued entry → `assert dependsOnSources.length >= 1` (today:
     `[]` on reasonless entries).
  5. `sourceFacts` input containing repeated `(source, status, value)`
     tuples → assert at most one per tuple in the output (today: repeats
     passed through).
  No source changes in this checkpoint; the test file must fail on the
  parent commit.
- CP 2: Projection fix (SC1–SC4, SC6). Edit
  `buildBoardProjection` in `src/application/projections/board.ts`: filter
  `reason.kind === 'none'`, assign ordinal `rank` in the existing sort
  order, drop entries whose advertised action is not `enabled` in the same
  snapshot's card `commands`, and guarantee non-empty `dependsOnSources`.
  Update affected assertions in `test/board-projections.test.ts` /
  `test/domain-projections.test.ts` per SC6. Repro tests 1–4 turn green.
- CP 3: sourceFacts identity (SC5). Deduplicate `sourceFacts` per
  `(source, status, value)` in the projection, document the identity rule
  in `board.ts` and `src/interfaces/web/transport.ts`, verify
  `board-subscription.ts` diffing still holds. Repro test 5 turns green.
  No transport schema change, no version bump.
- CP 4: Gates and final goal check. Run `./scripts/verify-local.sh all`,
  run the full repro file via `npm test -- test/task-2444-attention-queue-repro.test.ts`,
  and record the Goal Check table.

### Checkpoint Documentation Requirements
Mission-specific evidence for this mission: the canonical references are the
repro test `test/task-2444-attention-queue-repro.test.ts`,
`test/board-projections.test.ts`, the gate `./scripts/verify-local.sh all`,
and the targeted run `npm test -- test/task-2444-attention-queue-repro.test.ts`.
CP 1's Goal Check must record which of the five repro scenarios are red on the
parent commit; CP 2/CP 3 must record each scenario turning green by test name.

Every checkpoint document (CP-N.md) MUST include:
- A summary of work done
- A `## Goal Check` section
- A 3-column pipe-delimited markdown table with columns: Criterion | Evidence | Status
- At least one evidence row per criterion using durable, verifiable references. Parallix already accepts:
  1. **Recognized repo commands or paths** — e.g., `` `npm test -- test/repair-handoff.test.ts` ``, `` `px review <slug> --verify` ``, or `` `./scripts/verify-local.sh all` ``
  2. **Test names** — e.g., `"real custom-agent launcher smoke: full lifecycle with hello-world task (SC3/SC4/SC5/SC6/SC7)"` (must match a test name in the repo)
  3. **Test file paths** — e.g., `test/e2e-real-agent-smoke.test.ts` (must be an existing test file)
  4. **ADR references** — e.g., `ADR 0048` (must correspond to an existing file under `docs/adr/`)
  5. **File:line references** — accepted when needed, but line numbers eventually rot; prefer the forms above
- Raw `stat`/`ls` output or generic prose alone is not enough to satisfy a criterion row: pair any shell output with one of the accepted references above (a test name, test file path, recognized command, or ADR)
- A non-generic `Next action:` line at the bottom

Example Goal Check table:

| Criterion | Evidence | Status |
|---|---|---|
| Draft prompt defines checkpoint evidence rules | `prompts/draft.md` | PASS |
| Repair loop has targeted incomplete-evidence coverage | `test/repair-handoff.test.ts`, `"buildRelaunchPrompt returns string containing Goal Check table and mission slug"` | PASS |
| Verification gate ran | `./scripts/verify-local.sh docs` | PASS |

## Gates
- [ ] ./scripts/verify-local.sh all

## Restricted Areas
- `web/` (browser client) and `src/interfaces/tui/shell.tsx`: verbatim
  renderers by contract; do not modify for this mission.
- `src/domain/**`: mission lifecycle domain; projection-only fix.
- `src/interfaces/web/transport.ts` schema: doc comments only; no new
  fields, no `BOARD_PROJECTION_VERSION` bump.
- `docs/adr/**`: no new ADR; the sourceFacts identity rule is documented
  in code, per the backlog acceptance criterion.
- Backlog task `assignee` field: workflow-owned.
- `origin` remote: mission branches never push to origin (AGENTS.md
  local-only rule).

## Stop Rules
- Stop if the fix requires a web transport schema change (new field on
  `WebAttentionItem`/`WebSourceFact`) or a `BOARD_PROJECTION_VERSION` bump
  — the chosen design is value-only.
- Stop and report if dropping non-runnable-action entries hides a
  queue-bearing `blocking` reason that no `px` command expresses on a real
  mission scenario — the queue would silently mute a human-decision blocker.
- Stop if `sourceFacts` dedup breaks `src/application/projections/board-subscription.ts`
  diffing or any consumer that relies on per-read repetition.
- Stop if the repro tests cannot be made red at the `buildBoardProjection`
  level — the defect would sit above the projection and this contract's
  scope is wrong.
- Stop if more than the queue-shape tests in `test/board-projections.test.ts`
  and `test/domain-projections.test.ts` need rework for the ordinal `rank`
  change — scope-creep signal.
