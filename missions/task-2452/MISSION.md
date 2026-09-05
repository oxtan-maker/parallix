# Mission: One authoritative in-flight WIP total for the TUI and web top bars (task-2452)

Reproduction-Test: test/task-2452-repro.test.ts

## Goal
Move the in-flight lane rule into the shared board projection so both operator surfaces report one authoritative WIP total. `buildBoardProjection` (`src/application/projections/board.ts`) gains a top-level `inFlightWip: number` field — the count of missions in the `refined`, `active`, `review`, and `integration` lanes — computed by the one lane-membership rule in the codebase. The Ink TUI top bar (`src/interfaces/tui/shell.tsx`) renders that field instead of summing every lane of `wipCounts` (backlog, integration and done included today). The web top bar (`web/src/top-bar.tsx`) consumes the same field through the wire snapshot; its local `WIP_LANES` filter is deleted and the browser-guard allowlist entry widened for it in TASK-2437 is removed with it.

## Why Now
The TUI currently reports a WIP number that grows with shipped (`done`) and unstarted (`backlog`) work and never matches the operator's notion of work in flight, while the web board already reports the reference-design number (`wipCount = missions.filter(m => ['refined','active','review','approved'].includes(m.state)).length` in `Parallix Board GPU.dc.html`) — so the two surfaces of the same board disagree on the same repository. TASK-2437 fixed the web number by filtering lanes inside browser code, which the board's own architectural guard (`'production browser code maps no lane to a lifecycle rule or command'` in `test/web-board-render.test.ts`) normally forbids; that guard was widened with an allowlist entry to admit the fix. Every day the rule stays duplicated, the two copies can diverge per interface. This mission puts the rule where both surfaces read it and restores the guard to its pre-TASK-2437 strictness.

## Refinement Signals
- Predicted NEL bucket: Medium (81–235)
- Confidence: High
- Selection note: activate as-is; no dependency ordering needed (one projection field, two consumers, mechanical fixture updates)
- Main drivers: one new projection field + wire DTO field with fail-closed validation, TUI one-line consumer change, web filter deletion plus guard-allowlist revert, red→green repro test, projection and cross-surface regression tests

## Scope
- Reproduction test first (bug label): author `test/task-2452-repro.test.ts` before any production change. Scenario: a board built with `makeProjection` from `test/fixtures/board-projection.ts` holding two `backlog` cards, one each of `refined`, `active`, `review`, and `integration` (the integration card carries raw status `approved` — awaiting merge), and two `done` cards: eight cards, four in flight. The file asserts (1) the rendered TUI top bar reports `wip 4` and (2) the TUI total equals the web top bar total for the same projection. Both assertions fail (red) on the mission's parent commit: the TUI renders `wip 8` while the web renders `4`.
- Add the authoritative total to the projection: a named in-flight lane-membership rule and a top-level `readonly inFlightWip: number` field on `BoardProjection`, computed by `buildBoardProjection` in `src/application/projections/board.ts` as the number of cards whose lane is in that set. This is the exactly-one-place home of the rule.
- TUI consumer: `src/interfaces/tui/shell.tsx` renders `projection.inFlightWip` in the top bar (`wip N`) instead of `projection.wipCounts.reduce(...)`. Per-lane lane-header counts (`board-layout.tsx`, `lane-column.tsx`) are untouched.
- Wire contract: extend `WebBoardSnapshot` in `src/interfaces/web/transport.ts` with the same field; `toWebBoardSnapshot` projects it from the projection; `validateWebBoardSnapshot` requires the key and rejects a missing or non-finite-number value fail-closed as `invalid-payload` with the field path in `problems`.
- Web consumer: `web/src/top-bar.tsx` renders `snapshot.inFlightWip`; delete the `WIP_LANES` constant and its filter, and delete the allowlist line `"const WIP_LANES: ReadonlySet<string> = new Set(['refined', 'active', 'review', 'integration']);"` from the guard test in `test/web-board-render.test.ts`. The two remaining allowlist entries (`INTAKE_LANES`, `SHIPPED_LANE` — layout buckets) stay.
- Tests: projection tests pinning the lane membership and the approved/integration case; transport round-trip and validator-rejection tests; the cross-surface regression pin is the second repro assertion itself (it stays in `test/task-2452-repro.test.ts` as permanent coverage — no separate file); fixture updates the new required field forces (`test/fixtures/board-projection.ts` `makeProjection`, the literal projections in `test/tui-shell-component.test.ts`, and the hand-built wire snapshots in `test/web-board-render.test.ts` — the compiler enumerates the rest).
- Backlog task label: record the `user_value` classification on the backlog task (the `bug` label already present drives the red→green requirement).

