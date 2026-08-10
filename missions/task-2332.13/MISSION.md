# Mission: Re-home status and checkpoint workflows behind application use cases (task-2332.13)

## Goal
Move the bounded `status` and `checkpoint` command workflows from CLI adapters into dedicated application use cases, with focused application ports and explicit composition of the existing filesystem, backlog, git, Forgejo, projection, verification, and lifecycle adapters. Preserve the established CLI-visible behavior while making interfaces responsible only for argument handling, rendering, and exit mapping.

## Why Now
The two commands currently let CLI adapters coordinate domain workflow policy and multiple adapter packages. That blurs the application boundary, makes policy difficult to exercise with mocked ports, and blocks the architectural direction established by TASK-2332.07. Isolating these workflows now gives future interfaces one stable application entry point per use case.

## Refinement Signals
- Predicted NEL bucket: Medium (81–235)
- Confidence: High
- Selection note: The acceptance criteria identify the two workflows, boundary placement, required behavior cases, and compatibility constraint without needing product decisions.
- Main drivers: extract two orchestration flows; define focused ports; rewire CLI composition; relocate CLI-only concerns; add mocked-port coverage for four outcome paths; preserve existing command output and exit behavior.

## Scope
- Extract one application use case for status projection and one application use case for checkpoint execution under `src/application/`.
- Define the focused application ports each use case needs, using the existing adapters for backlog, git, Forgejo, mission/worktree data, board projection, verification, and lifecycle operations.
- Change each status and checkpoint adapter so it delegates to exactly one application use case instead of sequencing adapter packages itself.
- Move status/checkpoint CLI argument parsing, output rendering, and process exit-code mapping into `src/interfaces/cli/`, and compose concrete adapters at the CLI boundary.
- Add fast unit tests with mocked application ports for status projection, successful checkpointing, verification failure, and lifecycle rejection.
- Retain compatible status and checkpoint CLI output and exit behavior for the existing supported command invocations.

## Out of Scope
- Changing the public syntax, flags, output format, or documented semantics of the status or checkpoint commands.
- Replacing or redesigning the existing backlog, git, Forgejo, filesystem, verification, lifecycle, or board-projection adapters.
- Migrating unrelated CLI commands or performing a repository-wide package-layer reorganization.
- Changing mission-state rules, verification policy, or lifecycle authorization rules beyond relocating their existing orchestration.
- Starting review, execution, integration, or a remote push as part of this mission's work.

## Success Criteria
> **Falsifiability rule (ADR 0039 Part 2):** Each criterion must be falsifiable. Forbidden: subjective adjectives ("easy, fast, simple, intuitive, user-friendly, responsive, quick, efficient" without an attached metric) and vague quantifiers ("multiple, several, some, many, few, various"). For refactor / condense / migration missions, the criterion must enumerate the specific elements (rules, files, behaviours) that must survive — generic phrases like "preserve critical content" are not sufficient.

- SC1: `status` and `checkpoint` each call one dedicated application use case; neither CLI adapter coordinates calls across two or more adapter packages.
- SC2: The status use case obtains its required task, git/worktree, pull-request, agent/measurement/history, and board-projection information through declared application ports, and the checkpoint use case obtains its lifecycle and verification decisions through declared application ports.
- SC3: All status/checkpoint parsing, CLI rendering, and exit-code mapping are located under `src/interfaces/cli/`; application use cases return interface-neutral results rather than writing to stdout/stderr or terminating the process.
- SC4: Fast mocked-port tests cover these four cases: status produces a board projection; checkpoint succeeds when verification and lifecycle acceptance succeed; checkpoint reports verification failure; checkpoint rejects a disallowed lifecycle transition.
- SC5: Existing supported status and checkpoint invocations retain their prior observable output structure and exit-code outcomes, as demonstrated by updated focused tests.
- SC6: `./scripts/verify-local.sh all` completes successfully on the final tree without focused tests, unannotated skips, or real Forgejo access from unit tests.

## Risks and Assumptions
- Assumption: TASK-2332.07 provides the application-boundary conventions this mission should follow; if its API differs from the needed seams, adapt this mission's ports rather than adding a parallel architectural pattern.
- Risk: status depends on a broad set of existing adapter calls (backlog, git, Forgejo, mission utilities, measurements, operation history, and board readers), so moving orchestration can subtly alter projection ordering or rendered fields.
- Risk: checkpoint failure ordering can change user-visible errors or exit codes when verification and lifecycle checks are moved; focused failure-path tests must lock the present ordering.
- Assumption: CLI output compatibility means preserving the existing supported command outputs and exit mapping, not introducing a new machine-readable format.
- Risk: tests that leave a concrete adapter unmocked may invoke real Forgejo or costly CLI processes; every unit-test dependency must be explicitly mocked.

## Checkpoints
- CP 1: Trace the current status and checkpoint orchestration, identify the exact collaborators and CLI-only responsibilities, and define the two use-case input/result contracts plus focused port interfaces. Record which existing output and exit behaviors must remain stable.
- CP 2: Implement and wire the status application use case and CLI boundary. Cover the mocked status board-projection path and confirm parsing, rendering, and exit mapping remain in `src/interfaces/cli/`.
- CP 3: Implement and wire the checkpoint application use case and CLI boundary. Cover mocked checkpoint success, verification-failure, and lifecycle-rejection paths, then verify the retained observable CLI behavior and full repository gate.

### Checkpoint Documentation Requirements
Every checkpoint document (CP-N.md) MUST include:
- A summary of work done.
- The exact heading `## Goal Check`.
- A 3-column pipe-delimited Markdown table with this exact header: `| Criterion | Evidence | Status |`.
- At least one evidence row for every success criterion. Accepted evidence forms already verified by Parallix are file:line references, exact test names, ADR references, existing test file paths, and recognized repository commands or paths such as backticked `npm ...`, `node ...`, `git ...`, `px ...`, or `./...`.
- Raw `stat`/`ls` output or generic prose alone is not enough. It may be supplemental, but pair shell output with an accepted file:line reference, exact test name, ADR reference, test path, or recognized repository command/path.
- A concrete `Next action:` line at the bottom that names the next implementation or verification action.

## Gates
- [ ] ./scripts/verify-local.sh all

## Restricted Areas
- Do not modify the public command syntax, flags, user-facing output contract, or exit-code contract for `status` and `checkpoint` without explicit approval.
- Do not alter unrelated CLI commands, adapter implementations, mission lifecycle rules, verification policy, or board-projection semantics.
- Keep unit tests isolated from real Forgejo and expensive CLI/agent processes by mocking all external ports.
- Preserve the backlog task's `assignee` field and do not move, rename, or delete its file.

## Stop Rules
- Stop and request direction if preserving current status or checkpoint output requires a public CLI behavior change.
- Stop and request direction if TASK-2332.07 does not provide a compatible application-boundary convention and the only path is to introduce a competing architecture.
- Stop and request direction if a focused unit test requires real Forgejo, a network call, or an expensive agent/CLI process to validate the intended behavior.
- Stop and request direction if the full verifier exposes failures outside the status/checkpoint boundary that cannot be resolved without expanding this mission's scope.
