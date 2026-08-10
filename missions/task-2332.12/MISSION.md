# Mission: Re-home rebase workflow behind an application use case (task-2332.12)

## Goal
Move all rebase workflow policy — selected-root, conflict classification/resolution, hook-failure rebounce, review push, and lifecycle decisions — into a single application-layer use case consumed through explicit ports. The CLI command adapter becomes a thin shell: parse flags, delegate to use case, render result, map exit code.

## Why Now
The rebase command (`src/adapters/cli/commands/rebase.ts`, 950 lines) directly imports 8+ adapter packages (git, agents, forgejo, backlog, review, config, verification, filesystem). This violates the application-boundary rule established by TASK-2332.07 (integrate extraction). Conflict-resolution behavior is a command-to-command dependency instead of an application port. This blocks TASK-2332.14 (review re-home) and TASK-2332.13 (status/checkpoint re-home) which share the same pattern.

## Refinement Signals
- Predicted NEL bucket: Medium (81–235)
- Confidence: High
- Selection note: activate as-is
- Main drivers: 950-line monolithic rebase adapter; 8+ direct adapter imports; new use case + port + CLI interface files; 48 existing tests to adapt; pattern proven by integrate extraction

## Scope
- Create `RebaseWorkflowPort` in `src/application/ports/cli-workflows.ts` (or new port file)
- Create `RebaseCommandUseCase` class in `src/application/` mirroring `IntegrateCommandUseCase` pattern
- Create `src/interfaces/cli/rebase.ts` for CLI parsing, rendering, exit mapping
- Move rebase policy logic (slug inference, root selection, conflict classification, hook rebounce, push, verification hints) into use case
- Wire composition root so `px rebase` calls through use case
- Adapt existing tests (`test/rebase.test.ts`, `test/rebase_hardening.test.ts`, `test/rebase_diagnostics.test.ts`) to mock-port pattern
- Add fast mocked-port tests for: clean rebase, conflicts, hook failure, rebounce, selected-root rejection

## Out of Scope
- Changes to `handleHookFailureAutoBounce` algorithm or retry budget (preserve behavior)
- Changes to conflict classification heuristics (`parseConflictFilesFromGitStatus`, `parseConflictFilesFromRebaseOutput`)
- Changes to `buildRebasePrompt` content
- Forgejo integration behavior (token resolution, PR creation)
- Task-2332.07 integrate conflict resolution (dependency, not in-scope work)
- CLI flag additions or removals (preserve `--push` and positional slug)

## Success Criteria
- SC1: `src/adapters/cli/commands/rebase.ts` delegates to exactly one `RebaseCommandUseCase` instance and imports no more than 2 adapter packages (down from 8+).
- SC2: `RebaseCommandUseCase` class exists under `src/application/` and accepts ports matching `RebaseWorkflowPort` interface.
- SC3: `RebaseWorkflowPort` interface declared in `src/application/ports/` and lists all external dependencies (git, agents, forgejo, backlog, review, config, filesystem, verification) as port methods.
- SC4: `src/interfaces/cli/rebase.ts` exists and owns flag parsing (`parseIntegrateCliRequest`-style), rendering, and exit code mapping.
- SC5: Existing 48 tests across `test/rebase.test.ts`, `test/rebase_hardening.test.ts`, `test/rebase_diagnostics.test.ts` all pass with mocks (no real git/forgejo).
- SC6: New mocked-port tests cover: clean rebase (no conflicts), mission-specific conflict auto-resolve, shared-file conflict agent launch, hook failure auto-bounce, selected-root rejection (wrong branch).
- SC7: `px rebase` CLI behavior unchanged: same args, same output format, same exit codes for all paths.
- SC8: Static analysis (`./scripts/verify-local.sh static-analysis`) clean on all changed files.

## Risks and Assumptions
- R1: `handleHookFailureAutoBounce` depends on `missionServicesFn` seam; use case must preserve this injection pattern. Assumption: seam signature stable.
- R2: Conflict resolution calls `integrate.resolveConflictsForMission` — this cross-command dependency must become a port method. Assumption: TASK-2332.07 contract stable.
- R3: Existing tests use `mockModule` for ESM seam; port mocks must coexist. Assumption: `module-mock` pattern compatible with port injection.
- A1: Integrate extraction pattern (`IntegrateCommandUseCase` + `IntegrateWorkflowPort` + `src/interfaces/cli/integrate.ts`) is the target architecture.
- A2: No new CLI flags introduced; rebase preserves `--push` and positional slug only.

## Checkpoints
- CP 1: Define `RebaseWorkflowPort` interface and `RebaseCommandUseCase` class. List all port methods from current adapter imports. Verify port surface matches integrate pattern.
- CP 2: Move rebase policy logic into use case. CLI adapter delegates to use case. Existing tests adapt to mock ports. All 48 tests pass.
- CP 3: Create `src/interfaces/cli/rebase.ts` with flag parsing and rendering. Wire composition root. Add new mocked-port tests for all 5 scenarios. Static analysis clean.

### Checkpoint Documentation Requirements
Every checkpoint document (CP-N.md) MUST include:
- A summary of work done
- A `## Goal Check` section
- A 3-column pipe-delimited markdown table with columns: Criterion | Evidence | Status
- At least one evidence row per criterion using verifiable references. Parallix already accepts:
  1. **File:line references** — e.g., `src/application/rebase-command-use-case.ts:12` (must point to an existing file and line)
  2. **Test names** — e.g., `"clean rebase completes without conflicts"` (must match a test name in the repo)
  3. **Test file paths** — e.g., `test/rebase.test.ts` (must be an existing test file)
  4. **ADR references** — e.g., `ADR 0051` (must correspond to an existing file under `docs/adr/`)
  5. **Recognized repo commands or paths** — e.g., `` `./scripts/verify-local.sh static-analysis` ``, `` `node --test test/rebase.test.ts` ``, or `` `git diff --stat` ``
- Raw `stat`/`ls` output or generic prose may appear as supplemental context, but pair them with one of the accepted references above
- A non-generic `Next action:` line at the bottom

Example Goal Check table:

| Criterion | Evidence | Status |
|---|---|---|
| RebaseWorkflowPort interface defined | `src/application/ports/cli-workflows.ts:45` | PASS |
| Clean rebase test passes | `test/rebase.test.ts`, `"clean rebase completes without conflicts"` | PASS |
| Static analysis clean | `./scripts/verify-local.sh static-analysis` | PASS |

## Gates
- [ ] `./scripts/verify-local.sh all`

## Restricted Areas
- `src/adapters/git/` — no changes to git utility functions
- `src/adapters/agents/` — no changes to agent launch/select
- `src/adapters/forgejo/` — no changes to Forgejo integration
- `src/adapters/backlog/` — no changes to task resolution
- `src/adapters/review/` — no changes to review state or review loop
- `src/adapters/config/` — no changes to product config
- `src/adapters/verification/` — no changes to verification formatting
- `src/adapters/filesystem/` — no changes to mission utils
- `test/lib/module-mock.ts` — no changes to mock infrastructure

## Stop Rules
- Stop if `handleHookFailureAutoBounce` seam requires >10 lines of signature change (beyond port injection).
- Stop if conflict resolution port (`resolveConflictsForMission`) needs behavior changes beyond renaming — that is TASK-2332.07 scope.
- Stop if `buildRebasePrompt` or `parseConflictFilesFrom*` functions need algorithmic changes — those are hardening, not re-homing.
- Stop if static analysis introduces >5 new warnings across changed files.
- Stop if any existing test fails for a reason other than missing port mock (indicates behavior drift).
