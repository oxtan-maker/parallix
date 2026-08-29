# Mission: Fix long-running `px ui` memory retention (task-2424)

## Goal

Stop `px ui` from retaining TUI lifecycle resources across board refreshes and shutdown, so a board left open does not grow toward the Node.js heap limit.

## Why Now

An operator reported that a long-running `px ui` process reaches roughly 4 GB and terminates with Node.js out-of-memory after repeated garbage collection. The interactive board is intended to remain open while missions progress; an unbounded retained-resource path makes that normal use unreliable.

## Refinement Signals

- Predicted NEL bucket: Small (0–80)
- Confidence: High
- Selection note: activate as-is
- Main drivers: deterministic lifecycle reproduction, one ownership/cleanup correction in the TUI refresh path, focused regression coverage

## Scope

- Add `test/task-2424-repro.test.ts` before changing production code. It must mount a `BoardShell` with a controllable `subscribeProjection`, drive repeated projection updates, unmount it, and assert that every subscription created by the shell was unsubscribed exactly once and that no update callback remains reachable after unmount. The assertion must fail on this mission’s parent commit (red) and pass after the fix (green).
- Trace the ownership chain from `src/interfaces/tui/ui-command.ts` through `src/interfaces/tui/shell.tsx` to `src/application/projections/board-subscription.ts`, including the timer, projection callback, Ink unmount, and terminal-listener cleanup paths.
- Make the smallest correction at the shared owner of the retained resource. Preserve the 2-second board refresh behavior, clean TUI exit, and one-frame piped `px ui` behavior.
- Extend the reproduction test to cover the corrected lifecycle and retain it as the regression test.

Reproduction-Test: test/task-2424-repro.test.ts

## Out of Scope

- Raising Node’s heap limit, adding process restarts, or adding a generic memory-monitoring service.
- Redesigning the board projection data model, polling interval, TUI layout, keyboard controls, or command lifecycle.
- Changes to headless CLI behavior, SQLite/Git projections, agent execution, or Forgejo integration.
- Broad heap profiling infrastructure beyond diagnostics needed to identify the retained TUI resource.

## Success Criteria

> **Falsifiability rule (ADR 0039 Part 2):** Each criterion must be falsifiable. Forbidden: subjective adjectives ("easy, fast, simple, intuitive, user-friendly, responsive, quick, efficient" without an attached metric) and vague quantifiers ("multiple, several, some, many, few, various").

- SC1: `test/task-2424-repro.test.ts` creates a controllable projection subscription, drives exactly three projection updates, unmounts the board, and proves each created unsubscribe function is called exactly once.
- SC2: After unmount in the same reproduction, invoking every previously captured projection callback causes no shell redraw or state update.
- SC3: The reproduction test is red at the mission parent commit and green after the production correction.
- SC4: Interactive `px ui` continues to subscribe for live projection changes while mounted, and its unsubscribe path clears its pending board-refresh timer.
- SC5: The existing headless-isolation and resize-cleanup contracts remain true: the headless CLI does not statically load Ink/React, and an unmounted board removes its terminal resize listener.
- SC6: `node --test test/task-2424-repro.test.ts` passes on the final tree.
- SC7: `./scripts/verify-local.sh all` passes on the final tree.

## Risks and Assumptions

- Risk: The reported heap growth may originate in Ink or a dependency instead of Parallix-owned callbacks. Mitigation: use the reproduction test to identify a retained Parallix lifecycle resource before changing code; stop if it cannot demonstrate one.
- Risk: A cleanup change can suppress the live board refresh loop. Mitigation: retain an explicit mounted-state assertion in the reproduction test and preserve `subscribeToBoardProjection` as the sole refresh owner.
- Assumption: The report concerns the interactive TTY path, not piped `px ui`; the latter remains finite by design.
- Assumption: The failing parent-commit reproduction can be made deterministic with fake callbacks/timers and does not need a real Forgejo instance or a long-running heap stress test.

## Checkpoints

- CP 1: Author `test/task-2424-repro.test.ts` before any production edit. Mount `BoardShell` with a test-controlled `subscribeProjection`, trigger exactly three projection changes, then unmount. Capture every callback and cleanup function; assert that each subscription cleanup is called once and post-unmount callbacks cannot schedule a redraw/state update. This must fail on the mission parent commit (red) and is the green regression assertion after the fix.
- CP 2: Trace the red failure to the owner in `src/interfaces/tui/shell.tsx`, `src/interfaces/tui/ui-command.ts`, or `src/application/projections/board-subscription.ts`; make only the minimum lifecycle cleanup change that resolves the retained resource without changing refresh cadence or headless behavior.
- CP 3: Run `node --test test/task-2424-repro.test.ts`, confirm the red-to-green test passes, and run `./scripts/verify-local.sh all`. Record the durable evidence in the final checkpoint.

### Checkpoint Documentation Requirements

Every checkpoint document (CP-N.md) MUST lead with durable evidence Parallix verifies today: exact test names, ADR references, test file paths, or recognized repository commands/paths such as `node --test test/task-2424-repro.test.ts`, `npm ...`, `git ...`, `px ...`, or `./scripts/verify-local.sh all`. File:line references are accepted when needed but discouraged because line numbers rot.

- At least one evidence row per success criterion using those durable forms.
- A summary of work done.
- The exact heading `## Goal Check`.
- The exact 3-column table header `| Criterion | Evidence | Status |`.
- Raw `stat`/`ls` output or generic prose alone is not enough; pair any shell output with an accepted command, path, exact test name, or ADR reference above.
- A non-generic `Next action:` line at the bottom.

Example Goal Check table:

| Criterion | Evidence | Status |
|---|---|---|
| Reproduction proves TUI lifecycle cleanup | `test/task-2424-repro.test.ts`, `node --test test/task-2424-repro.test.ts` | PASS |
| Existing TUI lifecycle contracts remain intact | `test/tui-headless-isolation.test.ts`, `test/task-2313-repro.test.ts` | PASS |
| Verification gate ran | `./scripts/verify-local.sh all` | PASS |

## Gates

- [ ] node --test test/task-2424-repro.test.ts
- [ ] ./scripts/verify-local.sh all

## Restricted Areas

- `src/composition/create-cli.ts` and `src/interfaces/cli/runtime.ts` — preserve lazy TUI loading and the no-command TTY policy.
- `src/interfaces/tui/board-layout.tsx` — do not alter responsive layout; its resize listener contract is a regression boundary only.
- `src/application/projections/board.ts` and persistence adapters — do not change the board data model or projection query semantics for a UI lifecycle leak.
- `src/adapters/agents/`, `src/adapters/review/`, and `src/adapters/sqlite/` — agent, review, and storage flows are not part of the demonstrated resource ownership chain.

## Stop Rules

- Stop before a production fix if CP 1 cannot fail on the mission parent commit; revise the reproduction to demonstrate a real retained Parallix resource rather than asserting a heap-size threshold.
- Stop and escalate if profiling/reproduction points to an unmodifiable dependency rather than a callback, timer, listener, or Ink lifecycle resource owned by this repository.
- Do not raise `--max-old-space-size`, add a restart loop, weaken the reproduction assertion, or turn off live projection refresh to mask the leak.
- Do not alter the polling interval or headless `px ui` behavior unless the red reproduction proves that exact behavior owns the retained resource.
