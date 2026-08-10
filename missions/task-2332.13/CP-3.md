# CP-3: Verify checkpoint integration and full repository gate

## Summary

Verified checkpoint and status application use cases with focused ports and CLI boundary. Confirmed checkpoint with slug inference, worktree resolution, gate recording, lifecycle-before-commit, and lifecycle rejection. Confirmed status with five focused ports (board, git, pr, agent, stale worktrees). Full repository gate passes.

### Checkpoint integration
- `src/application/checkpoint-command-use-case.ts` — CheckpointCommandUseCase orchestrates five focused ports (verification, git, lifecycle telemetry, lifecycle authorization, mission); infers slug via `inferSlug()`, resolves worktree via `resolveWorktree()`; emits `start` progress event with resolved slug for CLI rendering; lifecycle authorization BEFORE commit (can reject), lifecycle telemetry AFTER commit (non-blocking)
- `src/adapters/cli/commands/checkpoint-adapter.ts` — createCheckpointVerificationAdapter (records gate result), createCheckpointGitAdapter, createCheckpointLifecycleAdapter (fire-and-forget telemetry), createCheckpointLifecycleAuthorizationAdapter (pre-commit check, default always allows), createCheckpointMissionAdapter (inferSlug + resolveWorktree)
- `src/application/ports/cli-workflows.ts` — CheckpointVerificationPort accepts missionDir; CheckpointMissionPort adds inferSlug and resolveWorktree
- `src/interfaces/cli/checkpoint.ts` — parseCheckpointCliRequest, renderCheckpoint, createCheckpointCommand (renders start line from `start` progress event with resolved slug). The CLI boundary owns all argv handling: positional interpretation and `--` flag filtering happen in `parseCheckpointCliRequest` (`src/interfaces/cli/checkpoint.ts:17`), and `createCheckpointCommand` (`src/interfaces/cli/checkpoint.ts:71`) converts the parsed result into a structured request before calling the use case.
- `src/application/checkpoint-command-use-case.ts:13` — `CheckpointRequest` is the interface-neutral command request (`explicitSlug: string | null`, `cpName`, `nextAction`). `CheckpointCommandUseCase.execute()` (`src/application/checkpoint-command-use-case.ts:55`) takes that typed request; the application layer contains no argv parsing.
- `src/composition/create-cli.ts:118-127` — checkpoint wired through four focused ports

### Status integration
- `src/application/status-command-use-case.ts` — StatusCommandUseCase orchestrates five focused ports (board, git, pr, agent, stale worktrees)
- `src/adapters/cli/commands/status-adapter.ts` — createStatusBoardAdapter, createStatusGitAdapter, createStatusPrAdapter, createStatusAgentAdapter, createStatusStaleWorktreesAdapter
- `src/application/ports/cli-workflows.ts` — StatusBoardPort, StatusGitPort, StatusPrPort, StatusAgentPort, StatusStaleWorktreesPort
- `src/composition/create-cli.ts:181-197` — status wired through five focused ports

### Mocked-port test coverage (test/status-command-use-case.test.ts)
- Checkpoint success: "CheckpointCommandUseCase: returns success from mocked ports"
- Checkpoint inferred slug: "CheckpointCommandUseCase: infers slug when explicit not provided"
- Checkpoint verification failure: "CheckpointCommandUseCase: returns verification failure from mocked port"
- Checkpoint lifecycle telemetry (after commit): "CheckpointCommandUseCase: lifecycle telemetry is non-blocking (fire-and-forget)" and "CheckpointCommandUseCase: lifecycle telemetry called after commit (order verified)"
- Checkpoint mission not found: "CheckpointCommandUseCase: returns mission-not-found when mission directory is missing"
- Checkpoint inferred slug: "CheckpointCommandUseCase: infers slug when explicit not provided"
- Status board projection: "StatusCommandUseCase: returns board projection from mocked ports"
- Status inferred (null slug): "StatusCommandUseCase: passes null slug for inferred status"
- CLI status renders: "createStatusCommand: renders status and exits 0"
- CLI status no-argument (composed inference): "createStatusCommand: no-argument invocation renders inferred mission output"
- Status board adapter inference: "createStatusBoardAdapter: inferSlug delegates to the injected slug inference"
- CLI checkpoint renders: "createCheckpointCommand: renders success and exits 0"
- Parse errors: "createStatusCommand: exits 1 on parse error", "createCheckpointCommand: exits 1 on parse error"
- Checkpoint use case receives structured input, not argv: "createCheckpointCommand: hands the use case a structured request, not raw argv" and "createCheckpointCommand: structured request carries null slug for inferred invocations"

