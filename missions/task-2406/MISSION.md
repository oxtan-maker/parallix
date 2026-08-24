# Mission: px draft is not detected in ui (task-2406)

## Goal
Make `px draft` publish operational current work so the Parallix UI/board detects a drafted mission as being worked right now, exactly like `px review`, `px integrate`, and the execute service already do.

Concretely: the `DraftCommandUseCase` workflow must write a `mission.current-work` event (`state: running`, `phase: execute`) when the draft agent is launched, a `blocked` event when the draft operation throws, and an `ended` event on normal completion. The board/TUI already reconciles those events (`reconcileCurrentWork`) into a `LiveMissionWork` fact and surfaces it; once draft publishes, the same path makes a live draft mission appear as active in the UI.

Reproduction-Test: test/task-2406-draft-current-work.test.ts

This mission also includes the adjacent execute ownership fix discovered during
activation: CLI `px active` must wait for its agent and complete checkpoint
continuation and handoff, while interactive board dispatch remains
fire-and-forget.

## Why Now
`px draft` launches a long-running agent that works a mission for minutes to hours, but the command never writes a current-work event. Every other long-running operation does:

- `src/application/review-command-use-case.ts` brackets each review operation with `currentWork.running` / `blocked` / `ended`.
- `src/application/integrate-command-use-case.ts` brackets integrate with `currentWork.running` / `ended`.
- `src/application/execute-mission-service.ts` publishes through the same `CurrentWorkPort`.

The board reads current work via `src/application/projections/current-work.ts` (`reconcileCurrentWork`, `isWorkInProgress`) into `src/application/projections/mission-board.ts` (`LiveMissionWork`) and the board controller (`src/application/controller/board-controller.ts`). Because draft publishes nothing, an operator opening `px ui`/`px active` sees the mission as idle/unverified even though an agent is mid-draft. This is a regression in observability parity: the write side (`CurrentWorkRecorder`, ADR 0053) and the read side exist and are consumed by every sibling command; draft is the only long-running command that skips the seam.

## Refinement Signals
- Predicted NEL bucket: Small (0–80)
- Confidence: High
- Selection note: activate as-is
- Main drivers: single-application-layer gap (draft skips the current-work seam that every sibling command uses); read/write infra and composition wiring already exist and are reused unchanged; behavior is observable and unit-testable without a real agent launch.

