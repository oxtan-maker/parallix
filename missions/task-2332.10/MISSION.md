# Mission: Re-home draft workflow behind an application use case (task-2332.10)

## Goal

Move the complete draft workflow from `src/adapters/cli/commands/draft.ts` into
an application use case over explicit ports. Keep CLI request parsing, rendering,
and exit-code mapping in `src/interfaces/cli/draft.ts`. Composition supplies
concrete Git, Backlog, filesystem, verification, asset, agent, and config
adapters. Preserve all public draft behavior — branch creation, worktree setup,
MISSION.md scaffolding, backlog bootstrapping, graphify workspace, agent launch,
classification normalization, label sync, commit safety, and lifecycle transitions.

## Why Now

TASK-2332.07 established the extraction pattern with the `integrate` command:
`IntegrateCommandUseCase`, `IntegrateWorkflowPort`, and `src/interfaces/cli/integrate.ts`.
Draft is the next workflow in the TASK-2332 sequence. It can develop in parallel
with handoff (TASK-2332.09) since both are independently reviewed. The current
`draft.ts` is a 600+ line orchestrator directly sequencing Git, Backlog, agents,
filesystem, config, verification, and stats adapters — the exact anti-pattern
TASK-2332.07 resolved for integrate.

## Refinement Signals
- Predicted NEL bucket: Medium (81–235)
- Confidence: High
- Selection note: activate as-is
- Main drivers: single large file refactor (draft.ts ~600 lines), new port interface, new use case, new CLI interface module, composition wiring, and mocked-port test suite

## Scope

- Create `DraftWorkflowPort` in `src/application/ports/cli-workflows.ts`
- Create `DraftCommandUseCase` in `src/application/draft-command-use-case.ts`
- Create `src/interfaces/cli/draft.ts` with `DraftCliRequest`, parsing function,
  and `createDraftCommand()` factory
- Refactor `src/adapters/cli/commands/draft.ts` to implement `DraftWorkflowPort`
  (adapter delegates orchestration to use case; helper functions stay in adapter)
- Update `src/composition/create-cli.ts` to wire draft through the use case
  (same pattern as integrate)
- Add fast mocked-port unit tests covering: normal draft, invalid input (no slug),
  existing mission (conflict on intake), and verification failure — all without
  real agent CLIs
- Preserve existing draft observable behavior (branch naming, worktree layout,
  MISSION.md scaffold, backlog bootstrap, graphify copy, agent launch, classification
  normalization, label sync, commit safety, task transitions)

## Out of Scope

- Handoff workflow extraction: TASK-2332.09.
- Stats workflow extraction: TASK-2332.11.
- Rebase workflow extraction: TASK-2332.12.
- Status and checkpoint workflow extraction: TASK-2332.13.
- Review workflow extraction: TASK-2332.14.
- Final responsibility-guard certification: TASK-2332.08.
- New user-facing behavior, new CLI flags, or new adapter implementations.
- Migration of `draft_preflight_modern.test.ts` or `draft.test.ts` — existing
  tests remain as characterization coverage; new tests use mocked ports.
- Changes to the draft prompt template (`prompts/draft.md`) or agent selection logic.

## Success Criteria

- SC1: `src/adapters/cli/commands/draft.ts` exports a class or object implementing
  `DraftWorkflowPort` and delegates to `DraftCommandUseCase`; it no longer directly
  imports and sequences multiple adapter packages (git, backlog, agents, filesystem,
  config, verification, stats) at the top of `runDraftCommand`.
- SC2: `DraftCommandUseCase` in `src/application/draft-command-use-case.ts` owns
  the complete workflow sequence — branch, worktree, MISSION.md scaffold, backlog
  bootstrap, graphify, agent launch, intake, classification, label sync, commit
  safety, and lifecycle transitions — through port methods.
- SC3: `src/interfaces/cli/draft.ts` contains `DraftCliRequest`, a parsing function
  for `--agent` flag and positional slug, and `createDraftCommand()` factory.
- SC4: `src/composition/create-cli.ts` wires draft as
  `createDraftCommand(new DraftCommandUseCase(…))` matching the integrate pattern.
- SC5: New mocked-port test file `test/draft-command.test.ts` (or added tests in
  existing file) covers at minimum: normal draft flow, missing slug exit, intake
  conflict path, and classification normalization restart — all using injected
  function doubles, no real git/agent/agent CLI calls.
- SC6: Existing draft test files (`test/draft-command.test.ts`,
  `test/draft_preflight_modern.test.ts`, `test/draft.test.ts`) still pass unchanged.
- SC7: Static analysis (`./scripts/verify-local.sh all`) passes clean on all
  changed files with no new focused or unannotated skipped tests.

## Risks and Assumptions

