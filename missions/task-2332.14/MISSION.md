# Mission: Re-home review workflow behind an application use case (task-2332.14)

## Goal
Move review command policy and sequencing from `src/adapters/review/review-commands.ts` into an application use case (`ReviewCommandUseCase`) over explicit ports. CLI parsing, rendering, and exit mapping move to `src/interfaces/cli/review.ts`. Adapter packages implement the ports. Review state, Forgejo, retry, reviewer-selection, and Mission persistence behavior remain functionally identical.

## Why Now
The review adapter (`src/adapters/review/review-commands.ts`, ~2000 lines) directly imports and sequences git, filesystem, backlog, review-adapter, agents, verification, and runtime-matrix modules. This violates the ADR 0051 boundary rule that UI/CLI modules delegate through application ports. The draft and integrate workflows already follow this pattern (`DraftCommandUseCase` / `IntegrateCommandUseCase`). Review must catch up so the CLI dispatch layer can be unified and the adapter layer testable through port mocks.

## Refinement Signals
- Predicted NEL bucket: Medium (81–235)
- Confidence: High
- Selection note: activate as-is
- Main drivers: adapter-to-application boundary refactor; new port interface; new CLI handler; adapter slim-down; test migration

## Scope
- Create `src/application/ports/review-workflow.ts` with `ReviewWorkflowPort` interface defining review lifecycle steps (preflight, verify, submit, push, start/continue loop, comment, submit-review, consume-artifacts, close, status)
- Create `src/application/review-command-use-case.ts` as `ReviewCommandUseCase` class accepting `ReviewWorkflowPort` and delegating all review policy through port methods
- Create `src/interfaces/cli/review.ts` with `parseReviewCliRequest()` and `createReviewCommand()` following the `draft.ts` pattern
- Update `src/adapters/cli/commands/review.ts` to delegate to `ReviewCommandUseCase` via the CLI handler
- Refactor `src/adapters/review/review-commands.ts` to become the port implementation (adapter-side), keeping all existing review behavior intact
- Add fast mocked-port unit tests covering approval, requested changes, Forgejo-unavailable, retry, and reviewer-selection paths

## Out of Scope
- Changing review command flags, CLI help text, or exit codes
- Modifying review state schema (`ReviewState` class in `review-state.ts`)
- Changing Forgejo adapter behavior (`review-adapter.ts`)
- Modifying review loop orchestration (`review-loop.ts`)
- Review prompts or agent selection logic (`review-prompts.ts`)
- Review events or artifacts modules (`review-events.ts`, `review-artifacts.ts`)
- TUI review surface changes
- Performance benchmarks or load testing

## Success Criteria
> **Falsifiability rule (ADR 0039 Part 2):** Each criterion must be falsifiable. Forbidden: subjective adjectives ("easy, fast, simple, intuitive, user-friendly, responsive, quick, efficient" without an attached metric) and vague quantifiers ("multiple, several, some, many, few, various"). For refactor / condense / migration missions, the criterion must enumerate the specific elements (rules, files, behaviours) that must survive — generic phrases like "preserve critical content" are not sufficient.

- SC1: `src/application/ports/review-workflow.ts` exports `ReviewWorkflowPort` interface with methods for all review sub-commands: preflight, verify, submit, push, start, continue, comment, read-comments, submit-review, consume-artifacts, close, status, create-event, backfill-review, reconcile-review
- SC2: `src/application/review-command-use-case.ts` exports `ReviewCommandUseCase` class with constructor accepting `ReviewWorkflowPort` and an `execute(args, options)` method that dispatches to port methods based on CLI flags
- SC3: `src/interfaces/cli/review.ts` exports `parseReviewCliRequest()` (pure flag parser, no filesystem) and `createReviewCommand(useCase)` (maps parse errors to diagnostics, delegates to use case)
- SC4: `src/adapters/cli/commands/review.ts` imports `createReviewCommand` from `src/interfaces/cli/review.ts` and passes a `ReviewCommandUseCase` instance — no longer imports from `review-commands.ts` directly
- SC5: Review text output, JSON output, and exit codes for all sub-commands (`--verify`, `--submit`, `--push`, `--start`, `--continue`, `--comment`, `--submit-review`, `--status`, `--close`, `--consume-artifacts`, `--create-event`, `--backfill-review`, `--reconcile-review`) remain functionally identical to pre-migration behavior
- SC6: `src/adapters/review/review-commands.ts` no longer exports the top-level `review()` dispatcher function; it exports port-implementation methods consumed by the adapter-side `ReviewWorkflowPort` implementation
- SC7: New test file `test/task-2332.14-review-use-case.test.ts` contains at least 5 mocked-port tests covering: approval path, requested-changes path, Forgejo-unavailable path, retry-after-failure path, and reviewer-selection path
- SC8: Existing test file `test/review-commands.test.ts` still passes unchanged (tests that cover flag parsing and static review helpers)

