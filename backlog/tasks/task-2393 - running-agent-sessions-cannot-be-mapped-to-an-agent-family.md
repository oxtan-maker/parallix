---
id: TASK-2393
title: running agent sessions cannot be mapped to an agent family
status: backlog
assignee: [custom]
created_date: '2026-08-22'
labels:
  - bug
  - ai_sdlc
dependencies: []
references:
  - src/adapters/backlog/concrete-agent-read-adapter.ts
  - src/adapters/agents/running-sessions.ts
  - src/adapters/agents/agents.ts
  - src/application/projections/agent-status.ts
  - src/application/projections/board-readers.ts
  - src/interfaces/tui/agent-strip.tsx
priority: high
ordinal: 107917
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The agent strip detects that agents are running but almost never attributes them
to a family, so the board reads:

```
● claude 0 running   ● codex 0 running   ● custom 0 running   ● qwen 3d · 0 running …   ● vibe 0m · 0 running …   3 running · family unknown
```

Liveness detection itself is fine. `detectRunningMissionSessions` in
`src/adapters/agents/running-sessions.ts` correctly finds the live `px`
processes and their missions (verified live: `px review --continue` in
`parallix-task-2380` and `px active` in `parallix-task-2392` were both
detected). The failure is entirely in the attribution step,
`ConcreteAgentReadAdapter.loadRunningSessions`, which has only two sources and
both are unavailable while an agent is actually running.

**Root cause 1 — the session marker is written after the launch exits, but
attribution requires a marker written before the board reads it.**

`startAgent` in `src/adapters/agents/agents.ts` saves the session marker only
after the spawned launch returns (`result.status === 0 && !result.error`).
`loadRunningSessions` then accepts a marker only when
`Date.parse(marker.lastLaunched) >= session.startedAtMs` — proof that *this*
process wrote it. For the whole time the agent is running there is no such
marker: the newest one predates the process and is deliberately rejected as
stale. Attribution can only succeed after the agent has already exited, which
is exactly backwards from what the strip is trying to show.

**Root cause 2 — the two ambiguous commands never even look up a marker.**

`AGENT_COMMAND_ROLES` maps `review` and `resolve-conflict` to `null`, and
`loadRunningSessions` skips the marker lookup entirely when `session.role` is
`null`. `px review` is the single most common long-running command, so its
sessions are unattributable by construction.

**Root cause 3 — the command-line fallback rarely applies.**

The only other source is `pinnedAgent` parsed from `--agent`/`--implementer`/
`--reviewer`. Normal invocations (`px active <slug>`, `px review --continue`)
pin nothing, so this yields `null` too.

**The live authority already exists and is ignored.**

`CurrentWorkRecorder` (`src/application/recording/current-work-recorder.ts`)
publishes a `mission.current-work` event whose documented purpose is "is a
long-running Parallix operation working this mission right now, and which
family is doing it?". `CurrentWorkEvent` carries `agent`, is written at the
start of the operation rather than at its end, and is already reconciled
against process liveness by `reconcileCurrentWork`. `BoardProjectionBuilder.build`
already computes `currentWorkByMission` from it for the mission cards — and then
builds the agent strip from `runningSessions` alone, without consulting it.

Reusing that reconciled fact as the first attribution source for a running
session is the fix; the session marker stays as the fallback for missions with
no published current-work fact. No new authority, no new storage.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A running session for a mission with a reconciled `running` current-work
  fact is attributed to that fact's agent family, and is counted under that
  family in the agent strip instead of under `family unknown`.
- [ ] #2 Attribution works for `px review` and `px resolve-conflict` sessions,
  whose `role` is `null` — the ambiguous-role skip must no longer force
  `family unknown` when a live current-work fact names the family.
- [ ] #3 Attribution works while the agent is still running, not only after the
  launch exits: no attribution path may depend on a session marker whose
  `lastLaunched` is newer than the detected process start.
- [ ] #4 The existing sources remain as ordered fallbacks — pinned
  `--agent`/`--implementer`/`--reviewer`, then a fresh session marker — for
  sessions with no current-work fact.
- [ ] #5 Honesty properties are preserved: unobservable liveness still reports
  `null` (`running unknown`), never `0`; a session that genuinely cannot be
  attributed is still counted in the trailing `N running · family unknown`
  entry and never guessed from the mission assignee.
- [ ] #6 A red-to-green test reproduces the live case — a detected running
  session whose only fresh evidence is a `running` current-work event — and
  asserts the family is counted, failing before the fix.
- [ ] #7 `./scripts/verify-local.sh static-analysis` passes.
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 Verification gate ran and passed on the final tree with captured proof rather than an unverified claim
- [ ] #2 Lint and static analysis report clean on every changed file
- [ ] #3 No focused or unannotated skipped tests were introduced (no .only and no bare .skip)
- [ ] #4 Final checkpoint Goal Check table cites real evidence using file:line references and test names
- [ ] #5 Docs updated to reflect any workflow or user-facing behavior change
- [ ] #6 Bug-labeled missions include a red-to-green reproduction test that fails before the fix and passes after
<!-- DOD:END -->