- **Risk**: `draft.ts` has many internal helper functions (ensureMissionBranch,
  ensureWorktree, ensureGraphifyWorkspace, ensureMissionFile, bootstrapBacklogTask,
  enforceDraftCommitSafety, etc.) that are currently exported for testing. Moving
  orchestration to a use case may require keeping these as adapter-level helpers
  or promoting some to port methods. Decision: keep them in adapter module,
  accessible through port.
- **Risk**: The draft command currently accepts a large dependency injection object
  in `runDraftCommand`. The use case pattern uses a port interface instead. Mapping
  the existing DI shape to port methods requires careful type alignment.
- **Assumption**: TASK-2332.07's integrate pattern is stable and serves as the
  canonical template. No changes to `IntegrateCommandUseCase` or `IntegrateWorkflowPort`
  are needed.
- **Assumption**: The `missionServicesFn` injection pattern used by draft, handoff,
  rebase, and review commands remains the mechanism for supplying mission lifecycle
  services to the use case.
- **Assumption**: Draft can be reviewed independently — integration with handoff
  (TASK-2332.09) happens at the TASK-2332.08 certification gate.

## Checkpoints

- CP 1: Define `DraftWorkflowPort` interface in `src/application/ports/cli-workflows.ts`
  and `DraftCommandUseCase` in `src/application/draft-command-use-case.ts`. Wire
  into `src/composition/create-cli.ts` using the integrate pattern. Verify
  `./scripts/verify-local.sh all` passes with no draft behavior change.
- CP 2: Create `src/interfaces/cli/draft.ts` with `DraftCliRequest`, parsing,
  and `createDraftCommand()`. Move `--agent` flag parsing and positional slug
  resolution from adapter into interface. Update composition wiring.
- CP 3: Refactor `src/adapters/cli/commands/draft.ts` to implement `DraftWorkflowPort`.
  Move orchestration logic from `runDraftCommand` into use case via port methods.
  Keep helper functions (ensureMissionBranch, ensureWorktree, etc.) in adapter
  module. Add mocked-port unit tests. Verify all existing tests still pass.

### Checkpoint Documentation Requirements

Every checkpoint document (CP-N.md) MUST include:
- A summary of work done
- A `## Goal Check` section
- A 3-column pipe-delimited markdown table with columns: Criterion | Evidence | Status
- At least one evidence row per criterion using verifiable references. Parallix already accepts:
  1. **File:line references** — e.g., `src/application/draft-command-use-case.ts:12` (must point to an existing file and line)
  2. **Test names** — e.g., `"runDraftCommand top-level flows are covered with injected dependencies"` (must match a test name in the repo)
  3. **Test file paths** — e.g., `test/draft-command.test.ts` (must be an existing test file)
  4. **ADR references** — e.g., `ADR 0036` (must correspond to an existing file under `docs/adr/`)
  5. **Recognized repo commands or paths** — e.g., `` `./scripts/verify-local.sh all` ``, `` `npm test -- test/draft-command.test.ts` ``, or `` `git diff --stat` ``
- Raw `stat`/`ls` output or generic prose may appear as supplemental context, but pair them with one of the accepted references above
- A non-generic `Next action:` line at the bottom

Example Goal Check table:

| Criterion | Evidence | Status |
|---|---|---|
| DraftWorkflowPort defined | `src/application/ports/cli-workflows.ts:3` | PASS |
| DraftCommandUseCase owns workflow | `src/application/draft-command-use-case.ts:1` | PASS |
| Mocked-port tests cover normal draft | `test/draft-command.test.ts`, `"runDraftCommand top-level flows are covered with injected dependencies"` | PASS |
| Verification gate ran | `./scripts/verify-local.sh all` | PASS |

## Gates

- [ ] `./scripts/verify-local.sh all`

## Restricted Areas

- `src/interfaces/cli/runtime.ts` — shared CLI runtime, not draft-specific
- `src/adapters/cli/commands/stats.ts` — shared by draft and other commands
- `src/application/presentation/cli-format.ts` — shared formatting, not draft-specific
- `prompts/draft.md` — draft prompt template, unchanged this mission
- `src/domain/mission.ts` — domain types, not modified this mission
- `src/adapters/config/product-config.ts` — shared config, not modified this mission

## Stop Rules

- Stop if draft's public CLI contract (args, exit codes, output text) changes
  without explicit acceptance from the TASK-2332 parent.
- Stop if `missionServicesFn` injection pattern requires structural changes
  (e.g., new parameter shape) — defer to TASK-2332.08 certification.
- Stop if the number of port methods exceeds 12 — reconsider which helpers
  belong in the port vs. adapter internals.
- Stop if existing draft tests regress without a clear characterization reason.
