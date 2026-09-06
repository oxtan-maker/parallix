# Mission: Scope FLOW cumulative state to the current reporting week (task-2459)

## Goal
Make the board projection publish a server-owned cumulative-flow series for the
current inclusive seven-day UTC reporting window, and make FLOW render that
series unchanged so historical completions do not inflate the weekly `done`
band.

## Why Now
FLOW already presents a seven-day decision window, but its cumulative state
series includes all historical stock. That mismatch makes the weekly `done`
band misleading and weakens the reporting surface introduced by TASK-2435.

## Refinement Signals
- Predicted NEL bucket: Medium (81–235)
- Confidence: High
- Selection note: activate as-is
- Main drivers: weekly-window ownership in the board projection; lifecycle
  evidence semantics; web transport contract; FLOW rendering regression
  coverage

## Scope
- Add a board-projection cumulative-flow series scoped to the current rolling
  seven-day inclusive UTC calendar-day window, with its label and bounds.
- Derive in-window lane state from recorded lifecycle facts; retain the metric
  contract's explicit unavailable or estimated result when history is missing.
- Use the same injected clock and window semantics as `px stats`.
- Carry the server-owned weekly series through the web transport and render it
  directly in FLOW without client-side rebasing or lifecycle inference.
- Add focused projection, transport, and browser rendering coverage.

## Out of Scope
- Changing the reporting-window length, timezone policy, or `px stats` output
  beyond sharing its established window semantics.
- Backfilling, repairing, or inventing historical lifecycle events.
- Redesigning FLOW, changing lane names or colors, or adding new charts.
- General metrics, board, transport, or web refactors unrelated to this weekly
  cumulative-flow path.

## Success Criteria
> **Falsifiability rule (ADR 0039 Part 2):** Each criterion must be falsifiable. Forbidden: subjective adjectives ("easy, fast, simple, intuitive, user-friendly, responsive, quick, efficient" without an attached metric) and vague quantifiers ("multiple, several, some, many, few, various"). For refactor / condense / migration missions, the criterion must enumerate the specific elements (rules, files, behaviours) that must survive — generic phrases like "preserve critical content" are not sufficient.

- A board snapshot publishes a cumulative-flow series with an explicit current
  seven-day inclusive UTC window label and bounds, derived using the injected
  clock.
- For a mission completed before that window, every published weekly point
  excludes that mission from `done`; the first point starts without its
  historical completion accumulation.
- A completion and a lane transition recorded within the window affect the
  corresponding weekly points, while missing lifecycle history is represented
  only by the established unavailable or estimated metric contract.
- `px stats` and the board projection produce the same seven-day inclusive UTC
  calendar-day bounds for the same injected clock.
- The web snapshot transports the weekly series, and FLOW renders those values
  without subtracting, rebasing, or inferring transitions in the browser.
- Focused tests cover the pre-window completion, in-window completion,
  in-window lane transition, missing-history case, transport, and rendered
  FLOW output; `npm test -- --unit-test-headroom` and
  `./scripts/verify-local.sh static-analysis` succeed.

## Risks and Assumptions
- Risk: lifecycle history may not establish a state at the window boundary.
  Assumption: the existing metrics contract exposes unavailable or estimated
  rather than fabricated data in this case.
- Risk: browser-side normalization may be implicit in FLOW rendering.
  Assumption: transport and render tests can prove the published values are
  used unchanged.
- Risk: window-boundary differences between UTC calendar days and local time.
  Assumption: the existing injected-clock decision-window service is the shared
  authority for `px stats` and the projection.

## Checkpoints
- CP 1: Write `test/task-2459-repro.test.ts` before any production change. Use
  an injected clock and a mission completed before the current seven-day
  window; assert that the published/displayed first weekly `done` value is
  zero. It must fail against this mission's parent commit (red) and pass when
  the weekly-series fix is complete (green).

Reproduction-Test: test/task-2459-repro.test.ts

- CP 2: Define the server-owned weekly cumulative-flow projection from recorded
  lifecycle facts, including window label/bounds and explicit missing-history
  behavior; add projection coverage for pre-window completion, in-window
  completion, and in-window lane movement.
- CP 3: Extend the web snapshot contract and FLOW rendering to carry and display
  the projection's weekly values unchanged; add transport and browser-render
  coverage that rules out client-side rebasing or lifecycle inference.
- CP 4: Run the mission gates and record criterion-by-criterion evidence.

### Checkpoint Documentation Requirements
Every checkpoint document (CP-N.md) MUST include:
- A summary of work done
- A `## Goal Check` section using exactly this 3-column table header: `| Criterion | Evidence | Status |`
- At least one evidence row for every success criterion. Lead with durable,
  verifiable evidence Parallix recognizes today: exact test names, ADR
  references, test file paths, and recognized repository commands or paths
  such as `npm test -- --unit-test-headroom`,
  `./scripts/verify-local.sh static-analysis`, `node ...`, `git ...`, or
  `px ...`. File:line references are accepted when necessary but discouraged
  because line numbers rot.
- Raw `stat`/`ls` output or generic prose alone is not sufficient; pair shell
  output with one of the accepted references above.
- A non-generic `Next action:` line at the bottom

Example Goal Check table:

| Criterion | Evidence | Status |
|---|---|---|
| Weekly series excludes pre-window completions | `test/task-2459-repro.test.ts` | PASS |
| FLOW renders server-owned weekly values | `test/web-board-render.test.ts` | PASS |
| Static analysis gate ran | `./scripts/verify-local.sh static-analysis` | PASS |

## Gates
- [ ] npm test -- --unit-test-headroom
- [ ] ./scripts/verify-local.sh static-analysis

## Restricted Areas
- Do not alter historical lifecycle records, backfill events, or represent
  unknown transitions as observed facts.
- Do not change the seven-day reporting policy, UTC calendar-day semantics, or
  injected-clock contract shared with `px stats`.
- Do not add client-side rebasing, subtraction, or lifecycle inference to FLOW.
- Do not broaden this mission into a board or visualization redesign.

## Stop Rules
- Stop and request direction if the existing lifecycle data cannot distinguish
  unavailable from estimated state at a reporting-window boundary.
- Stop and request direction if matching `px stats` requires changing its
  established reporting-window or UTC semantics.
- Stop and request direction if the web transport cannot carry the weekly
  series without a breaking protocol decision outside this mission's scope.
