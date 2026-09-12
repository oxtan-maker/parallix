# CP-1: Trace the handoff-workflow port and `handoff-command-use-case`; map callers and registration surfaces

## Summary

Traced the handoff capability end to end and mapped every caller and every
`handoff` registration/advertising surface. Key finding: the handoff *workflow*
lives in `src/application/handoff-command-use-case.ts` (`HandoffCommandUseCase`,
`performHandoff`); the file `src/adapters/cli/commands/handoff.ts` is only the
adapter boundary that binds the `HandoffWorkflowPorts` and delegates to that use
case. Because many production callers still import `commands/handoff.ts`, it must
stay; only its *standalone-command registration* is removed.

`performHandoff` sequencing (preserve verbatim, out of scope to rewrite):
verify-handoff gate → repo pre-handoff gates → backlog identity resolution →
content-integrity/checkpoint validation (Goal Check evidence) → verification gate
(with rebound gate-failure repair) → behind-main rebase (`rebaseBeforeReviewRound`)
→ NEL capture (`captureNelAtHandoff`) → Forgejo PR create/update → gatekeeper
pre-review → declared `## Gates` runner → `SqliteMissionStore` lifecycle
transition to review + backlog `active -> review` → review assignment.

How `px review <slug> --start` currently reaches (or fails to reach) handoff:
`ReviewCommandUseCase.dispatch` `--start` → `ReviewWorkflowAdapter.start` →
`runLoop(false)` → `startReviewLoop`. `startReviewLoop` only hands off inside a
`forgejoEnabled` *self-heal* block, and that block **early-returns with a
`--push` hint when the task is still `active`** (the two-entry-point hazard this
mission removes). `px active` (TASK-1037) already calls `performHandoff` then
`startReviewLoop` via `runHandoffAndReview` in `src/adapters/cli/commands/active.ts`.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Handoff workflow owned by use case, adapter is boundary | `src/application/handoff-command-use-case.ts` `HandoffCommandUseCase.performHandoff`, `src/adapters/cli/commands/handoff.ts` `createHandoffPorts` | PASS |
| `--start` dispatch path to `startReviewLoop` | `src/application/review-command-use-case.ts` `dispatch` (`--start` → `run` `'start'`), `src/adapters/review/review-workflow-adapter.ts` `start`/`runLoop` | PASS |
| Existing handoff callers preserved | `src/composition/production-capabilities.ts` `createBoardHandoffWorkflow`, `src/composition/application-services.ts`, `src/adapters/review/review-loop.ts` `startReviewLoop`, `src/adapters/cli/commands/active.ts` `runHandoffAndReview`, `src/adapters/review/review-commands.ts` `submitForReview` | PASS |
| Registration/advertising surfaces mapped | `src/interfaces/cli/runtime.ts` `KNOWN_COMMANDS` + `printUsage`, `src/composition/create-cli.ts` `handoff` binding, `src/adapters/review/review-cli-flags.ts` `getHandoff`, `src/interfaces/cli/handoff.ts` `createHandoffCommand` | PASS |
| Standalone command fails once binding removed | `src/interfaces/cli/runtime.ts` `main` unknown-command path | PASS |
| Live docs referencing `px handoff` | `docs/agents.md` (TASK-1037 post-execute handoff repair section) | PASS |

## Next action: CP-2 — wire the sync/push + `active -> review` transition into `px review <slug> --start` (remove the `isImplementationPhase` `--push` early-return in `startReviewLoop`), then remove the standalone `handoff` command from every registration surface while preserving the production callers above.
