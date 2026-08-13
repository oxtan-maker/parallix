# Mission: Split review-loop gate handling and agent fallback (task-2369.09)

## Goal

Separate pre-review gate handling and agent-fallback/stage-launch concerns from `src/adapters/review/review-loop.ts` into focused review adapters, while retaining the review loop's current public exports and observable behavior. The resulting `review-loop.ts` must be under 1,100 lines.

## Why Now

At 1,823 lines, `review-loop.ts` combines orchestration with gate execution, automatic gate-failure bounces, fallback identity repair, reviewer selection, launch deduplication, telemetry recording, and Graphify refreshes. These independent concerns are already imported by CLI, integration, and rebase workflows. Splitting them now makes future changes to review gates and fallback handling safer without changing the established review lifecycle.

## Refinement Signals

- Predicted NEL bucket: Medium (81–235)
- Confidence: High
- Selection note: activate as-is
- Main drivers: two coherent extraction boundaries, a hard `review-loop.ts` line-count target, established focused gate/fallback tests, and public consumers in active, integrate, and rebase workflows

## Scope

- Create `src/adapters/review/review-gate-handling.ts` containing `classifyGateFailure`, `PreReviewGateResult`, `runPreReviewGate`, `handleGateFailureAutoBounce`, `NO_GATE_NOTICE_ALIAS`, `strictlyLaterIso`, `DEFAULT_MAX_ATTEMPTS`, and `CONTINUE_SKIP_CHECK_TIMEOUT_MS`.
- Create `src/adapters/review/review-agent-fallback.ts` containing `applyAgentFallback`, `persistNormalizedPhaseRepair`, `selectPreparedReviewer`, `stageWindowKey`, `stageLaunchSinceMs`, `stageLaunchFingerprint`, `markStageLaunchRecorded`, `recordStageStatsSafe`, `getStats`, `getHandoff`, and `maybeUpdateGraphifyBeforeReview`.
- Update `src/adapters/review/review-loop.ts` to import the extracted behavior, retain the exports used by `src/adapters/cli/commands/active.ts`, `src/adapters/cli/commands/integrate.ts`, and `src/adapters/rebase/rebase-workflow-adapter.ts`, and remove the extracted implementations.
- Update or add unit tests under `test/` for the extracted modules and their existing public review-loop entry points.

## Out of Scope

- Changing gate classifications, retry limits, auto-bounce decisions, or gate-command resolution.
- Changing fallback selection, review-state persistence, backlog-assignee behavior, or launch telemetry semantics.
- Altering review-loop orchestration order, review prompts, Forgejo interactions, SQLite schema/migrations, or workflow state transitions.
- Moving unrelated helpers from `review-loop.ts`, changing public command interfaces, or redesigning review architecture beyond the two requested modules.

## Success Criteria
> **Falsifiability rule (ADR 0039 Part 2):** Each criterion must be falsifiable. Forbidden: subjective adjectives ("easy, fast, simple, intuitive, user-friendly, responsive, quick, efficient" without an attached metric) and vague quantifiers ("multiple, several, some, many, few, various"). For refactor / condense / migration missions, the criterion must enumerate the specific elements (rules, files, behaviours) that must survive — generic phrases like "preserve critical content" are not sufficient.

- SC1: `src/adapters/review/review-gate-handling.ts` owns and exports exactly the requested gate-handling symbols: `classifyGateFailure`, `runPreReviewGate`, `handleGateFailureAutoBounce`, `NO_GATE_NOTICE_ALIAS`, `strictlyLaterIso`, `DEFAULT_MAX_ATTEMPTS`, and `CONTINUE_SKIP_CHECK_TIMEOUT_MS`; it also declares/exports `PreReviewGateResult` as required by its consumers.
- SC2: `src/adapters/review/review-agent-fallback.ts` owns and exports exactly the requested fallback and stage-launch symbols: `applyAgentFallback`, `persistNormalizedPhaseRepair`, `selectPreparedReviewer`, `stageWindowKey`, `stageLaunchSinceMs`, `stageLaunchFingerprint`, `markStageLaunchRecorded`, `recordStageStatsSafe`, `getStats`, `getHandoff`, and `maybeUpdateGraphifyBeforeReview`.
- SC3: `src/adapters/review/review-loop.ts` is fewer than 1,100 physical lines and still exports `startReviewLoop`, `recordStageStatsSafe`, `applyAgentFallback`, and `maybeUpdateGraphifyBeforeReview` for its current direct consumers.
- SC4: Gate handling retains the behavior covered by `test/task-1385-pre-review-gate.test.ts`: recognized failures classify consistently, a successful or absent configured gate succeeds, failed gates retain stdout/stderr, and only relaunchable failures auto-bounce until the retry limit is reached.
- SC5: Fallback and stage-launch behavior retains the coverage in `test/review.test.ts` and `test/task-2351-review-loop-selection.test.ts`: fallback repairs the correct role without changing unrelated reviewer identity, preserves `roundStartedAt`, respects implementer assignee enforcement, handles a missing launch result, records one launch per stage window, and selects a prepared non-excluded reviewer.
- SC6: Existing callers in `src/adapters/cli/commands/active.ts`, `src/adapters/cli/commands/integrate.ts`, and `src/adapters/rebase/rebase-workflow-adapter.ts` compile against the retained review-loop exports without interface changes.
- SC7: `./scripts/verify-local.sh static-analysis` exits 0 on the completed mission tree.

