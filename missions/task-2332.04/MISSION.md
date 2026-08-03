# Mission: Re-own active mission execution in the application layer (task-2332.04)

## Goal
Replace the `ActivePort` / `LegacyActiveAdapter` pair — which today routes almost the entire execute workflow through one adapter — with an application-owned `ExecuteMission` use case that itself sequences workspace preparation, agent execution, lifecycle recording, telemetry, and handoff/review through mechanism-named ports, while `px active` keeps its exact current text, exit codes, and durable ordering.

## Why Now
`ActiveService` (`src/application/active-service.ts:20-39`) only validates a request and then calls four legacy-phase methods (`validateSlug`, `launch`, `recordLaunch`, `handoff`) on `ActivePort` (`src/application/ports.ts:45-50`). All real sequencing and partial-failure policy — preflight, worktree resolution, prompt construction, agent selection and launch, commit safety, checked lifecycle activation, best-effort stats, handoff and review — lives in `LegacyActiveAdapter` (`src/platform/runtime/lib/adapters/legacy-active-adapter.ts:35-178`), which also keeps hidden per-slug run state in a `Map`. That contradicts ADR 0051's rule that adapters "do not choose lifecycle transitions or authorization policy". TASK-2332.01–.03 have now fixed the dependency graph, the single production composition boundary, and capability-owned ports, so the ports this use case needs can be declared without re-opening those decisions. This is the last mission in the sequence that still needs behavioral extraction; TASK-2332.05 (inbound surfaces) and TASK-2332.06 (scaffold removal) assume the workflow already sits in the application layer.

## Refinement Signals
- Predicted NEL bucket: Large (235+)
- Confidence: High
- Selection note: activate as-is
- Main drivers: introducing an `ExecuteMission` use case that absorbs the sequencing currently in `legacy-active-adapter.ts` (221 lines) and the phases it delegates into `src/platform/runtime/lib/commands/active.ts` (711 lines); declaring five mechanism ports; rewiring `src/platform/runtime/lib/composition/application-services.ts`; and adding characterization tests for `active`, agent-fallback/relaunch retry, and handoff paths without touching `test/active.test.ts` expectations.

## Scope
- Add an application use case (for example `src/application/execute-mission-service.ts`) that owns the ordering preflight → workspace resolution → agent launch → durable launch record → lifecycle synchronization → telemetry → handoff/review, plus the partial-failure and cancellation policy currently spread across `ActiveService` and `LegacyActiveAdapter`.
- Declare application-owned ports named for external mechanisms rather than legacy phases: a workspace port (preflight, worktree resolution, task-file resolution, commit safety), an agent-execution port (agent config/eligibility resolution, prompt delivery, launch, fallback/relaunch), a lifecycle/store port (checked Mission transitions), a telemetry port (execute stats and stage telemetry), and a handoff/review port.
- Move the per-slug run state (`LegacyLaunchRun`) out of adapter memory into explicit values passed between the use case's steps.
- Route every lifecycle mutation through the checked `MissionTransitionStore` path used by `MissionLifecycleService` (`src/platform/runtime/lib/adapters/legacy-active-adapter.ts:145-156`), with no unchecked or direct status writes.
- Reduce `LegacyActiveAdapter` to narrowly scoped adapters implementing the new ports, or delete it, and update `src/platform/runtime/lib/composition/application-services.ts:185` and `src/composition/production-capabilities.ts` accordingly.
- Keep agent process launch, Git/worktree manipulation, backlog-Markdown access, and statistics writes inside adapters.
- Add characterization tests covering `active` success, agent-fallback/relaunch retry, handoff-and-review failure, non-zero agent status, cancellation before launch and after durable launch, and preflight/worktree rejection.
- Update `docs/adr/0051-ui-neutral-application-boundary.md` and any affected docs where they describe `active` as an adapter-owned workflow.

## Out of Scope
- Changing `px active` output text, its lack of a JSON contract, its exit codes, or its flag surface.
- Changing SQLite schema, migration ledgers, or persistence authority (ADR 0053 owns that).
- Extracting or restructuring other command families (`stats-backfill`, `review`, `integrate`, TUI/board controllers) beyond imports forced by the new ports — TASK-2332.05 owns inbound surfaces.
- Removing migration scaffolding or the architecture certification gate — TASK-2332.06 owns that.
- Adding a web transport, authorization model, or new UI.
- Rewriting `test/active.test.ts` expectations to accommodate a behavior difference.

