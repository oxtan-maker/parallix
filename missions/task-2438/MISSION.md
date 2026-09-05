# Mission: Show parallel worktree missions in `px ui` (task-2438)

## Goal

Make `px ui`, launched from any worktree of a repository, show every current
persisted mission for that repository in its persisted lifecycle lane.

## Why Now

The prior TASK-2438 correction reads repository-scoped SQLite aggregates, but
`composeBoardProjection()` subsequently limits the board to the Markdown
catalog visible in the launching checkout. Missions that exist only in another
live worktree are still absent from both Ink and web, so operators cannot see
the repository's actual parallel work.

## Refinement Signals

- Predicted NEL bucket: Small (0–80)
- Confidence: High
- Selection note: activate as-is; the regression identifies the shared board
  catalog boundary and has an existing focused test location.
- Main drivers: one red-to-green board-projection regression, one shared
  catalog selection correction, and no schema or UI redesign.

## Scope

- **`test/task-2438-worktree-board-repro.test.ts`**: Extend the existing
  reproduction so one active persisted mission is present only in the other
  worktree's Markdown catalog; assert it is shown in the board for either
  worktree of the same repository.
- **Board projection/catalog composition**: Preserve repository-scoped,
  persisted current missions when constructing the shared board catalog rather
  than discarding them because they are absent from the launching checkout's
  Markdown catalog.
- Keep archived records excluded and keep records from a different repository
  excluded.
- Verify the resulting shared projection is consumed consistently by both Ink
  and web board entry points.

Reproduction-Test: test/task-2438-worktree-board-repro.test.ts

## Out of Scope

- Worktree discovery or filesystem crawling as a second source of truth.
- SQLite schema, lifecycle transition, or repository-identity changes.
- TUI/web layout, lane definitions, mission-detail redesign, or archive
  restoration.
- Broad changes to Markdown catalog parsing beyond what the projection needs
  to represent persisted current missions.

## Success Criteria

- SC1: `test/task-2438-worktree-board-repro.test.ts` has a red reproduction
  where an `active` persisted mission appears only in the other same-repository
  worktree's Markdown catalog, is absent at the parent commit, and is present
  after the fix.
- SC2: For either of two worktrees with the same repository ID, the board
  projection contains the same persisted current mission IDs and assigns active,
  review, and integration missions to their persisted lanes.
- SC3: A persisted mission belonging to another repository is absent from the
  projection.
- SC4: An archived persisted record is absent from the projection even when it
  is known to a worktree Markdown catalog.
- SC5: Ink and web consume the corrected shared board projection; no separate
  worktree-specific mission-set filter remains in either entry path.
- SC6: `node --test test/task-2438-worktree-board-repro.test.ts` passes after
  the correction.
- SC7: `./scripts/verify-local.sh all` passes on the final tree.

## Risks and Assumptions

- **Risk**: Including every persisted ID could revive archived history.
  **Mitigation**: retain the existing current/archived eligibility rule and
  assert archived exclusion in the focused reproduction.
- **Risk**: Combining persisted and Markdown records may lose titles or other
  display metadata. **Mitigation**: use the existing board catalog merge path
  and change only its membership filter.
- **Assumption**: Repository ID is the authority that groups sibling
  worktrees, while persisted lifecycle aggregates are the authority for lane
  state.
- **Assumption**: Both Ink and web reach the same composed board projection;
  confirm this before changing a consumer-specific path.

## Checkpoints

- CP 1: Before any fix, author the failing regression in
  `test/task-2438-worktree-board-repro.test.ts`. Build two fixture worktrees
  with the same repository ID; put an active persisted mission only in the
  other worktree's Markdown catalog; and assert that the projection from the
  launching worktree includes that mission in `active`. The assertion must fail
  at the mission parent commit (red) and pass after the catalog correction
  (green). Also retain assertions that another repository and archived records
  are excluded.
- CP 2: Trace the shared board composition from persisted mission aggregates
  through `composeBoardProjection()` and replace only the checkout-local
  membership filter that drops current persisted sibling-worktree missions.
  Do not add worktree crawling or a second mission authority.
- CP 3: Turn the CP 1 reproduction green and confirm the corrected shared
  projection supplies both Ink and web without consumer-specific filtering.
- CP 4: Run the required verifier and record observed goal-check evidence.

### Checkpoint Documentation Requirements

Every checkpoint document (CP-N.md) must lead its evidence with durable,
verifiable references: exact test names, ADR references, test file paths, and
recognized repository commands or paths such as `node --test
test/task-2438-worktree-board-repro.test.ts`, `npm test`, `git diff`, `px ui`,
or `./scripts/verify-local.sh all`. File:line references are accepted but
discouraged because line numbers rot.

Each checkpoint document must include the exact heading `## Goal Check` and
this 3-column table:

| Criterion | Evidence | Status |
|---|---|---|
| Example | `test/task-2438-worktree-board-repro.test.ts`, exact test name, or `./scripts/verify-local.sh all` | PASS/FAIL |

Include one evidence row for every applicable success criterion and end with a
specific `Next action:` line. Raw `stat`/`ls` output or generic prose alone is
not enough; pair any shell output with an accepted test name, ADR reference,
test file path, or recognized repository command/path above.

## Gates

- [ ] ./scripts/verify-local.sh all

## Restricted Areas

- SQLite migrations and persisted mission lifecycle writers: the defect is a
  board-catalog membership filter, not persistence or transitions.
- Worktree creation, discovery, and cleanup: do not scan worktrees to infer
  board state.
- `src/interfaces/tui/` and web visual components: do not duplicate the fix in
  consumers if the shared projection can supply the correct mission set.
- Archive-management behavior: archived records must remain excluded.

## Stop Rules

- Stop and reassess if persisted data cannot distinguish current from archived
  records without a schema or lifecycle-semantics change.
- Stop and reassess if Ink and web do not share a projection boundary; document
  the divergent paths before proposing consumer-specific changes.
- Do not add filesystem worktree crawling, a new persistence store, or a
  schema migration to solve catalog membership.
- Do not change another repository's board visibility or include archived
  records to satisfy the sibling-worktree scenario.
