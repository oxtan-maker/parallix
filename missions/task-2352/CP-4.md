# CP-4: Hermetic checkpoint-completeness coverage

Added focused unit coverage using injected mission content, Git status, handoff, review-loop, and agent-launcher dependencies. The tests verify declared-checkpoint parsing and coverage, malformed declarations, the no-handoff guard for incomplete missions, and the continuation prompt contract without starting external processes.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Execute prompt makes checkpoint completion non-terminal with the three terminal conditions | `prompts/execute.md:15`, `prompts/execute.md:16` | PASS |
| Validator derives declarations and reports missing CP names | `src/adapters/cli/commands/active.ts:337`, `src/adapters/cli/commands/active.ts:401` | PASS |
| Incomplete missions cannot start handoff or review | `test/active.test.ts:632`, "runHandoffAndReview does not hand off or start review when CP-2 is missing" | PASS |
| Single, incomplete multi-checkpoint, complete, and malformed declaration cases are hermetic | `test/active.test.ts`, "validateCheckpointsBeforeHandoff rejects a multi-checkpoint mission with only CP-1", "validateCheckpointsBeforeHandoff accepts complete declared checkpoint coverage", "validateCheckpointsBeforeHandoff rejects malformed declarations missing a separator" | PASS |
| Relaunch continuation names the next checkpoint and preserves no-final contract | `test/active.test.ts:1521`, "attemptAgentRelaunch gives incomplete missions a continuation prompt naming the next checkpoint" | PASS |
| Declared checkpoint gaps relaunch successfully without null classification dereference | "runHandoffAndReview completes a successful relaunch for a declared checkpoint gap" | PASS |
| Review follow-up relaunches declared checkpoint gaps without mocking generic error classification | "attemptAgentRelaunch gives incomplete missions a continuation prompt naming the next checkpoint" | PASS |
| Malformed checkpoint declarations give an actionable MISSION.md correction | "runHandoffAndReview gives malformed checkpoint declarations corrective operator guidance" | PASS |
| Compatible declaration and checkpoint filename variants remain valid outside the documentation sub-block | "validateCheckpointsBeforeHandoff accepts compatible declaration and filename variants before its documentation sub-block" | PASS |
| Focused test command passes | `npm test -- test/active.test.ts` | PASS |
| Mission-declared full verification gate passes | `./scripts/verify-local.sh all` | PASS |

Next action: Run the mission verification gate and submit the review-round resolution.