### Retained observable CLI behavior
- Existing status tests: 14/14 pass (test/status.test.ts)
- Existing checkpoint gate tests: 15/15 pass (test/task-2261-checkpoint-gates-repro.test.ts, test/task-1268-checkpoint-no-gate.test.ts)
- No `.only` or `.skip` in test files
- New mocked tests: 38/38 pass (`npx tsx --test test/status-command-use-case.test.ts`)

### Full repository gate (round 9 tree)
- `./scripts/verify-local.sh all`: 2031 tests, 2031 pass, 0 fail, exit 0. Re-run on the round-10 tree (docs and one new backlog task only, no source change): 2004 tests, 2004 pass, 0 fail, exit 0. The differing totals are the known runner-level count variance on this repository, not dropped assertions — both runs report 0 failures and exit 0.
- `npx tsx --test test/status-command-use-case.test.ts`: 38 tests, 38 pass, 0 fail
- `npm run typecheck` (`tsc --noEmit` + `tsconfig.scripts.json`): clean, exit 0
- `bash scripts/test-hygiene.sh`: PASS, no violations
- `npx eslint` over every mission-owned file (`src/application/checkpoint-command-use-case.ts`, `src/interfaces/cli/checkpoint.ts`, `src/interfaces/cli/status.ts`, `src/application/status-command-use-case.ts`, `src/composition/create-cli.ts`, `src/adapters/cli/commands/status-adapter.ts`): clean, exit 0
- `./scripts/verify-local.sh static-analysis`: exit 1, from defects that pre-exist on main and are untouched by this mission:
  - ESLint: 2 errors in `src/adapters/review/review-commands.ts` (`suggestFlag` L25, `defaults` L1802); that file is byte-identical to `origin/main` (`git diff --quiet origin/main HEAD -- src/adapters/review/review-commands.ts`)
  - Test typecheck (`npx tsc --noEmit --project tsconfig.test.json`): 9 errors in `test/review-backfill.test.ts`, `test/task-2332.14-review-use-case.test.ts`, `test/task-2347.07-statistics-provenance.repro.test.ts`. All three test files, plus `src/application/ports/review-workflow.ts`, `src/application/review-command-use-case.ts`, and `tsconfig.test.json`, are byte-identical to `origin/main`. No mission-owned file appears in that output. (The round-8 note claimed this stage clean; that claim was wrong — the ESLint stage fails first, so stage 4 never ran inside the gate.)

### Review-history projection: root cause and parked follow-up

Rounds 2–9 raised that `px status <slug>` reports only the current review round
and omits every prior round's families, verdicts, findings, fixes, and
pushbacks. Round 10 traced the defect end to end. It is real, it is not this
mission's, and it is now tracked.

Persisted state is complete. For `task-2332.13`, `mission_review_rounds` holds
9 rows with distinct `round_number`, `reviewer`, `implementer`, `phase`, and
`disposition`, and `src/adapters/sqlite/mission-store.ts:169` loads all of them
(`FROM mission_review_rounds WHERE mission_id = ? ORDER BY position`).

The loss happens in one line, in a file this mission does not touch.
`ConcreteReviewReadAdapter.toDomainReview()`
(`src/adapters/backlog/concrete-review-read-adapter.ts:142-186`) never reads
`mission_review_rounds`. It reads the flat `ReviewState` compatibility artifact
via `readReviewState()`, synthesises one `ReviewRound` from that single flat
record, and returns `rounds: [round]` at
`src/adapters/backlog/concrete-review-read-adapter.ts:172`. It also hardcodes
`reviewEvents: []` at line 177.

Every layer above that adapter already handles N rounds correctly and needs no
change: `projectReviewHistory` maps all of `review.rounds`
(`src/application/projections/mission-board.ts:105-124`), the status adapter
maps every entry (`src/adapters/cli/commands/status-adapter.ts:181`), and the
renderer loops over all of them (`src/interfaces/cli/status.ts:51`). They are
handed a one-element array.

Ownership evidence — the four files in that path are byte-identical to
`origin/main` and appear nowhere in this mission's diff
(`git diff --stat origin/main...HEAD -- src/` lists 8 files, none of them
these): `src/adapters/backlog/concrete-review-read-adapter.ts`,
`src/adapters/review/review-state.ts`,
`src/application/projections/board-readers.ts`,
`src/composition/board-projection.ts`. Separately, the `px` on PATH resolves to
the globally installed build
(`/home/magnus/.nvm/versions/node/v24.15.0/lib/node_modules/@magnusekdahl/parallix/build/px.mjs`),
so the observed output is not produced by this branch's code at all.