## Out of Scope
- Any change to the per-lane series: `BoardProjection.wipCounts` keeps all six lanes, per-lane lane-header rendering, `wipLimit` handling, and the done-lane collapse count in `src/interfaces/tui/board-layout.tsx`.
- The domain per-lane counting helper `wipCounts()` in `src/application/projections/mission-board.ts` (counts every lane; not a WIP-total rule).
- The board-metrics time series (`wipSeries` / `test/board-metrics.test.ts`) — a different WIP-over-time concept.
- Attention queue, lane order, drag targets, FLOW panel, agent strip, and every other top-bar fact (attention count, unattributed sessions).
- Bumping `BOARD_PROJECTION_VERSION` or `WEB_TRANSPORT_VERSION` (see Risks and Stop Rules; bump only if a validator or gate forces it).
- New runtime or dev dependencies; no DOM environment beyond the existing node:test + `renderToString` pattern.
- CLI/`px` output changes; copying code from the `.dc.html` design prototype.

## Success Criteria
> **Falsifiability rule (ADR 0039 Part 2):** Each criterion must be falsifiable. Forbidden: subjective adjectives ("easy, fast, simple, intuitive, user-friendly, responsive, quick, efficient" without an attached metric) and vague quantifiers ("multiple, several, some, many, few, various"). For refactor / condense / migration missions, the criterion must enumerate the specific elements (rules, files, behaviours) that must survive — generic phrases like "preserve critical content" are not sufficient.

- SC1 (authoritative total, one place): `buildBoardProjection` returns `inFlightWip` on `BoardProjection`, and the in-flight membership rule (`refined`, `active`, `review`, `integration`) exists in exactly one production source file under `src/` (`src/application/projections/board.ts`); `web/src/` contains no lane-membership WIP rule and the TUI sums no lanes for the top-bar total. Pinned by a projection test in `test/board-projections.test.ts` asserting `inFlightWip` equals the `refined`+`active`+`review`+`integration` counts and is unaffected by adding `backlog` and `done` cards.
- SC2 (integration/approved pinned): a projection test explicitly asserts an `approved`-status mission sitting in the `integration` lane (awaiting merge) counts toward `inFlightWip`, and that removing it lowers the total by one.
- SC3 (TUI consumes the total): the repro test `test/task-2452-repro.test.ts` is green — rendering `BoardShell` (via `ink.renderToString`, as in `test/tui-shell-component.test.ts`) for the eight-card board reports `wip 4`, not `wip 8`; the existing per-lane lane-header tests (`test/tui-lane-columns.test.ts`, `'renders lane header with WIP count from the projection'`) pass unchanged.
- SC4 (web consumes the total, guard restored): `web/src/top-bar.tsx` renders `snapshot.inFlightWip` and contains no lane-literal set; the `WIP_LANES` allowlist entry is deleted from `'production browser code maps no lane to a lifecycle rule or command'` in `test/web-board-render.test.ts`; that guard test and `'the top bar WIP counts only in-flight lanes, not backlog or done'` (still asserting `4`) pass.
- SC5 (same total, both surfaces): a regression test asserts the TUI shell and the web top bar render the identical WIP total for the same projection — the board flows through `buildBoardProjection`/`makeProjection` once, reaches the TUI directly and the web through `toWebBoardSnapshot`, and both rendered totals equal the projection's `inFlightWip`.
- SC6 (fail-closed wire): `toWebBoardSnapshot` carries `inFlightWip` through a JSON round trip, and `validateWebBoardSnapshot` rejects a snapshot missing the key and a snapshot whose value is a non-finite number, each with `ok: false, code: 'invalid-payload'` and a problem naming the field path (tests in `test/web-transport.test.ts`).
- SC7 (red→green): the reproduction test fails (red) when run against the mission's parent commit — with the exact failing output recorded in `CP-1.md` — and passes (green) on the final tree, recorded in the checkpoint where the consumers land.
- SC8 (gate): `./scripts/verify-local.sh all` passes on the final tree.

