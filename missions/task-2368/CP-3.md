# CP-3: Attach the live session to the mission card and stop asking a human

## Summary

Minimal correction at the boundary CP-2 identified, in three edits:

1. `src/application/projections/board-readers.ts` —
   `BoardProjectionBuilder.build()` now indexes the already-loaded
   `runningSessions` by mission id and passes the mission's session into
   `MissionOperationalFacts.liveSession`. The list was already fetched for the
   agent strip; nothing new is read, spawned, or polled.
2. `src/application/projections/mission-board.ts` — `MissionOperationalFacts`
   and `MissionCard` gained an optional `liveSession: RunningAgentSession | null`
   (the existing `agent-status.ts` type, not a new one), and a new exported
   predicate `agentIsWorking(card)` says whether an agent is running this
   mission's work. `attentionRank` returns rank 4 for such a card.
3. `src/application/projections/board.ts` — `attentionReason` returns
   `{ kind: 'none' }` for a card with a live session, which is what
   `src/interfaces/tui/shell.tsx` already filters out of "NEEDS YOU NEXT" and
   out of the header's `attention N` count.

Design points held deliberately:

- **Provider-neutral.** Nothing reads the family, the `claude` label, or
  task-2274. A live session of any family, from any lane, is the same fact.
- **Blocking reasons and failed gates still win** — they are true whether or
  not an agent is at the keyboard, so the new check sits after them.
- **Unknown liveness stays attention.** `loadRunningSessions()` returning
  `null` (process table unreadable) leaves `liveSession` null, so the mission
  keeps its `review-lane` attention item. Only a positively observed session
  suppresses it. Covered by
  `"unknown liveness leaves the review-lane attention item unchanged"`.
- The field is optional so the many existing `MissionCard` fixtures keep
  compiling; `projectMissionCard` normalizes it to `null`.

Out of scope and untouched: review execution, Forgejo APIs, agent launchers,
and the `px review` role-attribution gap that makes the strip show
`● claude 0 running` (already reported honestly as
`unattributedRunningSessions`; see CP-2).

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC1 red test now exercised against the fix | `npx tsx --test test/task-2368-agent-running-review-detection.test.ts` — 4 pass, 0 fail | PASS |
| SC2 running review is identified and off the human lane | Test `"a review-lane mission whose review is running does not ask for human attention"` asserts `card.liveSession?.missionId === 'task-2274'` and `reason.kind === 'none'` | PASS |
| SC3 no-session review lane unchanged | Test `"a review-lane mission with no live session still awaits a human review decision"` asserts `review-lane` / `Awaiting review decision`; `"unknown liveness leaves the review-lane attention item unchanged"` covers unreadable liveness | PASS |
| SC4 no real Forgejo, agent, or heavy CLI | `test/task-2368-agent-running-review-detection.test.ts` uses only in-file adapter stubs plus the `listProcesses`/`listWorktrees`/`resolveCwd`/`now` seams of `src/adapters/agents/running-sessions.ts` | PASS |
| Fix is provider-neutral | `agentIsWorking` in `src/application/projections/mission-board.ts` reads only `liveSession !== null`; no family, label, or mission id is special-cased | PASS |
| Existing board classification preserved | `npx tsx --test test/board-projections.test.ts test/board-readers.test.ts test/board-controller.test.ts` — all pass | PASS |
| Types clean | `npx tsc -p tsconfig.json --noEmit` — no output | PASS |
| SC6 full gate | `./scripts/verify-local.sh all` | PENDING (CP-4) |

Next action: CP-4 — run `./scripts/verify-local.sh all` on the committed tree and record the gate result.
