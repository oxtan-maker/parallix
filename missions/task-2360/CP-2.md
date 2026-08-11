# CP-2: Runtime checkpoint evidence guidance

Updated handoff, review, gatekeeper, active-command, repair-handoff, and domain guidance to lead with commands, test names, test paths, and ADR references. File:line remains supported by the validator but is last or parenthetical; the repair prompt’s worked table no longer contains a line number. Updated message-fixture assertions to match the new wording.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Handoff and review errors list durable forms before file:line | `src/application/handoff-command-use-case.ts`, `src/adapters/review/review-commands.ts` | PASS |
| Gatekeeper, active command, and repair prompt avoid line-number worked evidence | `src/adapters/verification/gatekeeper.ts`, `src/adapters/cli/commands/active.ts`, `src/adapters/cli/commands/repair-handoff.ts` | PASS |
| Validator acceptance behavior remains covered | "performHandoff accepts final checkpoint evidence row with a real file:line reference" | PASS |
| Source and updated message assertions pass the default suite | `npm test` | PASS |

Next action: Add the durable-citation policy to documentation standards and make the docs gate reject new live-documentation, ADR, and prompt line-number citations.
