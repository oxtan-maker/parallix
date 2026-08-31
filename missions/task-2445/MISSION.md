# Mission: Prevent direct backlog activation (task-2445)

Reproduction-Test: test/task-2445-prevent-direct-backlog-activation.test.ts

## Goal

Close the `backlog → active` hole in the mission lifecycle at the
workflow/projection boundary. The authoritative transition
(`decideMission`, `activate`) must reject an open `backlog` mission and
accept a `refined` one; the lane-event trigger mapping
(`triggerFromTransition`) must stop recognising `backlog → active` as an
activation so a direct Markdown edit is not recorded as a legitimate lane
event. The board-projection invariants (backlog projects `draft` as its only
runnable lifecycle action; refined projects `active` and not `draft`) are
already correct since task-2434 and must stay locked by tests. Ink and web
keep receiving identical action availability through the shared
`availableBoardCommands` projection — no UI-side eligibility logic.

## Why Now

Found while reconciling TASK-2434's read-only web board. TASK-2434 fixed the
projection half (`availableBoardCommands` no longer enables `active` for
backlog) and left a red locking assertion in `test/domain-mission.test.ts`
("mission lifecycle rejects unsupported jumps and missing handoff evidence"),
but never fixed the domain: `src/domain/mission-workflow.ts` still admits
`['backlog', 'refined', 'active']` for `activate`, and
`src/domain/board-event.ts` still maps `backlog → active` to `'activate'`.
The parent commit therefore carries a failing unit test, and a direct
Markdown status edit from backlog to active is still recorded as a valid
activation in the lane-event history that feeds board metrics. The web
client only renders server-projected enabled actions, so the correction must
land at the shared state machine, not in one UI.

## Refinement Signals

- Predicted NEL bucket: Small (0–80)
- Confidence: Medium
- Selection note: activate as-is
- Main drivers: one-line allow-list fix in `decideMission`'s `activate`
  case plus a one-line trigger-mapping fix in `triggerFromTransition`;
  net line growth is dominated by the new focused reproduction test file;
  existing projection tests from task-2434 are reused, not re-written.

## Scope

- CP-1: author the failing reproduction test
  `test/task-2445-prevent-direct-backlog-activation.test.ts` and record the
  red state at the parent commit (regression-test-first; no fix in CP-1).
- Remove `'backlog'` from the `activate` allow-list in
  `src/domain/mission-workflow.ts` (`decideMission`, `case 'activate'`),
  so `activate` admits `refined` (and idempotent re-`active`) only.
- Remove `from === 'backlog'` from `triggerFromTransition` in
  `src/domain/board-event.ts` and update its doc comment's state-machine
  mapping to match (`refined/active → active : 'activate'`);
  `null → active` (intake identity) is unchanged.
- Update the tests that pin the old mapping:
  `test/board-event-recorder.test.ts`
  ("triggerFromTransition maps all valid state machine transitions" —
  `triggerFromTransition('backlog', 'active')` must now expect `null`) and
  `test/persistence-characterization.test.ts`
  ("SC3: triggerFromTransition maps all known transitions correctly").
- Update the five mechanical fixture sites in
  `test/board-event-metrics-fixture.test.ts` that record a
  `backlog → active` lane event (they feed the metrics plumbing, not the
  state machine): swap the fixture to `refined → active` and keep the
  `fromStatus`/initial-lane assertions consistent.

## Out of Scope

- No changes to `src/application/projections/mission-board.ts` —
  `availableBoardCommands` is already correct (task-2434); this mission only
  re-locks it via the reproduction test.
- No changes under `web/` or `src/interfaces/` — the web client renders the
  server projection; eligibility must not be computed in any UI.
- No changes to the other lifecycle transitions (`submit-for-review`,
  `request-changes`, `approve`, `integrate`) or to the execute preflight /
  worktree requirement of `px active`.
- No change to the `null → active` intake mapping in
  `triggerFromTransition`.
- No authored-documentation updates (the domain README state diagram was
  already corrected by task-2434).

## Success Criteria

> **Falsifiability rule (ADR 0039 Part 2):** Each criterion must be falsifiable. Forbidden: subjective adjectives ("easy, fast, simple, intuitive, user-friendly, responsive, quick, efficient" without an attached metric) and vague quantifiers ("multiple, several, some, many, few, various"). For refactor / condense / migration missions, the criterion must enumerate the specific elements (rules, files, behaviours) that must survive — generic phrases like "preserve critical content" are not sufficient.

