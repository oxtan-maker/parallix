---
id: TASK-2444
title: Attention queue projects unranked, reasonless entries
status: backlog
assignee: []
created_date: '2026-08-30 15:40'
labels:
  - ai_sdlc
  - bug
  - board
  - projection
dependencies: []
priority: high
---

## Description

The board projection's `attentionQueue` is not a ranked list of things that
need an operator. Read live from `px web` on a repository with 8 missions
(5 backlog, 0 refined, 0 active, 0 review, 2 integration, 1 done), the queue
returned 8 entries, of which 6 carried no reason at all:

```
rank missionId   reason                                    action              state
3    task-2433   integrate-lane · "Awaiting integration"   integrate:merge     enabled
3    task-2434   integrate-lane · "Awaiting integration"   integrate:merge     enabled
4    task-2235   none · null                               active:execute      enabled
4    task-2337   none · null                               active:execute      ineligible
4    task-2435   none · null                               active:execute      enabled
4    task-2436   none · null                               active:execute      enabled
4    task-2437   none · null                               active:execute      enabled
4    task-2442   none · null                               active:execute      enabled
```

Four separate defects are visible in that one payload:

1. **Rank is not a rank.** The values are `3, 3, 4, 4, 4, 4, 4, 4` — not a
   `1..N` sequence, and duplicated across entries, so no consumer can order
   or number the queue. Any client that prints `rank` shows `03 03 04 04 …`.
2. **Reasonless entries are queued.** Six entries have
   `reason.kind === 'none'` and `reason.detail === null`. An entry that
   cannot say why it is queued does not belong in a queue whose whole purpose
   is "what needs you next"; these are plain backlog missions.
3. **A queued entry recommends an action the server itself rejects.**
   `task-2337` is queued with `active:execute` in state `ineligible`. The
   queue is telling the operator to run a command the same payload says
   cannot run.
4. **`dependsOnSources` is empty on every reasonless entry**, so nothing in
   the payload explains where the entry came from.

Related: the same snapshot carried **380** `sourceFacts` for 8 missions,
almost all repeats of `task-markdown · fresh · <path>`. Whether the fact list
is meant to be per-read or deduplicated per source should be settled here
too, since consumers render it as evidence for the ranking.

Found while reconciling the browser board (TASK-2434) against its design
authority. The browser client renders `attentionQueue` verbatim by contract,
so it cannot filter or renumber these entries — the fix belongs in the
projection.

## Acceptance Criteria

- [ ] #1 `attentionQueue` ranks are a contiguous `1..N` sequence with no duplicates, and the order is the queue's own priority order.
- [ ] #2 An entry is queued only when it carries a reason kind other than `none`; missions with nothing to say do not appear.
- [ ] #3 A queued entry's action is never in a state the same snapshot reports as not runnable.
- [ ] #4 Every queued entry carries the sources its reason was derived from.
- [ ] #5 `sourceFacts` has a defined identity per entry (deduplicated per source, or explicitly per-read with a stable key) and is documented as such in the transport contract.

## Definition of Done

- [ ] #1 Projection tests cover a repository whose missions are all backlog: the queue is empty rather than reasonless.
- [ ] #2 A test asserts rank contiguity and uniqueness for a mixed-lane repository.
- [ ] #3 A test asserts no queued entry carries a non-runnable action.
- [ ] #4 Verification/static-analysis gates pass.
