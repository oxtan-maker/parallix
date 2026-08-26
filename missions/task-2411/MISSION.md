# Mission: ensure px UI detects active integration work (task-2411)

## Goal
Make the `px` board (TUI + `px status` projection) treat a mission that is
being actively integrated as **working** rather than **NEEDS YOU**. While
`npm run dev -- integrate` (the `px integrate` command) is running, the
integration-lane mission must not be surfaced as an attention item
(`integrate-lane` / "Awaiting integration") and must project as
`isWorkInProgress === true`.

The board already knows how to *suppress* the attention item when a fresh
`integrate`-phase current-work fact exists (`agentIsWorking` → `none` in
`src/application/projections/board.ts`). This mission closes the gap between
the running `px integrate` operation and that detection seam so the fact the
operation publishes actually reaches the board as *in-progress* work for the
whole duration of the run.

## Why Now
The operator runs `px integrate` by hand after approval. Every time they do,
the board flickers the mission into the attention rail as "need my help" even
though the agent/merge/gates are already running it. That is a false
human-in-the-loop prompt on a workflow that is already progressing, which
erodes trust in the board and pokes the operator mid-integration. The
underlying current-work authority (ADR 0053) and the `integrate` current-work
phase already exist; the detection of that phase while the run is live is what
is incomplete.

## Refinement Signals
- Predicted NEL bucket: Medium (81–235)
- Confidence: High
- Selection note: activate as-is
- Main drivers: operator-reported false NEEDS YOU on the integration lane; the
  `integrate` current-work phase and board suppression logic already exist, so
  the fix is the publish→detect seam, not a new subsystem.

## Scope
- The `px integrate` command path (`src/adapters/cli/commands/integrate.ts`
  invoked via `src/composition/create-cli.ts` → `IntegrateCommandUseCase`
  `src/application/integrate-command-use-case.ts`).
- The current-work publication side: the `integrate` phase fact published to
  the operational-history authority (`src/application/recording/current-work-
  recorder.ts`, `CurrentWorkPort.running/ended`, `currentWorkPublication`).
- The board detection side: `src/application/projections/current-work.ts`
  (`reconcileCurrentWork`, `runningFreshness`, `isWorkInProgress`) and
  `src/application/projections/board.ts` (`attentionReason`,
  `attentionRank`, `buildBoardProjection`) and the TUI filter in
  `src/interfaces/tui/shell.tsx` (`reason.kind !== 'none'`).
- The process-liveness seam `src/adapters/process/process-liveness.ts`
  (`processLivenessProbe`) only insofar as it decides whether a published
  `integrate` fact is `live` / `unverified` (both count as working) versus
  `stale` / cleared.
- Focused tests under `test/` for the publish and the board detection.

## Out of Scope
- Changing the mission lifecycle model (`MissionStatus`, the
  `integration` lane entry/exit, `decideMission` in `src/domain/mission-
  workflow.ts`). Integration still transitions `integration → done` via
  `decideIntegration` in `src/adapters/cli/commands/integrate-post.ts`.
- Adding a new current-work phase or a second current-work authority.
- Reworking the board metrics, flow, or agent-availability projections.
- Any change to the `execute` / `handoff` / `review` publication paths beyond
  the shared `integrate` phase.
- UI cosmetics: only the attention-suppression behavior changes, not card
  layout or colors.

## Success Criteria
> **Falsifiability rule (ADR 0039 Part 2):** each criterion below is
> falsifiable; no subjective adjectives or vague quantifiers.

- SC1: An integration-lane mission with a fresh (`live` or `unverified`)
  `integrate`-phase current-work fact projects `isWorkInProgress === true` and
  `attentionReason(card).kind === 'none'` through `buildBoardProjection`.
  Falsified if the board returns `integrate-lane` while a fresh integrate fact
  exists.
- SC2: A `px integrate` run publishes a `running` `integrate` fact before the
  merge/gates begin and an `ended` fact after it finishes, to the
  operational-history authority only (no mission write, no lane event, no
  session marker), exactly as the `execute`/`review` paths do. Falsified if a
  run publishes zero integrate facts or writes a non-current-work authority.
- SC3: A published `integrate` fact whose liveness probe returns `null`
  (unverifiable) still projects as working; only a probe `false` (process
  observed dead) or an age past `CURRENT_WORK_TTL_MS` clears it. Falsified if
  an `unverified` integrate fact surfaces as NEEDS YOU.
- SC4: The TUI `shell.tsx` attention rail no longer lists the running
  integration mission while SC1 holds (the `reason.kind !== 'none'` filter
  excludes it). Falsified if a running integration mission appears in the
  filtered queue.
- SC5: Every operation that keeps the board busy (execute, handoff, review,
  review-response, integrate) still publishes its own phase; the integration
  phase is present alongside the existing five. Falsified if adding integrate
  removes or renames another phase.
