---
id: TASK-2351
title: Agent selection ignores runtime blocks stored in SQLite
status: active
assignee: [codex]
created_date: '2026-08-09 15:25'
labels:
  - ai_sdlc
  - bug
dependencies: []
references:
  - 'src/domain/agents.ts'
  - 'src/application/services/agent-selection.ts'
  - 'src/application/domain-ports.ts:103-105'
  - 'src/adapters/agents/agents.ts:229-236'
  - 'src/adapters/agents/launcher-selection.ts:128-142'
  - 'src/adapters/review/review-loop.ts:898'
ordinal: 83911
---

## Description

`agents.local.json` last modified July 29. SQLite `agent_blocklist` holds blocks from Aug 3-9. The review-loop calls `selectAgent` (`launcher-selection.ts`) which reads the JSON blocklist via `eligibleAgentsForStep` → `isAgentBlocked(agent, config)`. Runtime blocks are persisted to SQLite only (`updateAgentBlockChecked`). The JSON file is not updated on block writes.

Observed symptom: `vibe` selected as reviewer for 8 consecutive missions starting Aug 8. SQLite shows `codex` blocked until Aug 9 20:00 (usage limit). JSON shows `codex` unblocked (July 29 entry expired). `selectAgent` picks `codex` from pool, launch fails at runtime, `startAgent` retries with next agent, `vibe` wins. Same cycle repeats for every mission.

**Hypotheses**

1. **Blocklist split authority.** SQLite is the write path for runtime blocks (limit hits, launch failures). JSON is the read path for selection. Without a sync mechanism, the two diverge. The domain model (`AgentSelectionSnapshot` + `selectableAgents`) resolves blocks from a single snapshot, but it has no concrete `AgentSelectionSnapshotPort` implementation wired into the review-loop or CLI commands.

2. **Wasted launch cycles.** Because `selectAgent` does not see the SQLite block, it nominates an agent that will fail at launch. `startAgent` catches the failure, blocks the agent (SQLite), and retries. This costs one full launch attempt per blocked agent per mission. If multiple agents are blocked simultaneously, the cost compounds.

3. **`claude` absent from Aug 8+ reviewer data.** `claude` appears 0 times as reviewer in 8 eligible trials since Aug 8 (p ≈ 0.004 for fair coin). SQLite block expired Aug 3, no new entry. Possible explanations: (a) `claude` launch fails with a non-blocking error pattern (`NON_BLOCKING_LAUNCH_ERROR_PATTERNS`), so no SQLite block is written but `startAgent` still retries; (b) `claude` is the implementer more often than expected and gets excluded; (c) statistical outlier. Needs telemetry to distinguish.

4. **Domain model exists but unused.** `src/domain/agents.ts` defines `AgentSelectionSnapshot` (blocks + launcher status + step policies captured at one timestamp) and a pure `selectAgent` that operates on it. `PreparedAgentSelection` materializes the snapshot once and serves synchronous selections. The `AgentSelectionSnapshotPort` interface exists (`application/domain-ports.ts`) but has no adapter implementation. The board/TUI already reads SQLite blocks via `ConcreteAgentReadAdapter.loadAgentAvailability`, suggesting the infrastructure is ready.

## Acceptance Criteria

- [ ] #1 Reproduce the symptom: seed SQLite with a block for an eligible agent, leave JSON stale, and confirm `selectAgent` still nominates the blocked agent
- [ ] #2 Agent selection reads block state from the same authority that writes it (SQLite), eliminating the stale-JSON window
- [ ] #3 A blocked agent is skipped during selection without consuming a launch attempt
- [ ] #4 Telemetry or logging surfaces per-agent selection outcomes (nominated, skipped-blocked, launch-failed, fallback) so future skew is detectable
- [ ] #5 Existing unit tests pass; new tests cover the block-read path with mocked SQLite and launcher probes
