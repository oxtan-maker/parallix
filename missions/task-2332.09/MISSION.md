# Mission: Re-home handoff workflow behind an application use case (task-2332.09)

## Goal

Move the complete handoff workflow (gate, rebase, NEL capture, gatekeeper pushback, retry/relaunch, Forgejo PR, review assignment, lifecycle transition, and backlog sync) from `src/adapters/cli/commands/handoff.ts` into an application use case at `src/application/handoff-command-use-case.ts` over narrowly defined application-owned ports. Keep handoff parsing, exit-code mapping, and rendering in `src/interfaces/cli/handoff.ts`. Composition in `src/composition/create-cli.ts` supplies concrete adapters. Preserve all handoff output, review creation, retry behavior, verification, and persistence semantics.

## Why Now

TASK-2332.07 (integrate extraction) is integrated and established the use-case/port/composition pattern. Handoff is the next workflow-heavy command in the TASK-2332 command-ownership wave — 1361 lines of sequencing logic currently live in the CLI adapter layer. Extracting it before draft, stats, rebase, status, and review missions reduces the blast radius of later waves and gives them a proven template to follow.

## Refinement Signals
- Predicted NEL bucket: Medium (81–235)
- Confidence: High
- Selection note: activate as-is
- Main drivers: extract 1361-line handoff adapter into use case + ports + CLI interface; follow integrate pattern from TASK-2332.07; add hermetic mocked-port tests; update composition wiring

## Scope

- Create `src/application/handoff-command-use-case.ts` — application entry point class mirroring `IntegrateCommandUseCase`
- Create `src/application/ports/handoff-workflow.ts` — application-owned ports for verification, rebase, NEL capture, gatekeeper, Forgejo PR, review assignment, lifecycle transition, and backlog sync
- Create `src/interfaces/cli/handoff.ts` — handoff argument parsing, request translation, exit-code mapping, and rendering (no adapter imports)
- Update `src/composition/create-cli.ts` — wire handoff use case with concrete port implementations via constructor injection
- Add fast mocked-port unit tests covering success, gate failure, retry/relaunch, and persistence failure without real Forgejo or agent CLIs
- Retain characterization coverage proving existing handoff text, JSON, and exit behavior remain compatible

## Out of Scope

- Draft workflow extraction: TASK-2332.10
- Stats workflow extraction: TASK-2332.11
- Rebase workflow extraction: TASK-2332.12
- Status and checkpoint workflow extraction: TASK-2332.13
- Review workflow extraction: TASK-2332.14
- Remaining compliant CLI interfaces, compatibility cleanup, documentation, and cross-workflow verification: TASK-2332.15
- Final responsibility-guard certification: TASK-2332.08 (after TASK-2332.15)
- New user-facing behavior, persistence-format changes, or new adapter implementations
- Modifying `src/application/mission-handoff-service.ts` (NEL recording use case already exists; this mission wires it through the handoff workflow port)

## Success Criteria

> **Falsifiability rule (ADR 0039 Part 2):** Each criterion must be falsifiable. Forbidden: subjective adjectives ("easy, fast, simple, intuitive, user-friendly, responsive, quick, efficient" without an attached metric) and vague quantifiers ("multiple, several, some, many, few, various"). For refactor / condense / migration missions, the criterion must enumerate the specific elements (rules, files, behaviours) that must survive — generic phrases like "preserve critical content" are not sufficient.

- SC1: `src/adapters/cli/commands/handoff.ts` delegates to one application use case (`HandoffCommandUseCase`) and does not sequence multiple adapter packages directly.
- SC2: The handoff application use case owns the complete workflow — verify handoff, gate run, rebase, NEL capture, gatekeeper pre-review, declared gates, review assignment, Forgejo PR creation, lifecycle transition, checkpoint recording, and backlog sync — through application-owned ports only. It imports no concrete adapter module from `src/adapters/`, `src/git/`, `src/forgejo/`, `src/backlog/`, `src/review/`, or `src/verification/`.
- SC3: Handoff argument parsing, request translation, exit-code mapping, and rendering reside under `src/interfaces/cli/handoff.ts` and import no adapter module.
- SC4: `src/composition/create-cli.ts` supplies the handoff use case's concrete ports via explicit constructor injection. Neither interfaces nor application code instantiate or locate adapters.
- SC5: Fast mocked-port unit tests cover the following scenarios without real Forgejo, agent CLIs, or recursive workflow commands: (a) successful handoff, (b) gate failure, (c) retry/relaunch after gatekeeper pushback, (d) NEL persistence failure, (e) checkpoint recording failure.
- SC6: Existing handoff text output, JSON shape, exit codes (0 on success, 1 on failure), lifecycle state transitions (active to review), and checkpoint evidence recording remain compatible, proved by focused characterization tests and the required verification gates.

