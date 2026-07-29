# Mission: Route mission intake, checkpoint, and handoff through application use cases (task-2322.05)

## Goal
Move the covered Mission lifecycle operations behind checked application use cases and a Mission repository port, while production continues to use its single compatibility persistence authority until TASK-2322.07.

## Why Now
TASK-2322.03 established the domain and boundary direction. Intake, activation, checkpoint mutation, handoff, and NEL recording still need an application-facing path that can be exercised with isolated SQLite adapters without splitting production lifecycle authority or changing the live composition root.

## Refinement Signals
- Predicted NEL bucket: Large (235+)
- Confidence: High
- Selection note: activate as-is
- Main drivers: introduce checked use cases for intake, lifecycle transitions, checkpoint persistence, handoff, and NEL records; preserve existing CLI/UI observable behavior; prove the new boundary with isolated SQLite fixtures; prevent filesystem and SQL persistence from leaking into covered application/UI modules.

## Scope
- Add application use cases that materialize Mission intake with `RepositoryId` and optional external-task traceability, without persisting a task-catalog lifecycle aggregate.
- Route activation and every lifecycle transition covered by this mission through the Mission repository port, enforcing domain transition policy and optimistic version checks.
- Route checkpoint writes and reads through `Mission.CheckpointData`, retaining the existing `GoalCheckRow` behavior without exposing persistence file paths or SQL schema to application code.
- Route handoff and structured NEL recording through the checked Mission boundary; retain large generated artifacts as references rather than database blobs.
- Characterize and preserve the covered CLI and shared UI command-controller success paths, failures, and ordering of external Git or agent effects.
- Add isolated SQLite-adapter coverage for the new application boundary while production retains exactly one selected compatibility authority.
- Remove direct filesystem persistence and SQL from application/UI modules for the covered Mission behavior.

## Out of Scope
- Switching the production composition root from the compatibility authority to SQLite.
- Dual-writing, reconciliation, fallback, or read-through behavior between compatibility and SQLite stores.
- Persisting or modeling external task material as a second task-catalog lifecycle aggregate.
- Replacing the compatibility authority before TASK-2322.07.
- Redesigning unrelated Mission lifecycle transitions, CLI commands, UI flows, Git integration, agent integration, or generated-artifact storage.

## Success Criteria
> **Falsifiability rule (ADR 0039 Part 2):** Each criterion must be falsifiable. Forbidden: subjective adjectives ("easy, fast, simple, intuitive, user-friendly, responsive, quick, efficient" without an attached metric) and vague quantifiers ("multiple, several, some, many, few, various"). For refactor / condense / migration missions, the criterion must enumerate the specific elements (rules, files, behaviours) that must survive — generic phrases like "preserve critical content" are not sufficient.

- SC1 — Mission intake creates a checked `Mission` containing its `RepositoryId` and any supplied external-task trace reference, and no task-catalog aggregate is written by that flow.
- SC2 — Activation and each lifecycle transition changed by this mission invoke a Mission repository port, reject invalid domain transitions, and reject stale expected versions.
- SC3 — Checkpoint data round-trips through `Mission.CheckpointData`, including the existing `GoalCheckRow` semantics, and the corresponding use case has no persistence file-path or SQL-schema input.
- SC4 — Handoff records structured NEL data through the checked Mission boundary; tests demonstrate that large generated artifacts are stored as references rather than SQLite blob payloads.
- SC5 — Characterization tests cover each changed CLI and shared UI command-controller operation, including its failure result and the ordering of externally observable Git or agent effects.
- SC6 — SQLite-backed tests use isolated fixtures, while production selects one compatibility authority and has no command path that dual-writes, reconciles, or falls back between compatibility and SQLite stores.
- SC7 — The changed application and UI modules for covered Mission behavior contain no direct filesystem persistence or SQL access; persistence is reached through the applicable port/use-case boundary.