## Risks and Assumptions
- Adding a required field to `BoardProjection` and `WebBoardSnapshot` forces every test fixture that constructs full literals to update; the TypeScript compiler enumerates them. Assumption: all such updates are mechanical (add the field or read the constant), never a behavior change.
- No version bump planned: projections are rebuilt per build (adapter scopes are "never retained as a cache", `src/adapters/backlog/concrete-mission-read-adapter.ts`) and the only web client is the in-repo shell, so the additive required field is compile-time enforced. If the fail-closed validator or a gate nonetheless demands a version change, bump `BOARD_PROJECTION_VERSION`/`WEB_TRANSPORT_VERSION` mechanically (Stop Rules).
- The hand-built wire snapshots in `test/web-board-render.test.ts` (`snapshotOf`/`populated()`) bypass `toWebBoardSnapshot`, so their fixtures must set the new field explicitly — a missed fixture surfaces as a validator/compiler failure, not a silent zero.
- The reference design counts states (`refined`, `active`, `review`, `approved`); in this codebase the `integration` lane is exactly the approved-and-awaiting-merge missions. That mapping is the mission's semantic anchor; do not "correct" it toward `done`-adjacent states.
- The guard allowlist keeps `INTAKE_LANES` and `SHIPPED_LANE` (layout buckets the web board legitimately needs); only the WIP entry is a lifecycle rule in disguise and must go.

## Checkpoints
- CP 1 (red reproduction, bug label): Author `test/task-2452-repro.test.ts` before any production change, exactly as described in Scope: build the eight-card board with `makeProjection`/`makeCards` from `test/fixtures/board-projection.ts` (integration card status `approved`), assert the TUI top bar reports `wip 4` and that the TUI total equals the web `TopBar` total rendered from `toWebBoardSnapshot` of the same projection (via `react-dom/server` `renderToString`, same pattern as `test/web-board-render.test.ts`). Run `npm test -- test/task-2452-repro.test.ts` at the parent commit and record the failing output (red: TUI renders `wip 8`) in `CP-1.md`. No production file changes in this checkpoint.
- CP 2 (projection owns the rule): Add the in-flight membership rule and `inFlightWip` to `BoardProjection`/`buildBoardProjection` in `src/application/projections/board.ts`; update the projection-construction fixtures the compiler flags; add the SC1/SC2 projection tests in `test/board-projections.test.ts`. The repro test stays red (surfaces not wired yet) — record that.
- CP 3 (both surfaces consume one total): `shell.tsx` renders `projection.inFlightWip`; `transport.ts` DTO/mapping/validator gain the field with the SC6 tests in `test/web-transport.test.ts`; `top-bar.tsx` renders the snapshot field and `WIP_LANES` is deleted with its guard allowlist entry; the SC5 cross-surface regression test passes. The repro test goes green — record the green run of `npm test -- test/task-2452-repro.test.ts`.
- CP 4 (gate): Run `./scripts/verify-local.sh all`; verify the one-place rule with a repo-wide search (rule literal appears in `src/application/projections/board.ts` and test files only); complete the Goal Check evidence table.

