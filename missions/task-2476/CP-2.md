# CP-2 — Execution story

Changed the normal active presentation to state the mission before launch and the actual implementer from the launch callback immediately before the agent’s own live stream. Normal launcher selection, fresh-session, command, working-directory, and Backlog-recording narration is suppressed for `px active`; warnings, failures, no-output warnings, and selected-to-fallback identity remain visible. Completion now states that implementation is complete without claiming that handoff has already succeeded.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Recording identifies mission and actual implementing agent before streamed work | `src/adapters/cli/commands/active.ts`; `test/active.test.ts`, `"px active opens with the mission identity and drops preflight/launch narration"` | PASS |
| Normal selected-agent path announces the implementer once and fallback remains explicit | `test/active.test.ts`, `"selectLaunchAndRecord announces the implementer exactly once on the selected-agent path"`; `src/adapters/cli/commands/active.ts` | PASS |
| Live work and explicit implementation completion remain present | `src/adapters/cli/commands/active.ts`; `test/active.test.ts`, `"px active states implementation completion rather than handoff mechanics"` | PASS |
| Normal active output excludes preflight and launch narration without hiding degraded conditions | `test/active.test.ts`, `"px active opens with the mission identity and drops preflight/launch narration"`; `src/adapters/agents/agents.ts` | PASS |
| Handoff outcome story, meaningful demo verifier, truthful verification area, final replay, and repository gates | `missions/task-2476/MISSION.md`; `scripts/record-first-value-demo.sh`; `./scripts/verify-local.sh all` | PENDING CP-3–CP-4 |
| Focused active tests pass | `npm test -- test/active.test.ts`; `test/active.test.ts` | PASS |

Next action: Replace the numbered handoff trace with repository-verification outcome messages and make the demo verifier prove the shown greeting behavior.
