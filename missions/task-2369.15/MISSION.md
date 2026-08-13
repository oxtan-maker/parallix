# Mission: Split draft command setup, prompts, conflicts, and stats (task-2369.15)

## Goal
Refactor `src/adapters/cli/commands/draft.ts` into a thin draft-command entry point and four concern-specific modules without changing the draft workflow's externally observable behavior.

## Why Now
At 1,293 lines, the draft command combines orchestration with worktree setup, prompt construction, conflict policy, and workflow statistics. This makes targeted changes risky because unrelated workflow rules live together and are difficult to test or review independently.

## Refinement Signals
- Predicted NEL bucket: Large (235+)
- Confidence: High
- Selection note: activate as-is
- Main drivers: move four explicitly enumerated responsibility groups into new modules, preserve the draft command's import/export surface and workflow behavior, and reduce `draft.ts` below 300 lines.

## Scope
- Extract worktree, branch, repository, graphify, mission-file, and backlog bootstrap helpers into `src/adapters/cli/commands/draft-setup.ts`: `ensureMissionBranch()`, `ensureMissionBaseBranchRecorded()`, `ensureWorktree()`, `ensureGraphifyWorkspace()`, `ensureGraphifyIgnore()`, `ensureMissionFile()`, `ensureDraftRepoConfigCommitted()`, `ensureRepoExists()`, `bootstrapBacklogTask()`, `resolveDraftTarget()`, `slugifyDraftIntent()`, `syntheticTaskId()`, and `SYNTHETIC_SLUG_PREFIX`.
- Extract draft and restart prompt construction plus classification and verification-command resolution into `src/adapters/cli/commands/draft-prompts.ts`: `buildDraftPrompt()`, `buildRestartPrompt()`, `fallbackDraftCommitMessage()`, `resolveMissionClassificationResolver()`, `validateDraftClassification()`, `normalizeDraftClassification()`, `resolveVerifyCmd()`, `resolveTaskPath()`, and `resolveClassificationInstructions()`.
- Extract dirty-worktree parsing and draft-conflict policy into `src/adapters/cli/commands/draft-conflicts.ts`: `classifyDraftEntries()`, `isUnmergedStatus()`, `isDeletedStatus()`, `isMissionTaskPath()`, `isExpectedDraftPath()`, `parseDirtyEntry()`, `resolveMissionSpecificDraftConflicts()`, and `enforceDraftCommitSafety()`.
- Extract draft stats, implementer tracking, restart behavior, and workflow-adapter creation into `src/adapters/cli/commands/draft-stats.ts`: `recordDraftStats()`, `recordDraftImplementer()`, `restartDraftAgent()`, and `createDraftWorkflowAdapter()`.
- Update `draft.ts` to compose the extracted modules, retain required exports, and contain fewer than 300 lines.
- Add or adjust fast, dependency-mocked unit coverage for the extracted module boundaries and preserve existing draft workflow coverage.

## Out of Scope
- Changing the draft command's user-facing CLI arguments, output, branch/worktree policy, graphify policy, prompt semantics, conflict-resolution policy, or statistics schema.
- Moving helpers not enumerated in Scope, reorganizing other CLI commands, or performing unrelated cleanup.
- Changing mission lifecycle behavior or contacting a real Forgejo instance from tests.

## Success Criteria
> **Falsifiability rule (ADR 0039 Part 2):** Each criterion must be falsifiable. Forbidden: subjective adjectives ("easy, fast, simple, intuitive, user-friendly, responsive, quick, efficient" without an attached metric) and vague quantifiers ("multiple, several, some, many, few, various"). For refactor / condense / migration missions, the criterion must enumerate the specific elements (rules, files, behaviours) that must survive — generic phrases like "preserve critical content" are not sufficient.

