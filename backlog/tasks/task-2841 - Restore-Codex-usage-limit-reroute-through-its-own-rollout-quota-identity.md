---
id: TASK-2841
title: Restore Codex usage limit reroute through its own rollout quota identity
status: backlog
assignee: []
created_date: '2026-11-04 11:55'
labels:
  - bug
  - ai_sdlc
dependencies: []
references:
  - TASK-2829
  - TASK-2838
  - TASK-2837
  - TASK-2834
priority: high
ordinal: 311016
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
A Codex usage-limit exit now stops the Mission instead of blocking Codex and rerouting to the next eligible family. Reproduce on TASK-2834, 2026-11-04: agent run `execute-codex-a1-mw1yv2xc` (10:21:08Z to 10:30:45.289Z, exit 1) ends its retained stderr with `ERROR: You've hit your usage limit. Visit https://chatgpt.com/settings/usage to purchase more credits or try again at 4:09 PM.`; the coordinator run `workflow-4a139d96-18c5-428b-8419-6ede10f316f9` exited 1 at 10:30:45.394Z, 105 ms later, with no second agent attempt in that operation and no `agent_blocklist` row written for `codex`. The Mission sat idle until the operator reactivated it at 10:43Z with a different implementer, and because Codex was never blocked the same quota wall was still selectable.

Regression point: commit `4fc3afd02` (TASK-2829, 2026-11-03) deleted the transcript-pattern limit-hit classifier (`PATTERN_SETS`, `legacyLimitHit`, `parseResetTime`) from `src/application/services/agent-limit.ts` and made `detectLimitHit` return a hit only for a producer-supplied typed `agent-quota`, `provider-rate-limit` or `provider-entitlement` failure reason. That is the intended direction, but no producer was added for the Codex launcher, so the reroute path became unreachable for it. Measured against the retained stream: the parent classifier returns `{ until: "2026-11-04 17", source: "parsed", reason: "parsed: you(?:'|')?ve hit your (?:weekly|daily|monthly|usage) limit" }`, while HEAD returns `null` because `spawn-tee` normalizes the exit only to `{ code: "process-failed", source: "process" }`.

The stop is completed by a second, previously masked defect. With no limit hit, `classifyLaunchOutcome` falls through to `handleFailedLaunch`, and `completedDespiteExit` accepts `isSpuriousCodexExit` (`src/adapters/agents/codex.ts`), which treats any Codex exit 1 with non-zero rollout token usage as a completed turn. A quota-aborted turn consumed 4 004 977 rollout tokens, so the failed launch was returned to `ExecuteMissionService.launchAgent`, which raised `Execute agent (codex) exited with status 1.` Before `4fc3afd02` the limit-hit branch ran first and this gate was never reached.

The fix is producer-owned, not a revert. Codex CLI already writes the machine identity into the very rollout JSONL that `extractCodexTelemetry` reads for this run: `payload.type: "task_complete"` carries `error.codex_error_info: "usage_limit_exceeded"`, and `payload.type: "token_count"` carries `rate_limits.primary.used_percent: 100.0`, `window_minutes: 10080` and `resets_at: 1793804950`. Translate those fields in the Codex adapter into the canonical `agent-quota` failure reason with the advertised reset instant, so the existing `detectLimitHit` → checked AgentBlock → reselect chain works unchanged, and stop treating a rollout turn that ended with a terminal error as a completed run. Do not `git revert 4fc3afd02`: that would undo the whole structured-failure migration and reintroduce prose matching that TASK-2829 AC #1 and TASK-2838 AC #8 forbid.

Ownership boundaries: Claude quota event translation belongs to TASK-2838; explicit-reviewer preference and review continuation belong to TASK-2837. This task owns only the Codex launcher failure identity and the Codex spurious-exit gate, and must not change reviewer selection, pinned-implementer policy, block expiry semantics or the shared `detectLimitHit` contract.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 The Codex launcher adapter translates its own rollout terminal error identity (`task_complete.error.codex_error_info`, including `usage_limit_exceeded`) into the canonical versioned `agent-quota` failure reason with provider source, so `detectLimitHit` returns a blocking hit for the retained TASK-2834 stream where it returns `null` on the parent.
- [ ] #2 The block honours the advertised reset from `rate_limits.primary.resets_at` (epoch seconds) through the existing `agent-quota` reset context; a missing or unparseable reset keeps the existing fallback duration, and `used_percent` alone never invents a reset instant.
- [ ] #3 A Codex launch whose rollout turn ended with a terminal error is not classified as completed: `isSpuriousCodexExit` keeps accepting a genuine spurious exit 1 with real token usage and no terminal error, and reroutes instead of returning when a terminal error is present.
- [ ] #4 After the fix the same Mission operation blocks Codex until its reset and continues with the next eligible family; the block is written through the existing checked AgentBlock authority and no second attempt is spent on the blocked family.
- [ ] #5 No human-text substring or regex classifier is reintroduced into `src/application/services/agent-limit.ts` or the shared launch-outcome path, and unknown or malformed Codex rollout shapes keep the existing fail-closed `process-failed` behavior.
- [ ] #6 Claude, Qwen, Mistral/Vibe and OpenCode behavior is unchanged; TASK-2838 remains the only owner of Claude quota event translation and TASK-2837 the only owner of reviewer preference.
- [ ] #7 Focused red-on-parent/green-on-fix cases extend the existing owning suites only — `test/unit/adapters/agents/codex-launch-contract.test.ts` for the adapter identity, `test/integration/agents/agent-exit-telemetry-classification.test.ts` for the spurious-exit gate and `test/integration/agents/agents-limit-hit.test.ts` for block-then-reroute — with no new suite, category, gate or CPU-budget inflation, every added unit case under 500 ms and every touched integration case and suite at or under 3.5 s.
- [ ] #8 Manual check of the built public execute path in isolated disposable operator state with a scripted Codex launcher that writes the retained rollout shape and exits 1: the run blocks Codex with the advertised reset, launches the next eligible family, and the Mission keeps working without contacting OpenAI or mutating live Mission state.
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