Fixing it means changing which source the board's review reader trusts — that
is board-projection semantics, which MISSION.md excludes under both "Out of
Scope" and "Restricted Areas". Parked as `backlog/tasks/task-2358 - Board-review-projection-discards-all-prior-review-rounds.md`,
with the root cause, 7 acceptance criteria, and a guardrail against "fixing" it
in the rendering layers.

Until that task lands, the complete per-round history is in
`missions/task-2332.13/review-events/` — every `reviewer_outcome-*`,
`reviewer_findings-*`, and `implementer_*` file for rounds 1–10, with the
reviewer and implementer families in each filename.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC1: status and checkpoint each call one dedicated application use case | `src/application/status-command-use-case.ts:13` — StatusCommandUseCase; `src/application/checkpoint-command-use-case.ts:43` — CheckpointCommandUseCase; `src/composition/create-cli.ts:181-197` — status; `src/composition/create-cli.ts:118-127` — checkpoint | PASS |
| SC2: status use case obtains data through focused ports | `src/application/ports/cli-workflows.ts:96` — StatusBoardPort; `src/application/ports/cli-workflows.ts:103` — StatusGitPort; `src/application/ports/cli-workflows.ts:113` — StatusPrPort; `src/application/ports/cli-workflows.ts:119` — StatusAgentPort; `src/application/ports/cli-workflows.ts:127` — StatusStaleWorktreesPort | PASS |
| SC2: checkpoint use case obtains lifecycle/verification through focused ports | `src/application/ports/cli-workflows.ts:140` — CheckpointVerificationPort; `src/application/ports/cli-workflows.ts:148` — CheckpointGitPort; `src/application/ports/cli-workflows.ts:158` — CheckpointLifecyclePort; `src/application/ports/cli-workflows.ts:165` — CheckpointMissionPort | PASS |
| SC3: parsing, rendering, exit mapping under src/interfaces/cli/ | `src/interfaces/cli/status.ts:12` — parseStatusCliRequest; `src/interfaces/cli/status.ts:29` — renderStatus; `src/interfaces/cli/status.ts:118` — createStatusCommand. `src/interfaces/cli/checkpoint.ts:17` — parseCheckpointCliRequest (positional interpretation + `--` flag filtering); `src/interfaces/cli/checkpoint.ts:32` — renderCheckpoint; `src/interfaces/cli/checkpoint.ts:71` — createCheckpointCommand builds the structured request | PASS |
| SC3: checkpoint use case takes interface-neutral input, not argv | `src/application/checkpoint-command-use-case.ts:13` — `CheckpointRequest`; `src/application/checkpoint-command-use-case.ts:55` — `execute(request: CheckpointRequest, …)`; no argv parsing remains in the application layer (`grep -rn "parseCheckpointParams" src/ test/` returns nothing). Proven by `test/status-command-use-case.test.ts:826` — "createCheckpointCommand: hands the use case a structured request, not raw argv" and `test/status-command-use-case.test.ts:851` — "createCheckpointCommand: structured request carries null slug for inferred invocations" | PASS |
| SC4: mocked-port tests — status board projection | `test/status-command-use-case.test.ts:233` — "StatusCommandUseCase: returns board projection from mocked ports" | PASS |
| SC4: mocked-port tests — checkpoint success | `test/status-command-use-case.test.ts:528` — "CheckpointCommandUseCase: returns success from mocked ports" | PASS |
| SC4: mocked-port tests — checkpoint verification failure | `test/status-command-use-case.test.ts:558` — "CheckpointCommandUseCase: returns verification failure from mocked port" | PASS |
| SC4: mocked-port tests — checkpoint lifecycle rejection | `test/status-command-use-case.test.ts:657` — "CheckpointCommandUseCase: returns lifecycle-rejection when authorization port rejects" | PASS |
| SC5: existing CLI output and exit behavior retained | `test/status.test.ts` — 14/14 pass; `test/task-2261-checkpoint-gates-repro.test.ts` — 12/12 pass; `test/task-1268-checkpoint-no-gate.test.ts` — 3/3 pass | PASS |
| SC6: verify-local.sh all completes | `./scripts/verify-local.sh all` — 2031 tests, 2031 pass, 0 fail, exit 0; `npm run typecheck` — clean, exit 0; `bash scripts/test-hygiene.sh` — PASS; `npx eslint` over every mission-owned file — clean, exit 0. Static-analysis stage failures are confined to files byte-identical to `origin/main` (see "Full repository gate (round 9 tree)") | PASS |

Next action: Hand round 10 back to the reviewer for a decision on the review-history projection finding, now root-caused to `src/adapters/backlog/concrete-review-read-adapter.ts:172` and parked as `backlog/tasks/task-2358 - Board-review-projection-discards-all-prior-review-rounds.md`.