- `src/adapters/cli/commands/draft.ts` contains fewer than 300 lines and delegates the four named responsibility groups to `draft-setup.ts`, `draft-prompts.ts`, `draft-conflicts.ts`, and `draft-stats.ts`.
- Each function and constant listed in Scope is defined in its designated extracted module; `draft.ts` retains or re-exports the symbols required by existing imports and tests.
- The draft workflow preserves branch and worktree setup, graphify workspace/bootstrap handling, mission/backlog bootstrap, prompt and classification validation, dirty-entry conflict classification, commit-safety enforcement, stats recording, implementer recording, restart behavior, and workflow-adapter creation.
- Focused unit tests covering each extracted concern pass without real Forgejo access or expensive agent/CLI recursion.
- `./scripts/verify-local.sh static-analysis` passes on the refactored tree.

## Risks and Assumptions
- Circular imports or missing re-exports can break consumers of helpers formerly co-located in `draft.ts`.
- Moving closure-dependent functions can subtly change injected dependency wiring, especially for prompt classification, conflict handling, and workflow stats.
- Test changes must retain mocks so no unit test invokes real Forgejo, a full agent, or a performance-heavy CLI command.
- Assumption: the existing draft command behavior is the source of truth; this mission does not intentionally alter it.

## Checkpoints
- CP 1: Map every scoped symbol's current dependencies and consumers, create the four destination modules, and move the setup, prompt, conflict, and stats responsibility groups with explicit imports and exports.
- CP 2: Reduce `draft.ts` to command orchestration plus required re-exports, resolve circular dependencies, and add or adapt isolated mocked unit tests for all four extracted boundaries.
- CP 3: Run the static-analysis gate, confirm the entry-point line-count and behavior-preservation criteria, and prepare checkpoint evidence for handoff.

### Checkpoint Documentation Requirements
Every checkpoint document (CP-N.md) MUST include a summary of work done and lead its evidence with durable, verifiable forms Parallix verifies today: exact test names, ADR references, test file paths, and recognized repository commands or paths such as `npm ...`, `node ...`, `git ...`, `px ...`, or `./...`. File:line references are accepted parenthetically when needed but discouraged because line numbers rot.

Use the exact heading `## Goal Check` followed by this 3-column pipe-delimited table:

| Criterion | Evidence | Status |
|---|---|---|

Include at least one evidence row for every Success Criterion. Record the relevant extracted-module path, an exact focused test name or test path, and the applicable verification command; use `./scripts/verify-local.sh static-analysis` for the final validation evidence. Raw `stat`/`ls` output or generic prose alone is not enough: if included as supplemental context, pair it with one of the accepted references above. End every checkpoint document with a specific `Next action:` line that names the next extraction, test, or verification action.

Example Goal Check table:

| Criterion | Evidence | Status |
|---|---|---|
| Draft entry point is below 300 lines | `src/adapters/cli/commands/draft.ts` | PASS |
| Prompt extraction preserves draft behavior | exact focused test name and its `test/` path | PASS |
| Static analysis completed | `./scripts/verify-local.sh static-analysis` | PASS |

## Gates
- [ ] ./scripts/verify-local.sh static-analysis
- [ ] ./scripts/verify-local.sh all

## Restricted Areas
- Do not change the draft command's CLI contract, mission lifecycle semantics, or user-visible prompt wording except where a move requires equivalent module imports.
- Do not edit unrelated commands, generated graph artifacts, mission/backlog workflow files, or repository-wide configuration as part of this refactor.
- Keep unit tests isolated with mocks; they must not access real Forgejo, launch real agents, or trigger expensive recursive CLI workflows.

## Stop Rules
- Stop and request direction if preserving the current behavior requires changing a public CLI contract, statistics schema, branch/worktree policy, graphify policy, or conflict-resolution policy.
- Stop and request direction if a scoped helper is also a required dependency of another command and retaining compatibility cannot be achieved through explicit exports or re-exports.
- Stop and investigate before proceeding if focused tests attempt real Forgejo access, start an agent, or invoke a heavy recursive CLI command; replace the dependency with a mock rather than allowing the test to run live.
