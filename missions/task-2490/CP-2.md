# CP-2: Wire the sync/push + `active -> review` transition into `px review <slug> --start`; retire the standalone `handoff` command

## Summary

**SC1 — handoff baked into `--start`.** `startReviewLoop` (`src/adapters/review/review-loop.ts`)
only handed off inside a `forgejoEnabled` self-heal block, which early-returned
with a `--push` hint while the task was still `active` — the two-entry-point
hazard. Removed that `isImplementationPhase` early-return so a fresh
`px review <slug> --start` calls `performHandoffFn` (the port bound in
`src/composition/create-cli.ts` `startReviewLoopFn`) before the reviewer
launches, for both forgejo-enabled and forgejo-disabled missions. `toVirtualFn`
was now unused in the loop and dropped from its destructuring. The transition
still persists through the same durable boundaries handoff used
(`SqliteMissionStore` lifecycle + backlog `active -> review`), so ADR 0053 holds.

**SC2 — standalone `handoff` deregistered.**
- `src/interfaces/cli/runtime.ts`: dropped `'handoff'` from `KNOWN_COMMANDS` and
  the `handoff [<slug>] [--no-gate] [--no-recover] [--force]` `printUsage` line.
  `main` now resolves `handoff` to no `commandFn` and no alias → `Unknown
  command: handoff`.
- `src/composition/create-cli.ts`: removed the `handoff:` command binding and the
  `createHandoffCommand` import. `createHandoffPorts` / `HandoffCommandUseCase`
  imports kept (still used by the `--start` handoff and the board handoff).
- `src/adapters/review/review-cli-flags.ts`: removed the lazy `getHandoff()`
  loader and `unwrapHandoffModule` (the hidden reference to the retired command
  module).
- `src/adapters/review/review-commands.ts`: `submitForReview` uses a direct
  `performHandoff` import instead of `(await getHandoff()).performHandoff`.
- `src/adapters/cli/commands/handoff.ts` and `src/interfaces/cli/handoff.ts`
  **kept**: production callers still import them (`production-capabilities.ts`
  `createBoardHandoffWorkflow`, `application-services.ts`, `review-loop.ts`,
  `review-commands.ts`, `active.ts` TASK-1037), so the "no remaining caller"
  removal condition does not apply.

**SC3 — existing callers preserved.** `submitForReview`, `review-loop.ts`
(`startReviewLoop` self-heal + gate-repair), `production-capabilities.ts`,
`application-services.ts`, and `active.ts` `runHandoffAndReview` (TASK-1037)
still route through `performHandoff`; all compile and their suites pass.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC1 `--start` hands off an active task before reviewer launch | `test/review.test.ts` "startReviewLoop performs the handoff for an active task via --start (task-2490)", "…virtual-active task…" — assert `performHandoffFn` called, no `--push` bail | PASS |
| SC1 transition still self-heals for an existing review (`--continue`/board) | `test/review.test.ts` "startReviewLoop self-heals via handoff and recovers when task is review and a PR appears (crit. 1)" | PASS |
| SC2 `handoff` not in `KNOWN_COMMANDS` / not advertised | `test/index.test.ts` "KNOWN_COMMANDS no longer registers the retired handoff command", "printUsage no longer advertises the retired handoff command" | PASS |
| SC2 `px handoff` resolves to no command binding | `src/composition/create-cli.ts` `handoff:` binding removed; `src/interfaces/cli/runtime.ts` `KNOWN_COMMANDS` | PASS |
| SC2 lazy handoff loader removed | `src/adapters/review/review-cli-flags.ts` `getHandoff`/`unwrapHandoffModule` gone; `test/review.test.ts` `unwrapHandoffModule` test removed | PASS |
| SC3 callers preserved through `performHandoff` | `src/composition/production-capabilities.ts` `createBoardHandoffWorkflow`, `src/adapters/review/review-loop.ts` `startReviewLoop`, `src/adapters/cli/commands/active.ts` `runHandoffAndReview`, `src/adapters/review/review-commands.ts` `submitForReview` | PASS |
| Callers compile (static analysis) | `npm run typecheck` clean; ESLint clean on changed files | PASS |
| Focused regression suites green | `node --test` `test/review.test.ts` (119), `test/index.test.ts` (40), `test/active.test.ts`+`task-2332.09`+`single-path-guardrail` (96), `test/handoff*.test.ts`+`review-commands.test.ts`+`task-1049` (193) | PASS |

## Next action: CP-3 — update live agent guidance (`docs/agents.md`, `prompts/execute-core.md`, `prompts/review-core.md`) so no document instructs agents to invoke `px handoff` separately from `px review <slug> --start`; then run the full `./scripts/verify-local.sh all` gate.
