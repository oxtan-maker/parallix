# CP-1: Reproduction test for unavailable board projection data

## Summary

Authored `test/task-2343-board-projection-repro.test.ts` before any production
change. The test composes the production `BoardProjectionBuilder` from the real
concrete read adapters (`ConcreteMissionReadAdapter`,
`ConcreteReviewReadAdapter`, `ConcreteGateReadAdapter`,
`ConcreteAgentReadAdapter`, `ConcreteOperationLogReadAdapter`,
`ConcreteMetricsReadAdapter`) over deterministic fixtures:

- a real temporary mission directory holding `CP-1.md` and `CP-2.md`, where
  `CP-2.md` carries a `## Goal Check` table with two rows and a
  `Next action:` line;
- an injected review state in the `approved` phase carrying a typed Forgejo
  pull-request reference (`provider: forgejo`, `id: 4242`);
- in-memory doubles for the existing `AgentBlocklistRepository`,
  `BoardLaneEventRepository`, `OperationalHistoryRepository` and
  `UsageRepository` ports, seeded with a usage-limit block, two lane
  transitions and one operation event.

No Forgejo access, no agent launch, no `git` invocation, no new port and no new
table.

At this commit's parent tree four projection fields are red and the three read
paths that were already correct are green — pinned so the CP-2/CP-3 repairs
cannot regress them:

| Test | Result at parent |
|---|---|
| `task-2343 repro: card projects the Forgejo PR number from the review round` | RED — `pullRequest` is `null` |
| `task-2343 repro: card projects the checkpoint Next action line` | RED — `nextActionText` is `''` |
| `task-2343 repro: mission adapter parses the checkpoint Goal Check table` | RED — `goalCheck.length` is `0`, expected `2` |
| `task-2343 repro: gate status comes from the recorded verifier exit code` | RED — no gate-result recorder exists |
| `task-2343 repro: agent availability reflects the recorded usage-limit block` | GREEN |
| `task-2343 repro: cycle-time series is populated from recorded lane events` | GREEN |
| `task-2343 repro: operation log returns the recorded lifecycle events` | GREEN |

Reproduce with `npx tsx --test test/task-2343-board-projection-repro.test.ts`.

This checkpoint advances SC1–SC7 by establishing the falsifiable evidence
harness; no success criterion is satisfied yet.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC1: reproduction proves the PR reference does not reach the card | `src/application/projections/mission-board.ts:179`, test `"task-2343 repro: card projects the Forgejo PR number from the review round"` | RED (expected) |
| SC2: reproduction proves `Next action:` and `## Goal Check` are not parsed | `src/adapters/backlog/concrete-mission-read-adapter.ts:289`, test `"task-2343 repro: mission adapter parses the checkpoint Goal Check table"` | RED (expected) |
| SC3: reproduction proves gate status is unconditionally `unknown` | `src/adapters/backlog/concrete-gate-read-adapter.ts:56`, test `"task-2343 repro: gate status comes from the recorded verifier exit code"` | RED (expected) |
| SC4: agent-availability read path pinned against the blocklist port | `src/adapters/backlog/concrete-agent-read-adapter.ts:72`, test `"task-2343 repro: agent availability reflects the recorded usage-limit block"` | PASS |
| SC5: cycle-time read path pinned against `board_lane_events` rows | `src/application/projections/metrics-read-adapter.ts:82`, test `"task-2343 repro: cycle-time series is populated from recorded lane events"` | PASS |
| SC6: operation-log read path pinned against `operational_history` rows | `src/adapters/backlog/concrete-operation-log-read-adapter.ts:30`, test `"task-2343 repro: operation log returns the recorded lifecycle events"` | PASS |
| SC7: no `BoardProjection`/`MissionCard`/port shape changed | `src/application/projections/board-readers.ts:22`, `src/application/projections/mission-board.ts:47` unchanged; the test imports existing ports only | PASS |
| SC8: the test is hermetic and carries no `.only`/bare `.skip` | `test/task-2343-board-projection-repro.test.ts`, `./scripts/verify-local.sh all` deferred to CP-4 | PENDING |

Next action: Repair `ConcreteMissionReadAdapter` checkpoint materialization, record the verifier exit code from `px checkpoint`, and carry the confirmed pull request onto the review round, then rerun `npx tsx --test test/task-2343-board-projection-repro.test.ts`.