## Risks and Assumptions

- Handoff has more complex retry/relaunch logic than integrate (gatekeeper pushback with bounded agent relaunch, global retry budget, recursion guard at 3 attempts). Port design must capture all retry seams without leaking adapter details.
- NEL capture (`captureNelAtHandoff`) already uses `MissionHandoffService` through `missionServicesFn`. The port must forward this correctly without duplicating the NEL recording path.
- `resolveHandoffReviewAssignment` imports from `src/domain/agents.js` and `src/agents/agents.js` — these are domain-level modules, not adapters, and may stay as direct imports in the use case.
- The `verifyHandoff` function reads `fs`, `path`, `git`, and `missionUtils` directly. These become port dependencies (filesystem port, git port, mission-utils port).
- Assumption: TASK-2332.07 integrate pattern (use case class + ports interface + CLI interface + composition wiring) is stable and requires no changes for handoff.

## Checkpoints

- CP 1: Define handoff workflow ports (`src/application/ports/handoff-workflow.ts`) and the use case class (`src/application/handoff-command-use-case.ts`). Document the port boundary — which adapter operations each port covers.
- CP 2: Create `src/interfaces/cli/handoff.ts` (parsing + rendering), update `src/composition/create-cli.ts` wiring, add mocked-port tests, and run the required gates.

### Checkpoint Documentation Requirements

Every checkpoint document (CP-N.md) MUST include:
- A summary of work done
- A `## Goal Check` section
- A 3-column pipe-delimited markdown table with columns: Criterion | Evidence | Status
- At least one evidence row per criterion using verifiable references. Parallix already accepts:
  1. **File:line references** — e.g., `src/application/handoff-command-use-case.ts:29` (must point to an existing file and line)
  2. **Test names** — e.g., `"handoff use case delegates to workflow port on success"` (must match a test name in the repo)
  3. **Test file paths** — e.g., `test/handoff-use-case.test.ts` (must be an existing test file)
  4. **ADR references** — e.g., `ADR 0036` (must correspond to an existing file under `docs/adr/`)
  5. **Recognized repo commands or paths** — e.g., `` `./scripts/verify-local.sh all` ``, `` `npm test -- test/handoff.test.ts` ``, or `` `git diff --name-only` ``
- Raw `stat`/`ls` output or generic prose may appear as supplemental context, but pair them with one of the accepted references above
- A non-generic `Next action:` line at the bottom

Example Goal Check table:

| Criterion | Evidence | Status |
|---|---|---|
| Handoff use case class created | `src/application/handoff-command-use-case.ts:12` | PASS |
| Ports interface defined | `src/application/ports/handoff-workflow.ts:5` | PASS |
| CLI interface parses args | `src/interfaces/cli/handoff.ts:8`, `"parseIntegrateCliRequest rejects unknown flags"` | PASS |
| Verification gate ran | `` `./scripts/verify-local.sh all` `` | PASS |

## Gates

- [ ] `./scripts/verify-local.sh static-analysis`
- [ ] `./scripts/verify-local.sh all`

## Restricted Areas

- `src/application/mission-handoff-service.ts` — NEL recording use case is stable; this mission wires it through the handoff workflow port but does not modify its internal logic
- `src/domain/mission.js` and `src/domain/net-engineering-lines.js` — domain classes, not in scope for this extraction
- `src/adapters/cli/commands/repair-handoff.ts` — separate command, not part of handoff workflow extraction
- `test/handoff.test.ts` — existing tests must remain passing; new mocked-port tests go in a new file (e.g., `test/handoff-use-case.test.ts`)

## Stop Rules

- Stop if moving handoff sequencing requires the application use case to import a concrete adapter module; define a focused port in `src/application/ports/` and wire it from composition instead.
- Stop if a public handoff text, JSON, or exit-code characterization changes; restore compatibility before continuing.
- Stop if hermetic unit tests invoke Forgejo, an agent CLI, or a recursive workflow command; add the missing mock port.
- Do not begin TASK-2332.10 (draft extraction) until this mission is reviewed and integrated.
