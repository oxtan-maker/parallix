# CP-2: Trace — where the running-review signal is lost

## Summary

Traced the full handoff from live-session discovery to board attention
classification. The signal exists end to end until the board projection builds
mission cards, where it is dropped.

The chain:

1. **Discovery** — `src/adapters/agents/running-sessions.ts`,
   `detectRunningMissionSessions()`. Parses `ps` output, keeps `px` processes
   whose subcommand is in `AGENT_COMMAND_ROLES` (`draft`, `active`, `execute`,
   `resolve-conflict`, `review`), and identifies the mission by the slug on the
   command line or by the worktree the process runs in. `px review task-2274`
   yields `{ missionId: 'task-2274', role: null, startedAtMs, worktree,
   pinnedAgent }`. Proven by the test
   `"a live px review process is detected as a running session for its mission"`.
2. **Adapter** — `src/adapters/backlog/concrete-agent-read-adapter.ts`,
   `ConcreteAgentReadAdapter.loadRunningSessions()`. Keeps the mission id and
   attributes a family via session markers or a pinned `--agent` flag,
   returning `RunningAgentSession { missionId, family }`. For `px review` the
   role is ambiguous, so `family` is `null` — the mission id survives, the
   family does not.
3. **Board projection** — `src/application/projections/board-readers.ts`,
   `BoardProjectionBuilder.build()`. **This is the loss boundary.**
   `runningSessions` was consumed only by `projectAgentAvailability(...)` and
   `countUnattributedSessions(...)`, i.e. reduced to per-family counters for
   the agent strip. Every mission card was built with the operational fact
   `currentWork: null` hardcoded, and no other per-mission liveness field
   existed — `grep -rn "currentWork" src` showed that hardcoded `null` as the
   only writer in the codebase.
4. **Classification** — `attentionReason()` in
   `src/application/projections/board.ts` and `attentionRank()` in
   `src/application/projections/mission-board.ts`. With no liveness on the
   card, every review-lane mission falls through to
   `{ kind: 'review-lane', detail: 'Awaiting review decision' }` at rank 2, and
   `src/interfaces/tui/shell.tsx` renders every reason other than `none` in
   "NEEDS YOU NEXT" — exactly the reported view for task-2274.

Smallest production boundary: carry the already-loaded `RunningAgentSession`
for a mission into `MissionOperationalFacts` / `MissionCard`, then let the two
attention classifiers read it. Discovery, attribution, review execution,
Forgejo access, and launcher behavior need no change — consistent with the
mission's Restricted Areas.

Secondary observation, deliberately not fixed here: the strip's
`● claude 0 running` in the report is the *family attribution* gap of step 2
(`px review` runs reviewer and act-on-review implementer in one process, so its
role is `null`). That count is already reported honestly as
`unattributedRunningSessions`; changing role attribution would mean touching
agent-launcher/marker semantics, which this mission's Restricted Areas exclude.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Handoff traced from discovery to classification | `src/adapters/agents/running-sessions.ts` (`detectRunningMissionSessions`), `src/adapters/backlog/concrete-agent-read-adapter.ts` (`loadRunningSessions`), `src/application/projections/board-readers.ts` (`BoardProjectionBuilder.build`), `src/application/projections/board.ts` (`attentionReason`) | PASS |
| Mission identity survives discovery and attribution | Test `"a live px review process is detected as a running session for its mission"` in `test/task-2368-agent-running-review-detection.test.ts` passes at the CP-1 red commit | PASS |
| Loss boundary identified | `BoardProjectionBuilder.build()` built facts with `currentWork: null` and used `runningSessions` only for `projectAgentAvailability` / `countUnattributedSessions`; `grep -rn "currentWork" src` returns that single hardcoded writer | PASS |
| Classification consequence confirmed | `attentionReason` returns `review-lane` / `Awaiting review decision` for any review-lane card; `src/interfaces/tui/shell.tsx` filters the attention rail on `reason.kind !== 'none'` | PASS |
| Fix stays outside Restricted Areas | No change needed in `src/adapters/forgejo/forgejo.ts`, `src/adapters/review/review-commands.ts`, `src/adapters/review/review-loop.ts`, or agent launchers | PASS |

Next action: CP-3 — attach the mission's `RunningAgentSession` to the mission card in `BoardProjectionBuilder.build()` and suppress human attention for a card with a live session in `attentionReason`/`attentionRank`, then rerun `npx tsx --test test/task-2368-agent-running-review-detection.test.ts`.