## Risks and Assumptions

- Risk: extraction can create circular imports because the helpers currently share review-loop imports. Assumption: dependencies can be moved to their owning module or injected through existing function options without changing behavior.
- Risk: constants are consumed by both review-loop orchestration and review commands. Assumption: imports can be redirected while keeping a single authoritative value for each retry/timeout constant.
- Risk: fallback helpers are also used by integration and rebase paths. Assumption: retaining review-loop re-exports preserves these current import contracts during the refactor.
- Risk: lazy `getStats` and `getHandoff` imports protect test isolation and startup behavior. Assumption: their laziness remains intact after relocation.

## Checkpoints

- CP 1: Map every requested symbol, its imports, direct consumers, and relevant existing tests. Define module boundaries so gate handling owns gate execution/classification/auto-bounce and agent fallback owns identity repair, reviewer selection, stage launch tracking, telemetry, and Graphify refresh.
- CP 2: Extract `review-gate-handling.ts`, rewire `review-loop.ts`, and preserve the gate result shape, no-gate alias behavior, diagnostics capture, classification, retry count, and auto-bounce behavior covered by `test/task-1385-pre-review-gate.test.ts`.
- CP 3: Extract `review-agent-fallback.ts`, rewire and re-export its public entry points through `review-loop.ts`, and preserve fallback, stage launch, telemetry, lazy-loader, and Graphify-update behavior covered by `test/review.test.ts` and `test/task-2351-review-loop-selection.test.ts`.
- CP 4: Add or adjust focused unit tests only where extraction changes module seams or leaves a requested symbol without direct coverage; run the required static-analysis gate and record evidence for every success criterion.

### Checkpoint Documentation Requirements
Every checkpoint document (CP-N.md) MUST lead its evidence with durable forms Parallix verifies today: exact test names, ADR references, test file paths, and recognized repo commands or paths such as `npm ...`, `node ...`, `git ...`, `px ...`, or `./...`. File:line references are accepted when needed but discouraged because line numbers rot.

Every checkpoint document (CP-N.md) MUST include:
- A summary of work done
- The exact heading `## Goal Check`
- The exact 3-column pipe-delimited Markdown table `| Criterion | Evidence | Status |`
- At least one evidence row per success criterion using an accepted durable reference, including `test/task-1385-pre-review-gate.test.ts`, `test/review.test.ts`, `test/task-2351-review-loop-selection.test.ts`, exact matching test names, or a recognized command such as `./scripts/verify-local.sh static-analysis`
- Raw `stat`/`ls` output or generic prose may appear only as supplemental context; neither is sufficient alone, so pair shell output with an accepted reference above
- A non-generic `Next action:` line at the bottom

Example Goal Check table:

| Criterion | Evidence | Status |
|---|---|---|
| Gate helpers retain auto-bounce behavior | `test/task-1385-pre-review-gate.test.ts` | PASS |
| Fallback extraction preserves role repair | `test/review.test.ts` | PASS |
| Static analysis completed | `./scripts/verify-local.sh static-analysis` | PASS |

## Gates
- [ ] ./scripts/verify-local.sh static-analysis

## Restricted Areas

- `src/adapters/cli/commands/active.ts`, `src/adapters/cli/commands/integrate.ts`, and `src/adapters/rebase/rebase-workflow-adapter.ts` — preserve their current review-loop import contracts; edit only if a type-only import adjustment is unavoidable.
- `src/adapters/review/review-commands.ts` — do not fold this parallel review command implementation into the extraction.
- `src/adapters/sqlite/migrations/` and `config/state-map.json` — do not change persistence schema or state definitions.
- `src/application/` and `src/adapters/forgejo/` — do not alter workflow ports, state-machine rules, or Forgejo behavior.
- `prompts/` and `docs/` — do not modify prompts or authored documentation for this behavior-preserving refactor.

## Stop Rules

- Stop if preserving the requested review-loop re-exports requires a public-interface change in active, integrate, or rebase workflows.
- Stop if the extraction exposes a gate or fallback behavior not covered by the named tests and its intended behavior cannot be established from existing code and tests.
- Stop if resolving a circular dependency requires moving unrelated review orchestration, changing the SQLite schema, or changing workflow-state semantics.
- Stop if `./scripts/verify-local.sh static-analysis` fails for a cause outside the three scoped review adapter files and focused test updates; record the evidence and re-scope before proceeding.
