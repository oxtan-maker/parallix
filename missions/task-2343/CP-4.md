# CP-4: Verification and final evidence for SC1–SC8

## Summary

Ran the mission's declared gate on the final tree and recorded the SC1–SC8
evidence. This checkpoint also completes the documentation obligation:
`docs/tui-board.md` gains a "Where each fact comes from" table naming the source
and the lifecycle step behind every card field, plus the statement that missions
predating this change are not backfilled; `CHANGELOG.md` records the fix under
`[Unreleased] / ### Fixed`.

### What changed

- `src/adapters/backlog/concrete-mission-read-adapter.ts` — checkpoints are
  materialised through the existing `checkpoint-document` compatibility parser
  instead of being stubbed with `[]` / `''`.
- `src/adapters/verification/verification.ts` — `recordGateResult()` writes the
  verifier exit code to `<mission>/.workflow/gate-result.json`.
- `src/adapters/cli/commands/checkpoint.ts` — records the gate result for a
  passing and a failing run, and records its own operation after the commit.
- `src/adapters/backlog/concrete-gate-read-adapter.ts` — reads the recorded
  exit code in preference to the pre-existing text heuristic.
- `src/adapters/review/review-state.ts`, `review-state-mapping.ts`,
  `review-loop.ts` — the confirmed pull request is a typed
  `PullRequestReference` on the round's reviewed change, not a `metadata` key.
- `src/adapters/backlog/concrete-review-read-adapter.ts` — one
  `reviewedChangeFrom()` helper serves `loadReview` and `loadReviewApproval`.
- `src/application/recording/operation-event-recorder.ts` (new) — the
  `operational_history` write side, with no database of its own.
- `src/adapters/backlog/backlog.ts` — the lane event and the operation entry
  commit in one transaction; `recordLifecycleOperation()` serves the lifecycle
  step that changes no lane.
- `src/application/consumer-domain-requirements.ts`,
  `persistence-domain-map.ts` — three citation line numbers moved with the
  edits above; no citation target changed.
- `test/task-2322-05-cli-characterization.test.ts` — the two `px checkpoint`
  characterization tests now await the command. The pinned behavior is
  unchanged: same gate/stage/commit order, same failure exit before any Git
  effect.

No `BoardProjection` field, `MissionCard` field, read-adapter interface, SQLite
table or migration changed, and no file under `src/interfaces/tui/` was touched.

### Verification

`./scripts/verify-local.sh all` → exit 0, 0 failures, 0 skipped, across three
consecutive runs. The reported total drifts between runs on this repository
(1699 / 1724 / 1743 tests over runs of 49 / 41 / 49 suites) — a known property of
the default suite selection, not of this change. All 18 tests added by this
mission execute inside the gate in every run
(`./scripts/verify-local.sh all | grep -c '^✔ task-2343 repro'` and the
lifecycle-persistence test names). `./scripts/verify-local.sh static-analysis`
→ all four stages pass (ESLint, `tsc`, test-hygiene, test typecheck).

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC1: a review with a Forgejo PR reference yields a non-null card `pullRequest` carrying its PR number | `src/adapters/backlog/concrete-review-read-adapter.ts:47`, `src/application/projections/mission-board.ts:179`, test `"task-2343 repro: card projects the Forgejo PR number from the review round"` | PASS |
| SC1: `test/domain-projections.test.ts` still covers the projection policy | `test/domain-projections.test.ts`, `./scripts/verify-local.sh all` | PASS |
| SC2: the latest checkpoint's `Next action:` text and `## Goal Check` rows reach `checkpoint.nextActionText` and `checkpoint.goalCheck` | `src/adapters/backlog/concrete-mission-read-adapter.ts:312`, `src/adapters/backlog/checkpoint-document.ts:36`, tests `"task-2343 repro: card projects the checkpoint Next action line"` and `"task-2343 repro: mission adapter parses the checkpoint Goal Check table"` | PASS |
| SC3: gate evidence yields `passed`, `failed` or `unknown` from the existing union, not an unconditional `unknown` | `src/adapters/verification/verification.ts:211`, `src/adapters/backlog/concrete-gate-read-adapter.ts:101`, test `"task-2343 repro: gate status comes from the recorded verifier exit code"` | PASS |
| SC3: the gate status is the verifier exit code, never agent prose (ADR 0048 class 1) | ADR 0048 failure class 1, test `"ConcreteGateReadAdapter reads the recorded exit code in preference to prose"` | PASS |
| SC4: a usage-limit block persists to `agent_blocklist` and projects `available`/`blockedForMs` agreeing with the stored record | `src/adapters/backlog/concrete-agent-read-adapter.ts:72`, test `"task-2343 repro: agent availability reflects the recorded usage-limit block"` | PASS (pre-existing, pinned by CP-1) |
| SC5: lane transitions persist to `board_lane_events` and yield non-null `medianCycleTimeByState.series` values | `src/adapters/backlog/backlog.ts:719`, `src/application/projections/metrics-read-adapter.ts:82`, test `"task-2343 repro: cycle-time series is populated from recorded lane events"` | PASS (pre-existing, pinned by CP-1) |
| SC6: lifecycle operation events persist to `operational_history` and `ConcreteOperationLogReadAdapter` returns them | `src/application/recording/operation-event-recorder.ts:58`, `src/adapters/backlog/concrete-operation-log-read-adapter.ts:30`, test `"recorded lifecycle events reach operational_history and the operation-log adapter"` | PASS |
| SC6: all four lifecycle commands record an operation | `src/adapters/backlog/backlog.ts:795` (`px active`, `px review`, `px integrate` via the single transition seam), `src/adapters/cli/commands/checkpoint.ts:89` (`px checkpoint`), test `"a lifecycle operation that changes no lane still records its own entry"` | PASS |
| SC6: the operation row and its lane row commit as one unit | `src/adapters/backlog/backlog.ts:795`, ADR 0053 transaction rule 1 | PASS |
| SC7: only existing adapter interfaces and existing SQLite tables are used; no `BoardProjection` or `MissionCard` shape change | `src/application/projections/board-readers.ts:22`, `src/application/projections/mission-board.ts:47`, `src/application/ports/operation-history.ts:8` unchanged; no migration file added; `npx tsc --noEmit` clean | PASS |
| SC8: the declared gate exits successfully on the final tree | `./scripts/verify-local.sh all` → exit 0, 0 failures, 0 skipped | PASS |
| SC8: no focused or bare skipped tests introduced | `grep -cE "\.only\(\|\.skip\(" test/task-2343-*.test.ts` returns 0 for both files; the gate reports `skipped 0` | PASS |
| DoD: bug-labeled mission has a red-to-green reproduction test | `test/task-2343-board-projection-repro.test.ts` — 4 assertions red at the CP-1 parent (see `missions/task-2343/CP-1.md`), all 7 green now via `npx tsx --test test/task-2343-board-projection-repro.test.ts` | PASS |
| DoD: docs reflect the user-facing behavior change | `docs/tui-board.md`, `CHANGELOG.md` `[Unreleased]` → `### Fixed` | PASS |

Next action: Hand this mission off for review with `px review task-2343 --submit`; the reviewer should start at `src/adapters/backlog/backlog.ts:795` to confirm the lane event and the operation entry commit as one transaction.