- SC6: No focused or unannotated skipped tests (`no .only`, no bare `.skip`)
  and static analysis (ESLint + `tsc --checkJs`) reports clean on every
  changed file. Falsified by a lint/type error or a skipped test in the
  changed surface.

## Risks and Assumptions
- The board treats a `running` fact as authoritative; a `px` process killed
  mid-integration leaves a stale `running` fact. Reconciliation
  (`CURRENT_WORK_TTL_MS`, `processLivenessProbe`) bounds this — assume the
  liveness probe returns `null` on this workstation (unverifiable → still
  working) rather than `false`.
- `processIdentity` may be absent on non-Linux / legacy rows; the bare-pid
  reconciliation then ages the fact. Assume Linux CI with an identity; do not
  weaken the pid-reuse guard to force green.
- Publication is best-effort (`bestEffort` swallows recorder errors); a
  recorder outage must not fail the integrate command. Assume the recorder
  port is the real `CurrentWorkRecorder` in production and a no-op in tests.
- Assumption under test: the defect is the publish→detect seam (missing,
  mistimed, or mis-phased integration publication, or a probe that clears the
  fact early). The implementer must reproduce the symptom live first rather
  than assume which half is at fault.

## Checkpoints
- CP 1 (red): author the failing reproduction test that locks the bug before
  any fix; run it red at the mission parent commit and record the failure.
- CP 2 (green): make the `px integrate` run publish a detectable `integrate`
  current-work fact (or repair the detection seam) so the board reports the
  running mission as working; run the reproduction green.
- CP 3 (gate): run the integration gate plan and capture proof; update docs if
  user-visible behavior changed.

### Checkpoint Documentation Requirements
Every checkpoint document (CP-N.md) MUST include:
- A summary of work done
- A `## Goal Check` section
- A 3-column pipe-delimited markdown table with columns: Criterion | Evidence | Status
- At least one evidence row per criterion using durable, verifiable references. Parallix already accepts:
  1. **Recognized repo commands or paths** — e.g., `` `npm test -- test/task-2411-integrate-work-detection.test.ts` ``, `` `px status --json` ``, `` `./scripts/verify-local.sh static-analysis` ``, or `` `node --test test/...` ``
  2. **Test names** — must match a test name in the repo, e.g. the reproduction test's own `test(...)` title
  3. **Test file paths** — e.g., `test/task-2411-integrate-work-detection.test.ts` (must be an existing test file)
  4. **ADR references** — e.g., `ADR 0053` (must correspond to an existing file under `docs/adr/`)
  5. **File:line references** — accepted when needed, but line numbers eventually rot; prefer the forms above
- Raw `stat`/`ls` output or generic prose may appear as supplemental context, but pair them with one of the accepted references above. Raw output alone is NOT enough: a weak agent that pastes `ls test/` or `grep` output without attaching an accepted reference (a test name, a test file path, an ADR, or a runnable repo command) fails the checkpoint. Example of the failure mode: "asserted the repro is red" with only a copy-pasted `node --test` trace and no test name or file path is rejected; pair the trace with `test/task-2411-integrate-work-detection.test.ts` and the exact failing `test()` title.
- A non-generic `Next action:` line at the bottom

Example Goal Check table:

| Criterion | Evidence | Status |
|---|---|---|
| Draft prompt defines checkpoint evidence rules | `prompts/draft.md` | PASS |
| Repro test locks the integration-detection bug | `test/task-2411-integrate-work-detection.test.ts`, `"running integrate projects as working, not integrate-lane"` | PASS |
| Verification gate ran | `./scripts/verify-local.sh static-analysis` | PASS |

## Gates
- [ ] ./scripts/verify-local.sh all

## Restricted Areas
- Do not modify the mission lifecycle model or the `integration` lane
  transitions (`src/domain/mission.ts`, `src/domain/mission-workflow.ts`).
- Do not add a second current-work authority or a new current-work phase
  beyond `integrate`; reuse `src/application/recording/current-work-recorder.ts`.
- Do not touch the `execute` / `handoff` / `review` publication implementations
  except to mirror their existing pattern for the `integrate` phase.
- Do not alter board metrics, flow projections, or agent availability.
- Do not add dependencies or new public APIs beyond the existing
  `CurrentWorkPort` / `CurrentWorkPhase` surface.

## Stop Rules
- Stop if the symptom cannot be reproduced at the unit level: re-read
  `src/application/projections/board.ts:attentionReason` and
  `src/application/projections/current-work.ts` first; if a fresh integrate
  fact already suppresses attention, the defect is a runtime publish/probe
  timing, and the repro must exercise the real `BoardProjectionBuilder` with
  the real `processLivenessProbe`, not `attentionReason` in isolation.
- Stop touching anything outside the Scope list.
- Stop before implementing: this draft phase ships the contract only.
- Do not push the mission branch to `origin`; only `review` receives mission
  pushes and `main` is the only push target for `origin`.
- Do not run more than the single `./scripts/verify-local.sh all` gate in this
  phase.

Reproduction-Test: test/task-2411-integrate-work-detection.test.ts
