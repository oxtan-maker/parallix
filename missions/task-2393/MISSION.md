# Mission: Attribute running agent sessions to their family via reconciled current-work (task-2393)

## Goal
Make the agent strip attribute a live running session to the family actually
running it, by reusing the already-reconciled `mission.current-work` fact as the
**first** attribution source. A running session whose mission has a reconciled
`running` current-work fact whose `agent` is non-null is counted under that
family instead of under `family unknown`.

## Why Now
The strip shows liveness correctly but reports `3 running · family unknown`
because attribution has only two sources and both are unavailable while an agent
is actually running:

- `startAgent` in `src/adapters/agents/agents.ts` writes the session marker
  **after** the launch exits, so the newest marker always predates the live
  process and `loadRunningSessions` rejects it as stale
  (`Date.parse(marker.lastLaunched) >= session.startedAtMs`).
- `AGENT_COMMAND_ROLES` maps `review` and `resolve-conflict` to `null`, and
  `loadRunningSessions` skips the marker lookup when `session.role` is `null`.
  `px review` is the single most common long-running command, so its sessions
  are unattributable by construction.
- The only other source, `pinnedAgent` from `--agent`/`--implementer`/
  `--reviewer`, yields `null` for `px active <slug>` and `px review --continue`.

The live authority already exists and is ignored: `CurrentWorkRecorder`
publishes `mission.current-work` whose documented purpose is "is a
long-running Parallix operation working this mission right now, and which
family is doing it?", written at the **start** of the operation, and
`reconcileCurrentWork` already bounds it against process liveness.
`BoardProjectionBuilder.build` computes `currentWorkByMission` from it for the
mission cards but builds the agent strip from `runningSessions` alone. Reusing
that reconciled fact as the first attribution source is the fix; the session
marker stays as the fallback for missions with no published current-work fact.
No new authority, no new storage.

Reproduction-Test: test/task-2393-current-work-attribution-repro.test.ts

## Refinement Signals
- Predicted NEL bucket: Medium (81–235)
- Confidence: High
- Selection note: activate as-is
- Main drivers: regression (agent strip reports `family unknown` for live
  sessions), high priority, root cause fully identified in the backlog with
  exact file/function references and a single-constraint fix.

## Scope
- Add a `CurrentWorkReadAdapter` seam to `ConcreteAgentReadAdapter` and use the
  reconciled newest `running` fact per mission (non-null `agent`) as the first
  attribution source in `loadRunningSessions`, before the session-marker and
  pinned-command-line fallbacks.
- Reuse `reconcileCurrentWork` from `src/application/projections/current-work.ts`
  (do not re-implement reconciliation) to reduce events to one fact per mission.
- Wire the current-work reader into `ConcreteAgentReadAdapter` from
  `src/composition/board-projection.ts`, passing the same `historyRepo` the
  board already uses for its own `currentWork` adapter.
- Attribute `px review` and `px resolve-conflict` sessions (role `null`) that
  previously skipped the marker lookup entirely.
- Add a red-to-green reproduction test and update the existing
  `test/running-sessions.test.ts` cases that assert `family: null` where a
  reconciled current-work fact now names a family.

## Out of Scope
- Any change to how `mission.current-work` is published, reconciled, or
  reconciled-freshness graded (`reconcileCurrentWork`, `CurrentWorkRecorder`).
- Any change to `BoardProjectionBuilder.build` mission-card rendering or to
  `currentWorkByMission` consumption.
- New storage, new authority, or a new port beyond the injected
  `CurrentWorkReadAdapter` seam.
- Attribution of sessions for missions that have **no** current-work fact and no
  marker/pinned family — those stay `family unknown` (honesty preserved).
- Any change to `detectRunningMissionSessions` liveness detection.

## Success Criteria
> **Falsifiability rule (ADR 0039 Part 2):** Each criterion is falsifiable with
> no unqualified subjective adjective or vague quantifier.

- [ ] SC1 A running session for a mission with a reconciled `running` current-work
  fact whose `agent` is `'claude'` is returned by
  `ConcreteAgentReadAdapter.loadRunningSessions` as
  `{ missionId, family: agentFamily('claude') }` instead of `family: null`.
- [ ] SC2 Attribution works for a session with `role: null` (a `px review` or
  `px resolve-conflict` process): the ambiguous-role skip no longer forces
  `family unknown` when a live current-work fact names the family.
- [ ] SC3 Attribution succeeds while the agent is still running: no attribution
  path depends on a session marker whose `lastLaunched` is newer than
  `session.startedAtMs`. A session marker older than the process start still
  does not attribute.