## Success Criteria
> **Falsifiability rule (ADR 0039 Part 2):** Each criterion must be falsifiable. Forbidden: subjective adjectives ("easy, fast, simple, intuitive, user-friendly, responsive, quick, efficient" without an attached metric) and vague quantifiers ("multiple, several, some, many, few, various"). For refactor / condense / migration missions, the criterion must enumerate the specific elements (rules, files, behaviours) that must survive — generic phrases like "preserve critical content" are not sufficient.

- An `ExecuteMission` use case exists under `src/application/` and contains, in source, the full step ordering: preflight/workspace resolution, agent launch, durable launch record, lifecycle synchronization, telemetry recording, handoff/review — each expressed as a call to an application-owned port.
- `src/application/ports.ts` (or files under `src/application/ports/`) no longer declares the `ActivePort` interface with the members `validateSlug`, `launch`, `recordLaunch`, `handoff`; the replacement port interfaces are named for workspace, agent execution, lifecycle/store, telemetry, and handoff/review mechanisms.
- No application module retains per-slug workflow state across port calls in a module- or instance-level `Map`; the state carried between steps is passed explicitly as use-case values.
- Every lifecycle status change on the execute path goes through the checked `MissionTransitionStore` / `MissionLifecycleService` boundary; no execute-path module writes task status without a read revision.
- `src/platform/runtime/lib/adapters/legacy-active-adapter.ts` is deleted, or every class remaining in it implements exactly one of the new mechanism ports and no longer sequences launch → record → handoff.
- Agent process spawning, Git/worktree commands, backlog Markdown reads/writes, and stats writes appear only in files under `src/platform/runtime/lib/` or `src/adapters/`, not in `src/application/`.
- Characterization tests assert identical observable behavior for: `active` success, agent fallback/relaunch retry, handoff-and-review failure, non-zero agent exit status, cancellation before launch, cancellation after durable launch, preflight failure, and missing dedicated worktree — including the existing operator messages `dedicated execute worktree is required`, `execute preflight failed`, and `cancelled after durable launch; re-query task state`.
- `test/active.test.ts` passes unmodified except for import-path or construction changes required by the new composition, and no assertion string in it is weakened or deleted.
- `test/legacy-active-adapter.test.ts` and `test/application-services.test.ts` either pass or are replaced by equivalent tests covering the same behaviors against the new ports, with no net loss of asserted behaviors.
- `./scripts/verify-local.sh static-analysis` and `./scripts/verify-local.sh all` pass on the final tree.

## Risks and Assumptions
- Risk: the launch → record → rollback ordering and the deferred-rebase condition at `src/platform/runtime/lib/adapters/legacy-active-adapter.ts:109` are load-bearing lifecycle contracts (ADR 0051 C2). Mitigation: write the characterization tests before moving the sequencing, and keep the same condition in the use case.
- Risk: `LegacyActiveAdapter` is constructed inside a circular module graph (`legacy-active-adapter.ts:47-50`) and the composition root's boundary guard greps for `new LegacyActiveAdapter(` (`src/platform/runtime/lib/architecture/boundary-guards.ts:133`). Removing or renaming the class can break both the guard and the graph. Mitigation: update the guard's composition detection in the same change and verify with `./scripts/verify-local.sh static-analysis`.
- Risk: the best-effort stats path swallows errors (`legacy-active-adapter.ts:113-127`); moving it into the use case could let a telemetry failure fail a launch. Mitigation: keep telemetry failure non-fatal and assert that with a test.
- Risk: `sessionMarkerPort` and `operatorBlocklist` overlays are supplied by composition to avoid a second SQLite handle. Mitigation: keep the shared handles flowing through the new agent-execution adapter; do not open new connections.
- Assumption: TASK-2332.01–.03 are integrated on this mission's parent commit, so the dependency graph, single composition boundary, and capability-owned ports are already in place.
- Assumption: ADR 0051 remains the governing decision; ADR 0053 persistence cutover stays out of this mission.