## Scope
- Add an optional `CurrentWorkPort` to `DraftCommandUseCase` (`src/application/draft-command-use-case.ts`), defaulting to `NO_CURRENT_WORK_PORT`, mirroring `ReviewCommandUseCase`.
- Bracket the draft workflow with `currentWork.running` before the workflow runs, `currentWork.blocked(publication, reason)` if `execute` throws, and `currentWork.ended(publication)` on normal completion. Phase is `execute` (the board's operator-facing phase for an agent working the mission); `operationId` is `draft:<slug>:<uuid>`; `summary` is the draft invocation string; `agent` is derived from the resolved slug via `currentWorkPublication`.
- Resolve the mission slug from the draft context (`ctx.slug`) to build the publication, using `missionId`/`currentWorkPublication` so an unparseable slug publishes nothing instead of throwing.
- Wire the production `currentWork` port into the draft use case in `src/composition/create-cli.ts` (`draft:` command, currently `new DraftCommandUseCase(adapter)` with no port), reusing the same `services.currentWork` that review/integrate use.
- Preserve the existing `DraftCommandUseCase` single-argument construction used by `test/draft-command-use-case.test.ts` via the default parameter — no signature change that breaks existing callers.
- Add focused mocked-port unit tests (fast, no real agent, no CLI subprocess).
- Preserve CLI execute ownership: `px active` dispatches an attached launch;
  board/TUI dispatch keeps its detached default.
- Add a focused regression assertion covering attached CLI dispatch and detached
  board dispatch.

## Out of Scope
- Any change to the current-work write side (`src/application/recording/current-work-recorder.ts`), the read/reconciliation side (`src/application/projections/current-work.ts`, `mission-board.ts`), or ADR 0053.
- Adding new `CurrentWorkPhase` values beyond reusing `execute`.
- Changes to `px review`, `px integrate`, or `execute-mission-service` publication behavior.
- UI/TUI rendering changes — the board already renders `LiveMissionWork`; this only feeds the existing path.
- Persisting draft stats or label sync beyond what the existing workflow already does.

## Success Criteria
> **Falsifiability rule (ADR 0039 Part 2):** Each criterion is falsifiable; no unattached subjective adjectives or vague quantifiers.

1. `DraftCommandUseCase` accepts a second constructor parameter `currentWork: CurrentWorkPort` that defaults to `NO_CURRENT_WORK_PORT`, and `test/draft-command-use-case.test.ts` still passes unchanged (all 9 existing sequence/exit assertions hold).
2. When `DraftCommandUseCase.execute` runs a normal draft (all ports return a non-exited context), the injected `currentWork` receives exactly one `running` call with `phase === 'execute'` before the first workflow port call, and exactly one `ended` call after `finalTransition`.
3. When the draft workflow `execute` throws, the injected `currentWork` receives a `blocked` call carrying the error reason, and the error is re-thrown.
4. When the draft slug is unparseable, `currentWorkPublication` returns null and no `running`/`blocked`/`ended` call is made and the command still behaves as before (no throw from the publication layer).
5. The production composition (`src/composition/create-cli.ts`) constructs `DraftCommandUseCase` with the real `services.currentWork` port, so a live `px draft <slug>` writes a `mission.current-work` row that `reconcileCurrentWork` resolves to `LiveMissionWork` with `freshness !== 'stale'`.
6. No focused or unannotated skipped tests are introduced (no `.only`, no bare `.skip`), and `./scripts/verify-local.sh all` passes on the final tree.
7. CLI `px active` does not return its prompt while the execute agent is still
   running, and the board/TUI fire-and-forget behavior remains unchanged; the
   focused controller regression test verifies both dispatch modes.

## Risks and Assumptions
- **Publication must never fail the draft.** Publication is best-effort; wrap every `currentWork.*` call in `bestEffort` (as review does) so a recorder outage cannot abort a draft. Assumption: the operational-history write is already resilient (ADR 0053).
- **`operationId` correlation.** Reconciliation only accepts a terminal event from the operation that owns standing work. Draft's `ended`/`blocked` must use a single per-invocation `operationId` so the `ended` clears the draft's own `running` and cannot blank an overlapping operation.
- **Slug availability.** `ctx.slug` must be populated at the point of publication (after `preflight`). Assumption: it is, since the workflow already uses it; if publication happens before the slug is resolved, guard with `currentWorkPublication` which returns null for an unparseable slug.
- **Test isolation.** Unit tests must use a fake `CurrentWorkPort` capturing calls; do not construct a real `CurrentWorkRecorder`/SQLite or spawn the draft CLI adapter, or tests will touch real git/sqlite.
- **Reconciliation TTL.** A draft `running` fact left by a killed process ages out after `CURRENT_WORK_TTL_MS` (5 min) as `stale`, matching every sibling command — no new behavior here.

## Checkpoints
- CP 1: Reproduction test written and failing (red) — locks the bug before any fix.
- CP 2: Fix implemented — `DraftCommandUseCase` publishes current work;
  composition wired; CLI execute launch ownership corrected.
- CP 3: Focused mocked-port tests green; full `./scripts/verify-local.sh all` gate green; Goal Check table populated with durable evidence.

### Checkpoint Documentation Requirements
Every checkpoint document (CP-N.md) MUST include:
- A summary of work done
- A `## Goal Check` section
- A 3-column pipe-delimited markdown table with columns: Criterion | Evidence | Status
- At least one evidence row per criterion using durable, verifiable references. Parallix already accepts:
  1. **Recognized repo commands or paths** — e.g., `` `npm test -- test/draft-command-use-case.test.ts` ``, `` `./scripts/verify-local.sh all` ``, or `` `node --test` `` against the test file
  2. **Test names** — e.g., the exact `test('...')` title in `test/draft-command-use-case.test.ts` and the new reproduction test title (must match a test name in the repo)
  3. **Test file paths** — e.g., `test/draft-command-use-case.test.ts`, `test/task-2406-draft-current-work.test.ts` (must be an existing test file)
  4. **ADR references** — e.g., `ADR 0053` (must correspond to an existing file under `docs/adr/0053-operational-persistence-and-authority-boundaries.md`)
  5. **File:line references** — accepted when needed, but line numbers eventually rot; prefer the forms above
- Raw `stat`/`ls` output or generic prose may appear as supplemental context, but pair them with one of the accepted references above. Weak-agent failure mode: a block of bare `node --test` stdout, a copy-pasted `ls test/` listing, or a paragraph saying "the test passes" is NOT sufficient evidence on its own. Every claim of green MUST be paired with one accepted reference above — quote the exact passing test title and the exact command that produced the pass (for example: `| Draft publishes running/ended | test/task-2406-draft-current-work.test.ts, "DraftCommandUseCase publishes running then ended current work", `npm test -- test/task-2406-draft-current-work.test.ts``).
- A non-generic `Next action:` line at the bottom

Example Goal Check table:

| Criterion | Evidence | Status |
|---|---|---|
| DraftCommandUseCase publishes current work (running/blocked/ended) | `test/task-2406-draft-current-work.test.ts`, `"draft publishes running with phase execute before workflow and ended after finalTransition"`, `npm test -- test/task-2406-draft-current-work.test.ts` | PASS |
| Existing draft use-case sequencing unchanged | `test/draft-command-use-case.test.ts`, `DraftCommandUseCase.execute sequences all port methods in normal flow`, `npm test -- test/draft-command-use-case.test.ts` | PASS |
| Production composition wires real currentWork port | `src/composition/create-cli.ts` draft command passes `services.currentWork` | PASS |
| Verification gate ran | `./scripts/verify-local.sh all` | PASS |

## Gates
- [ ] ./scripts/verify-local.sh all

## Restricted Areas
- Do not modify the current-work write side (`src/application/recording/current-work-recorder.ts`), the reconciliation/read side (`src/application/projections/current-work.ts`, `src/application/projections/mission-board.ts`), or ADR 0053.
- Do not change `CurrentWorkPhase` values or the board's reconciliation/expiry semantics.
- Do not alter `px review`, `px integrate`, or `execute-mission-service` publication logic.
- Do not change the `DraftCommandUseCase` single-argument construction contract used by existing tests except by adding a defaulted second parameter.
- Do not touch the `assignee` field of the backlog task.

## Stop Rules
- Stop after the three checkpoints: failing repro test (red), fix + focused tests (green), and a clean `./scripts/verify-local.sh all`.
- Do not implement during the draft phase — this document is the only draft output besides the backlog label update.
- Do not add new dependencies, phases, or UI rendering; if the fix appears to require more than the current-work seam, pause and re-scope.
- Do not run the test suite beyond the single `./scripts/verify-local.sh all` gate for verification.
- Do not push the mission branch to `origin`; only `main` goes to `origin`.