### Checkpoint Documentation Requirements
Every checkpoint document (CP-N.md) MUST include:
- A summary of work done
- The exact heading `## Goal Check`
- A 3-column pipe-delimited markdown table with the exact header `| Criterion | Evidence | Status |`
- At least one evidence row per success criterion, led by the durable evidence forms Parallix verifies today: exact test names (matching a `test()` name in the repo), ADR references (existing files under `docs/adr/`), test file paths, and recognized repo commands/paths such as backticked `npm test -- test/task-2452-repro.test.ts`, `node ...`, `git ...`, `px ...`, or `./scripts/verify-local.sh all`. File:line references are accepted parenthetically when needed but discouraged because line numbers rot.
- For the red→green criterion (SC7): CP 1 records the exact red command-output excerpt of `npm test -- test/task-2452-repro.test.ts` at the parent commit (showing `wip 8` where `wip 4` is asserted), and CP 3 records the exact green run of the same command.
- Weak-agent failure mode to avoid: raw `stat`/`ls` output or generic prose ("tests pass", "rule removed") alone is NOT enough evidence. Any shell output must be paired with one of the accepted references above — an exact test name, an existing test file path, an ADR reference, or a recognized repo command.
- A non-generic `Next action:` line at the bottom

Example Goal Check table:

| Criterion | Evidence | Status |
|---|---|---|
| Projection exposes the authoritative in-flight total | `test/board-projections.test.ts`, `'buildBoardProjection inFlightWip counts refined, active, review and integration lanes only'` | PASS |
| Reproduction test green on final tree | `test/task-2452-repro.test.ts`, `npm test -- test/task-2452-repro.test.ts` | PASS |
| Browser guard restored (no WIP allowlist entry) | `test/web-board-render.test.ts`, `'production browser code maps no lane to a lifecycle rule or command'` | PASS |
| Verification gate ran | `./scripts/verify-local.sh all` | PASS |

## Gates
- [ ] npm test -- test/task-2452-repro.test.ts
- [ ] ./scripts/verify-local.sh all

## Restricted Areas
- No changes to per-lane count semantics: `wipCounts` in `src/application/projections/board.ts`, `wipCounts()` in `src/application/projections/mission-board.ts`, lane-header rendering and `wipLimit` in `src/interfaces/tui/lane-column.tsx`/`board-layout.tsx`.
- No changes to attention ranking, `agentIsWorking`, `availableBoardCommands`, `projectMissionCard`, or anything under `src/domain/`.
- The guard test `'production browser code maps no lane to a lifecycle rule or command'` itself stays intact; only the `WIP_LANES` allowlist line is deleted — never widen the allowlist to admit new browser lane rules (Definition of Done #2).
- No new lane-to-lifecycle rule in browser code, no new npm runtime or dev dependencies.
- No copying of code or state logic from the `.dc.html` design prototype.

## Stop Rules
- Stop and split if a third consumer of the lane-membership WIP rule is found (CLI surface, metrics, attention) that cannot read the projection field: SC1's "exactly one place" must stay true, not be negotiated around.
- Stop if the repro test cannot be made red at the parent commit (e.g. ink rendering output differs from the assumed `wip N` form): re-anchor the assertion on the actual rendered text before writing any fix.
- Stop if removing `WIP_LANES` makes the browser guard fail on any line other than the deleted allowlist entry — do not add new allowlist entries to make it pass.
- Stop and revisit versioning if the fail-closed validator or a gate requires a `BOARD_PROJECTION_VERSION`/`WEB_TRANSPORT_VERSION` bump: the bump must be mechanical (constant plus fixture literals) with no behavior change; otherwise escalate.
- Stop if the cross-surface regression test needs a DOM environment beyond the existing node:test + `renderToString` approach; confirm before adding any dependency.