## Checkpoints
- CP 1: Characterize the current behavior. Enumerate every step, ordering rule, failure branch, and operator message in `active-service.ts`, `legacy-active-adapter.ts`, and the `active.ts` helpers it calls; add or extend tests covering the eight scenarios listed in Success Criteria so they pass against the unchanged tree.
- CP 2: Declare the five mechanism ports (workspace, agent execution, lifecycle/store, telemetry, handoff/review) under `src/application/`, mapping each legacy phase method to the port that owns it, with no consumer changes yet.
- CP 3: Implement the `ExecuteMission` use case owning the sequencing, cancellation boundaries, and partial-failure policy against those ports; move the per-slug run state into explicit use-case values.
- CP 4: Implement the narrow adapters over the existing `active.ts` helpers, rewire `src/platform/runtime/lib/composition/application-services.ts` and `src/composition/production-capabilities.ts`, delete or reduce `LegacyActiveAdapter`, and update `boundary-guards.ts` composition detection.
- CP 5: Run `./scripts/verify-local.sh static-analysis` and `./scripts/verify-local.sh all`, update `docs/adr/0051-ui-neutral-application-boundary.md` where it describes `active` as adapter-owned, and record the final Goal Check table.

### Checkpoint Documentation Requirements
Every checkpoint document (CP-N.md) MUST include:
- A summary of the ports, sequencing steps, adapters, or tests that changed in that checkpoint.
- The exact heading `## Goal Check`.
- The exact 3-column pipe-delimited table header `| Criterion | Evidence | Status |`, with one row for every Success Criterion the checkpoint touches.
- At least one verifiable reference per row, drawn from the forms Parallix already verifies:
  1. **File:line references** — e.g. `src/application/execute-mission-service.ts:64` (must point to an existing file and line)
  2. **Exact test names** — e.g. `"active launches, records, then hands off in order"` (must match a test name in the repo)
  3. **Test file paths** — e.g. `test/active.test.ts` (must be an existing test file)
  4. **ADR references** — e.g. `ADR 0051` (must correspond to a file under `docs/adr/`)
  5. **Recognized repo commands or paths** — e.g. `` `npm test -- test/active.test.ts` ``, `` `./scripts/verify-local.sh static-analysis` ``, or `` `git diff --stat` ``
- For behavior preservation, cite the test file path **and** the exact test name. For sequencing ownership, cite the use case's file:line for the step **and** the port declaration's file:line. For adapter reduction, cite the remaining file:line or the deletion command output paired with the composition file:line that no longer constructs it.
- Weak-agent failure mode to avoid: raw `stat`, `ls`, `wc -l`, or generic prose such as "the refactor is complete" is not acceptable evidence on its own. Shell output may appear as supplemental context only when paired with one of the five accepted references above.
- A non-generic `Next action:` line at the bottom naming the next port, adapter, or verification command.

Example Goal Check table:

| Criterion | Evidence | Status |
|---|---|---|
| Use case owns launch → record → handoff ordering | `src/application/execute-mission-service.ts:64`, ADR 0051 | PASS |
| `active` behavior unchanged on handoff failure | `test/active.test.ts`, `"handoff failure surfaces the legacy handoff error"` | PASS |
| Legacy adapter no longer sequences the workflow | `src/platform/runtime/lib/composition/application-services.ts:185` | PASS |
| Verification gate ran | `./scripts/verify-local.sh all` | PASS |

## Gates
- [ ] ./scripts/verify-local.sh static-analysis
- [ ] ./scripts/verify-local.sh all

## Restricted Areas
- Do not change `px active` operator text, exit codes, flag surface, or add a JSON contract to it.
- Do not weaken, delete, or rewrite assertions in `test/active.test.ts` to accommodate a behavior difference.
- Do not import `node:fs`, `node:child_process`, Git runners, SQLite drivers, Forgejo clients, or terminal-rendering modules into `src/application/` except as port type definitions (ADR 0051).
- Do not change SQLite schema, migration ledgers, import formats, or persistence authority.
- Do not open new SQLite connections on the execute path; reuse the composition root's shared session-marker and blocklist handles.
- Do not restructure other command families, the TUI, or the board controller beyond imports forced by the new ports.

## Stop Rules
- Stop and request direction if preserving an `active` behavior requires an application module to perform a filesystem, Git, or subprocess effect directly.
- Stop if a characterization test cannot be made to pass identically before and after the extraction; report the behavior difference instead of adjusting the assertion.
- Stop before changing any lifecycle transition semantics, rollback ordering, or the deferred-rebase condition, rather than "simplifying" them during the move.
- Stop if reducing `LegacyActiveAdapter` requires changing `boundary-guards.ts` in a way that removes composition-root enforcement rather than retargeting it.
- Stop if the work requires touching persistence authority, inbound command surfaces (TASK-2332.05), or scaffold removal (TASK-2332.06).