- SC1: `decideMission(mission, { type: 'activate', agent })` throws
  `MissionRuleViolation` for an open mission with status `backlog`
  (`closedAt: null`), and returns a mission with status `active` and the
  agent recorded as assignee for status `refined`. Verified by
  `test/task-2445-prevent-direct-backlog-activation.test.ts` and the
  previously-red assertion in `test/domain-mission.test.ts`
  ("mission lifecycle rejects unsupported jumps and missing handoff
  evidence") both passing.
- SC2: `availableBoardCommands` for an open `backlog` mission reports
  `draft` enabled and `active` disabled with reason
  "Mission must be refined before it can be activated"; for an open
  `refined` mission it reports `active` enabled and `draft` disabled.
  No projection source change; locked by
  `test/domain-projections.test.ts` ("backlog missions must be drafted
  before activation") and by the reproduction test.
- SC3: `triggerFromTransition('backlog', 'active')` returns `null`;
  `triggerFromTransition('refined', 'active')` returns `'activate'`;
  `triggerFromTransition(null, 'active')` still returns `'activate'`.
  Verified by `test/task-2445-prevent-direct-backlog-activation.test.ts`,
  `test/board-event-recorder.test.ts`, and
  `test/persistence-characterization.test.ts`.
- SC4: Ink and web derive command availability only from the shared
  `availableBoardCommands` via `projectMissionCard`; no UI-side
  eligibility computation is introduced. Verified with no source change
  under `web/` and with `test/web-board-render.test.ts` passing unchanged.
- SC5: `./scripts/verify-local.sh all` exits 0 on the final tree — the
  full unit suite is green, including the parent-commit red assertion in
  `test/domain-mission.test.ts` and the updated
  `test/board-event-metrics-fixture.test.ts`.
- SC6: `./scripts/verify-local.sh static-analysis` exits 0
  (ESLint, tsc --checkJs, test-hygiene, test typecheck).

## Risks and Assumptions

- Parent-commit unit suite is red: `test/domain-mission.test.ts` already
  contains the locking assertion that the current domain violates (added by
  task-2434). `./scripts/verify-local.sh all` therefore fails at the parent
  commit and is expected to go green only after the CP-2 fix. CP-1.md must
  record the red run so the failure is attributed to the locked bug, not to
  the draft.
- Assumption: no production flow legitimately activates a `backlog`
  mission. `MissionLifecycleService.activate` is called only from
  `synchronizeLifecycle` in `src/application/execute-mission-service.ts`,
  and the execute preflight requires the draft worktree (created by
  `px draft`) before a launch can record a sync. If this proves false, the
  fix is still correct — the workflow is backlog → draft/refined → active.
- Seven existing test sites pin the old mapping (2 characterization
  assertions, 5 metrics-fixture call sites). They are mechanical updates;
  if updating them forces changes to metrics assertions themselves (rather
  than fixture inputs), the `triggerFromTransition` half of the scope must
  be re-examined (see Stop rules).
- `null → active` (intake identity, a mission with no prior lane) remains
  `'activate'` deliberately; it is a pre-materialization edge outside this
  mission's acceptance criteria.

## Checkpoints

- CP 1: Lock the bug red. Author
  `test/task-2445-prevent-direct-backlog-activation.test.ts` covering:
  (a) `decideMission` on an open `backlog` mission with
  `{ type: 'activate', agent }` throws `MissionRuleViolation` — fails at
  the parent commit (red), passes once the fix lands (green);
  (b) `decideMission` on an open `refined` mission with the same command
  returns status `active`; (c) `availableBoardCommands` for `backlog`:
  `draft` enabled, `active` disabled with reason
  "Mission must be refined before it can be activated"; for `refined`:
  `active` enabled, `draft` disabled; (d)
  `triggerFromTransition('backlog', 'active')` returns `null` — fails at
  the parent commit (red), passes once the fix lands (green);
  (e) `triggerFromTransition('refined', 'active')` returns `'activate'`
  and `triggerFromTransition(null, 'active')` returns `'activate'`.
  Run the file at the parent commit, record the exact red failure output in
  CP-1.md (assertions a and d fail; b, c, e pass), and note that
  `test/domain-mission.test.ts`
  ("mission lifecycle rejects unsupported jumps and missing handoff
  evidence") is red at the parent for the same root cause. Commit the red
  test. No fix in this checkpoint.
- CP 2: Fix the state machine and turn the suite green. Remove `'backlog'`
  from the `activate` allow-list in `src/domain/mission-workflow.ts`;
  remove `from === 'backlog'` from `triggerFromTransition` in
  `src/domain/board-event.ts` and correct its doc-comment mapping; update
  the two characterization assertions
  (`test/board-event-recorder.test.ts`,
  `test/persistence-characterization.test.ts`) to expect `null` for
  `backlog → active`; update the five `backlog → active` fixture sites in
  `test/board-event-metrics-fixture.test.ts` to `refined → active` with
  consistent `fromStatus`/initial-lane assertions. Then verify the
  reproduction test is fully green, the previously-red
  `test/domain-mission.test.ts` assertion passes, and both gates pass:
  `./scripts/verify-local.sh all` and
  `./scripts/verify-local.sh static-analysis`.

### Checkpoint Documentation Requirements

Every checkpoint document (CP-N.md) MUST include:
- A summary of work done
- A `## Goal Check` section (exact heading, no variants)
- A 3-column pipe-delimited markdown table with columns: `| Criterion | Evidence | Status |`
- At least one evidence row per criterion using durable, verifiable references. Parallix already accepts:
  1. **Recognized repo commands or paths** — e.g., `` `npm test -- test/task-2445-prevent-direct-backlog-activation.test.ts` ``, `` `./scripts/verify-local.sh all` ``, `` `./scripts/verify-local.sh static-analysis` ``, or a backticked repo path like `src/domain/mission-workflow.ts`
  2. **Test names** — e.g., `"mission lifecycle rejects unsupported jumps and missing handoff evidence"` (must match a test name in the repo)
  3. **Test file paths** — e.g., `test/task-2445-prevent-direct-backlog-activation.test.ts`, `test/domain-projections.test.ts` (must be an existing test file)
  4. **ADR references** — e.g., `ADR 0039` (must correspond to an existing file under `docs/adr/`)
  5. **File:line references** — accepted when needed, but line numbers eventually rot; prefer the forms above (cite `src/domain/mission-workflow.ts` and the `case 'activate'` block, not a bare line number)
- Raw `stat`/`ls` output or generic prose alone is NOT sufficient evidence for any row — the weak-agent failure mode is pasting directory listings or writing "tests pass" without a check. Pair any shell output with one of the accepted references above (a backticked command that was run, an exact test name, or a test file path).
- A non-generic `Next action:` line at the bottom (for CP-1 it names the exact edit in `src/domain/mission-workflow.ts`; for CP-2 it names the gate verification, not a vague "continue").

CP-1.md specifics: quote the exact red assertion failures from the parent
commit run of `test/task-2445-prevent-direct-backlog-activation.test.ts`
(assertions a and d), and cite
`npm test -- test/domain-mission.test.ts` output showing the pre-existing
red assertion. Do not modify any source file in CP-1.

CP-2.md specifics: cite the green run of
`npm test -- test/task-2445-prevent-direct-backlog-activation.test.ts`, the
green run of `npm test -- test/domain-mission.test.ts`, and the two gate
commands with their passing output.

Example Goal Check table:

| Criterion | Evidence | Status |
|---|---|---|
| activate rejects backlog, accepts refined | `test/task-2445-prevent-direct-backlog-activation.test.ts`, `"mission lifecycle rejects unsupported jumps and missing handoff evidence"` | PASS |
| Projection invariants re-locked | `test/domain-projections.test.ts`, `"backlog missions must be drafted before activation"` | PASS |
| Full suite green | `./scripts/verify-local.sh all` | PASS |

## Gates

- [ ] ./scripts/verify-local.sh all
- [ ] ./scripts/verify-local.sh static-analysis

## Restricted Areas

- `web/` and `src/interfaces/` — no UI-side eligibility logic; both
  surfaces must keep reading the shared `availableBoardCommands` projection.
- `src/application/projections/mission-board.ts` — do not rework
  `availableBoardCommands`; it is already correct and only gets re-locked.
- Backlog task file
  `backlog/tasks/task-2445 - Prevent-direct-backlog-activation.md` — do not
  delete, rename, or move it; do not edit its `assignee` field.
- Mission branch push policy: never push to the `origin` (GitHub) remote;
  only the `review` (Forgejo) remote is a push target for mission branches;
  `px checkpoint` stages and commits locally.
- Lifecycle transitions other than `activate`, and the
  `null → active` intake mapping, are out of bounds.

## Stop Rules

- Stop if removing `'backlog'` from the `activate` allow-list breaks any
  test outside `test/domain-mission.test.ts`,
  `test/board-event-recorder.test.ts`,
  `test/persistence-characterization.test.ts`, and
  `test/board-event-metrics-fixture.test.ts` — that indicates an unknown
  legitimate backlog→active consumer and the scope needs re-examination.
- Stop if updating the five metrics-fixture sites requires changing metrics
  assertions (as opposed to swapping the fixture's from-status to
  `refined`); descoping the `triggerFromTransition` change (keeping
  SC1/SC2-only) is the fallback, but record the decision in CP-2.md.
- Stop if `./scripts/verify-local.sh all` on the parent tree shows failures
  other than the known red assertion in `test/domain-mission.test.ts` —
  the red state must be attributable to the locked bug only.
- Stop if the execute preflight of `px active` turns out to be a second
  gate whose operator-facing failure text must change; the domain fix must
  be sufficient.
- Do not start the review or integrate phase from this mission; hand off
  after the gates pass.