- [ ] SC4 For a session with **no** reconciled current-work fact, attribution
  falls back in order to (a) a session marker written after the process start,
  then (b) the family pinned on the command line (`pinnedAgent`), then (c)
  `null`. This ordering is unchanged from the current behaviour.
- [ ] SC5 Honesty preserved: a mission with no observed liveness still reports
  `runningSessions: null` (renders `running unknown`, never `0`); a session that
  still cannot be attributed is counted in the trailing `N running · family
  unknown` via `countUnattributedSessions` and is never guessed from the mission
  assignee.
- [ ] SC6 The reproduction test in AC #6 fails (red) at the mission's parent
  commit and passes (green) after the fix.
- [ ] SC7 `./scripts/verify-local.sh static-analysis` passes on the final tree.

## Risks and Assumptions
- The reconciled current-work fact may be graded `stale` (abnormally terminated
  process past the TTL) — `isWorkInProgress` treats `stale` as not-in-progress,
  and a `stale` fact must **not** attribute a session. Only a `live` or
  `unverified` `running` fact (i.e. `isWorkInProgress` true) may attribute.
  Assumption: reuse `isWorkInProgress` + the fact's `agent` rather than reading
  raw events.
- The current-work `agent` is an `AgentFamily`; it must be validated the same
  way as the marker/pinned family via `parseAgentFamily` before counting, so a
  family that is not recognised degrades to `null` rather than crashing.
- Composition assumption: the same `OperationalHistoryRepository` instance used
  by the board's `currentWork` adapter is passed to the agent adapter; both read
  the same `operational_history` table.
- No concurrency hazard: `loadRunningSessions` only reads the current-work
  reader; it never writes.
- Assumption that a mission can have at most one standing `running` fact after
  `reconcileCurrentWork` (by design), so one `agent` per mission is unambiguous.

## Checkpoints
- CP 1: Reproduction test written and failing (red) at the parent commit.
- CP 2: Fix implemented — current-work as first attribution source, fallbacks
  preserved.
- CP 3: Full verification gate passes with captured evidence.

### Checkpoint Documentation Requirements
Every checkpoint document (CP-N.md) MUST include:
- A summary of work done
- A `## Goal Check` section
- A 3-column pipe-delimited markdown table with columns: Criterion | Evidence | Status
- At least one evidence row per criterion using durable, verifiable references.
  Parallix accepts these forms (prefer the first three):
  1. **Recognized repo commands or paths** — e.g. `` `npm test -- test/task-2393-current-work-attribution-repro.test.ts` ``, `` `./scripts/verify-local.sh static-analysis` ``, `` `npm run test` ``.
  2. **Test names** — a real test name in the repo, e.g. `"loadRunningSessions attributes a running session to a reconciled current-work agent"`.
  3. **Test file paths** — an existing test file, e.g. `test/running-sessions.test.ts`.
  4. **ADR references** — e.g. `ADR 0053` (must correspond to a file under `docs/adr/`).
  5. **File:line references** — accepted when needed, but line numbers rot; prefer the forms above.
- Raw `stat`/`ls` output or generic prose alone is **not** enough: pair any
  shell output with one of the accepted references. A raw `node --test` or
  `npm test` transcript without the test name or file path is weak evidence.
- A non-generic `Next action:` line at the bottom.

## Gates
- [ ] ./scripts/verify-local.sh static-analysis

## Restricted Areas
- Do not modify `reconcileCurrentWork`, `runningFreshness`, or the
  `CurrentWorkState`/`CurrentWorkPhase` grading in `src/application/projections/current-work.ts`.
- Do not modify `CurrentWorkRecorder`, `parseCurrentWorkEntry`, or the write side
  in `src/application/recording/current-work-recorder.ts`.
- Do not modify `BoardProjectionBuilder.build` mission-card logic in
  `src/application/projections/board-readers.ts` (only the agent-adapter wiring
  in `src/composition/board-projection.ts` changes).
- Do not modify `detectRunningMissionSessions` or
  `src/adapters/agents/running-sessions.ts` detection logic.
- Do not change the honesty contract: never report a fabricated running count,
  never attribute from the mission assignee.

## Stop Rules
- Stop before writing any fix once CP 1's reproduction test is confirmed red.
- Stop if the fix requires changing reconciliation or current-work publishing;
  that means the root cause is misread — return to the backlog description.
- Stop if a legitimate attribution source must be invented (new storage/port);
  the contract forbids that — the reconciled fact already exists.
- Stop after the integration gate passes with captured evidence; do not push to
  `origin` (mission branch only; `review` remote is the only push target).
