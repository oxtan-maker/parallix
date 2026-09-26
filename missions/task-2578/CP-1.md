# CP-1: Restore fans; hide unidentified agent labels

The original request was to hide the blinking "no implementer" display.
TASK-2576 retained that display and changed fan rotation to require a named
agent and an observed coordinator. Restore the earlier fan rule and hide the
agent label and its dot when the identity is absent. Existing gate-progress
fixes are retained.

## Regression evidence

For the same card (live work, null agent, stopped coordinator), the fan predicate
returns true at `5747d40fc` and `4b7e6796b^`, false at `4b7e6796b`, and true after
restoration. `git log 5747d40fc..4b7e6796b -- web/src/format.ts` contains only
`4b7e6796b`: TASK-2576, recorded assignee Codex. Its Git author is Magnus Ekdahl;
that author field is not the agent identity.

The restored `web/src/format.ts` has Git blob
`7ac100ddf29d80c686d8d6ff3275f6cc1d7415a3`, identical to `4b7e6796b^`.
The "no implementer" fallback was introduced by `338214676` (TASK-2434) and
was still unconditional after TASK-2576. It is now omitted with its dot.

Before restoration, "an unidentified agent omits the implementer label and its
activity dot" failed on the retained label, and "fans retain the pre-TASK-2576
work behavior independently of agent identity and coordinator scans" failed
because live unnamed work did not spin. Both now pass.

## Goal Check

| Requirement | Evidence | Result |
|---|---|---|
| Restore earlier fan behavior | `web/src/format.ts:79`; `test/web-board-render.test.ts:375`, "fans retain the pre-TASK-2576 work behavior independently of agent identity and coordinator scans" | PASS |
| Hide unidentified agent label and dot | `web/src/flight-column.tsx:124`; `test/web-board-render.test.ts:322`, "an unidentified agent omits the implementer label and its activity dot" | PASS |
| Retain identified agents and reduced motion | `test/web-board-render.test.ts:353`, "activity, coordinator recovery evidence, and reduced motion stay truthful"; `test/task-2576-agent-activity-repro.test.ts:28` | PASS |
| Do not substitute the assignee for an unidentified running agent | `test/task-2498-review-null-agent-board.test.ts:37`, "a working card with an unidentified agent omits its label and dot, never the assignee family" | PASS |
| Static analysis, docs, build, changed-test headroom | Final verification results below | PASS |

## Final verification

- `./scripts/verify-local.sh static-analysis`: all four stages passed; output
  captured in `/tmp/task-2578-static-analysis.log`.
- `./scripts/verify-local.sh docs`, `npm run build`, and `git diff --check`: passed.
- Focused headroom run of `web-board-render.test.ts`, `task-2453-repro.test.ts`,
  `task-2498-review-null-agent-board.test.ts`, and
  `task-2576-agent-activity-repro.test.ts`: 52 passed, zero timing violations;
  captured in `/tmp/task-2578-focused-headroom.log`.
- Full `npm test -- --unit-test-headroom`: 3,011 assertions passed, none failed.
  The command exited 1 because two unchanged tests exceeded 500 ms during the
  full run: the pre-integration failure test (534 ms) and TUI keyboard-help test
  (589 ms). Output: `/tmp/task-2578-unit-headroom-final.log`.
- Isolated headroom checks: `task-1039-integrate.test.ts` passed (10 tests);
  `tui-wave-3-component.test.ts` passed its four assertions but still exceeded
  headroom on keyboard help (514 ms). That unchanged TUI timing issue remains;
  no timeout or test-selection policy was weakened.
- `graphify update .`: completed. No gate runner, agent launch, or persisted
  activity model was changed in this restoration.