## Risks and Assumptions
- Risk: compatibility behavior may depend on undocumented ordering of external Git or agent effects. Assumption: existing CLI and controller tests can be expanded into characterization coverage before rerouting each operation.
- Risk: introducing SQLite fixtures could accidentally alter production authority selection. Assumption: fixture wiring remains test-only and the live composition root is not switched in this mission.
- Risk: checkpoint and NEL shapes may currently be coupled to file or SQL representations. Assumption: the domain types can represent the required data without embedding persistence details.
- Risk: external task material could become a second lifecycle source of truth. Assumption: it is carried only as intake traceability on Mission.

## Checkpoints
- CP 1: Map the covered intake, activation, checkpoint, handoff, and NEL call paths; add or extend characterization tests that capture current CLI/controller results, failures, and external-effect ordering.
- CP 2: Define the checked Mission application use cases, repository-port interactions, intake traceability data, transition/version checks, and domain-shaped checkpoint/NEL contracts; prove them with isolated SQLite fixtures.
- CP 3: Reroute covered CLI and shared UI command-controller paths through the use cases; remove direct filesystem/SQL persistence from the covered application/UI behavior without changing the production compatibility authority.
- CP 4: Run the required gate, update graph context if code changed, and write final checkpoint evidence that maps every success criterion to code and test proof.

### Checkpoint Documentation Requirements
Every checkpoint document (CP-N.md) MUST include:
- A summary of work done
- The exact heading `## Goal Check`
- The exact 3-column pipe-delimited table header `| Criterion | Evidence | Status |`
- At least one evidence row per criterion using verifiable references. Parallix already accepts:
  1. **File:line references** — e.g., `lib/commands/handoff.ts:292` (must point to an existing file and line)
  2. **Test names** — e.g., `"real custom-agent launcher smoke: full lifecycle with hello-world task (SC3/SC4/SC5/SC6/SC7)"` (must match a test name in the repo)
  3. **Test file paths** — e.g., `test/e2e-real-agent-smoke.test.ts` (must be an existing test file)
  4. **ADR references** — e.g., `ADR 0048` (must correspond to an existing file under `docs/adr/`)
  5. **Recognized repo commands or paths** — e.g., `` `npm test -- test/repair-handoff.test.ts` ``, `` `px review <slug> --verify` ``, or `` `./scripts/verify-local.sh all` ``
- Raw `stat`/`ls` output or generic prose alone is not enough; it may appear only as supplemental context and must be paired with one of the accepted references above.
- A non-generic `Next action:` line at the bottom

Example Goal Check table:

| Criterion | Evidence | Status |
|---|---|---|
| Draft prompt defines checkpoint evidence rules | `prompts/draft.md:28` | PASS |
| Repair loop has targeted incomplete-evidence coverage | `test/repair-handoff.test.ts`, `"buildRelaunchPrompt returns string containing Goal Check table and mission slug"` | PASS |
| Verification gate ran | `./scripts/verify-local.sh docs` | PASS |

## Gates
- [ ] ./scripts/verify-local.sh all

## Restricted Areas
- Do not switch the live composition root or production Mission persistence authority before TASK-2322.07.
- Do not add command-level dual writes, reconciliation, fallback, or read-through between compatibility and SQLite stores.
- Do not persist external task material as a task-catalog aggregate or use it as a second Mission lifecycle authority.
- Do not store generated artifacts as database blobs; retain them as references.
- Do not change unrelated lifecycle commands, UI flows, Git behavior, agent behavior, or persistence migrations beyond what is needed for the covered operations.

## Stop Rules
- Stop and request direction if satisfying a covered operation requires changing the production composition root or selecting SQLite as the live authority.
- Stop and request direction if preserving a covered CLI/controller behavior requires dual-writing, reconciliation, fallback, or read-through between stores.
- Stop and request direction if the required external-task traceability cannot be represented without persisting a task-catalog aggregate.
- Stop and request direction if a generated artifact must be stored as a database blob to complete handoff or NEL recording.
- Stop and request direction if characterization reveals a behavior change outside the listed covered operations.