## Risks and Assumptions
- **Risk:** `review-commands.ts` is 2000+ lines with deep import chains. Splitting into port interface + adapter implementation may require extracting shared option bags into typed port interfaces. Mitigation: keep option bags as-is in first pass; refine types in follow-up task if needed.
- **Risk:** Some review sub-commands (`startReviewLoop`, `performStaticReview`) invoke agents or run git commands inline. These must become port methods. Mitigation: port interface accepts same option shape; adapter implementation wires real functions.
- **Assumption:** TASK-2332.07 (dependency) completes or is stable enough that its review-related changes do not conflict with the port interface design.
- **Assumption:** The `review()` dispatcher in `review-commands.ts` is the sole entry point for review logic — no other module calls its sub-commands directly without going through `review()`.

## Checkpoints
- CP 1: Define `ReviewWorkflowPort` interface (`src/application/ports/review-workflow.ts`) and `ReviewCommandUseCase` class (`src/application/review-command-use-case.ts`). Verify against draft/integrate patterns.
- CP 2: Create `src/interfaces/cli/review.ts` with `parseReviewCliRequest()` and `createReviewCommand()`. Wire `src/adapters/cli/commands/review.ts` to use new handler.
- CP 3: Refactor `src/adapters/review/review-commands.ts` to become port implementation. Remove top-level `review()` dispatcher. Verify existing `test/review-commands.test.ts` still passes.
- CP 4: Add `test/task-2332.14-review-use-case.test.ts` with mocked-port tests for approval, requested-changes, Forgejo-unavailable, retry, and reviewer-selection paths. Run full verifier.

### Checkpoint Documentation Requirements
Every checkpoint document (CP-N.md) MUST include:
- A summary of work done
- A `## Goal Check` section
- A 3-column pipe-delimited markdown table with columns: Criterion | Evidence | Status
- At least one evidence row per criterion using verifiable references. Parallix already accepts:
  1. **File:line references** — e.g., `src/application/review-command-use-case.ts:12` (must point to an existing file and line)
  2. **Test names** — e.g., `"ReviewCommandUseCase dispatches approval path to port"` (must match a test name in the repo)
  3. **Test file paths** — e.g., `test/task-2332.14-review-use-case.test.ts` (must be an existing test file)
  4. **ADR references** — e.g., `ADR 0051` (must correspond to an existing file under `docs/adr/`)
  5. **Recognized repo commands or paths** — e.g., `` `npm test -- test/task-2332.14-review-use-case.test.ts` ``, `` `./scripts/verify-local.sh all` ``, or `` `git diff --name-only` ``
- Raw `stat`/`ls` output or generic prose alone is not enough; pair shell output with one of the accepted references above
- A non-generic `Next action:` line at the bottom

Example Goal Check table:

| Criterion | Evidence | Status |
|---|---|---|
| ReviewWorkflowPort interface defined | `src/application/ports/review-workflow.ts:1` | PASS |
| ReviewCommandUseCase dispatches to port | `src/application/review-command-use-case.ts:15` | PASS |
| Mocked-port test covers approval path | `test/task-2332.14-review-use-case.test.ts`, `"ReviewCommandUseCase dispatches approval path to port"` | PASS |
| Verification gate ran | `./scripts/verify-local.sh all` | PASS |

## Gates
- [ ] `./scripts/verify-local.sh all`

## Restricted Areas
- `src/adapters/review/review-adapter.ts` — Forgejo API calls unchanged
- `src/adapters/review/review-state.ts` — ReviewState class and persistence unchanged
- `src/adapters/review/review-loop.ts` — review loop orchestration unchanged
- `src/adapters/review/review-prompts.ts` — prompt templates unchanged
- `src/adapters/review/review-events.ts` — event creation unchanged
- `src/adapters/review/review-artifacts.ts` — artifact handling unchanged
- `src/adapters/review/review-polling.ts` — PR polling unchanged
- `src/adapters/review/review-state-mapping.ts` — state mapping unchanged
- `src/adapters/review/setup-review.ts` — review bootstrap unchanged
- `src/application/domain-ports.ts` — MissionStore and domain ports unchanged
- `src/application/contracts.ts` — ApplicationOutcome and related types unchanged
- `src/application/ports/cli-workflows.ts` — existing draft/integrate ports unchanged (add review port as sibling file)
- `src/interfaces/cli/runtime.ts` — CLI main dispatcher unchanged
- `test/review-commands.test.ts` — existing tests must pass; add new tests in separate file

## Stop Rules
- Stop if `review-commands.ts` sub-command functions are called directly by modules outside the review adapter (would require wider coordination beyond this mission)
- Stop if the port interface requires changes to `ReviewState` class or `MissionStore` domain port (out of scope — file follow-up task)
- Stop if `./scripts/verify-local.sh all` fails on static analysis (ESLint + tsc --checkJs) for more than 30 minutes of debugging (file blocking issue)
- Stop if the number of new files exceeds 3 (port, use case, CLI handler); if more are needed, consolidate into fewer files
