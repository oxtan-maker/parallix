# Mission: Establish executable ADR 0053 persistence inventory and cutover guardrails (task-2322.01)

## Goal
Make ADR 0053 enforceable before any authority migration: create a complete, executable inventory of current production durable-state reads and writes, preserve the required observable behavior with isolated characterization tests, and prevent direct SQL or unclassified durable-file persistence from entering application and UI code.

## Why Now
The runtime still spans file-backed state, SQLite adapters, task files, Git observations, configuration, and generated artifacts. Switching authority without first naming each boundary would risk silently changing mission lifecycle ownership, mutating task intake, or introducing another untracked compatibility path. This mission establishes the inventory and guardrails required for the later cutover tasks while deliberately leaving runtime authority unchanged.

## Refinement Signals
- Predicted NEL bucket: Medium (81–235)
- Confidence: High
- Selection note: activate as-is
- Main drivers: enumerate every production reader and writer for the ADR 0053 concepts; classify durable boundaries and staged exceptions; add fast behavior and architecture checks without external services; preserve the distinction between task/Git inputs and mission lifecycle authority.

## Scope
- Inventory production default and compatibility readers and writers for Mission, CheckpointData, Review, MissionOutcome, AgentRunMeasurement, KnownRepository, SessionMarker, LaneTransitionEvent, AgentBlock, UI preferences, task intake, Git observations, configuration, secrets, and large artifacts.
- Classify each inventoried boundary as database-owned domain state, explicit one-way legacy input, external fact or intake, configuration or secret, generated artifact, or forbidden persistence; record the later cutover task for every temporary exception.
- Add fast, dependency-mocked characterization tests for the existing CLI, TUI, and shared board-projection behavior that migration must retain.
- Add an architecture test that rejects direct SQL in application or UI code and rejects unclassified durable file reads or writes, except for an explicitly registered staged exception.
- Document the executable inventory and its relationship to ADR 0053 and ADR 0051.

## Out of Scope
- Switching any production authority from file-backed storage to SQLite or another backend.
- Repairing, normalizing, importing, or mutating source task files or the task catalog.
- Byte-faithful aggregate import, dual-write or shadow-write behavior, and an all-at-once command rewrite.
- Changing the external task-authoring or Git-observation formats, semantics, or ownership.
- Calling real Forgejo, launching agents, or running expensive CLI commands from unit tests.

## Success Criteria
> **Falsifiability rule (ADR 0039 Part 2):** Each criterion must be falsifiable. Forbidden: subjective adjectives ("easy, fast, simple, intuitive, user-friendly, responsive, quick, efficient" without an attached metric) and vague quantifiers ("multiple, several, some, many, few, various"). For refactor / condense / migration missions, the criterion must enumerate the specific elements (rules, files, behaviours) that must survive — generic phrases like "preserve critical content" are not sufficient.

- A checked-in executable inventory names every production default and compatibility reader or writer for all 15 listed durable-state concepts and gives its file location, operation, classification, and removal task for each temporary exception.
- The inventory classifies each listed boundary as exactly one of: database-owned domain state, explicit one-way legacy input, external fact or intake, configuration or secret, generated artifact, or forbidden persistence.
- Characterization tests run without real Forgejo, real agents, or expensive CLI subprocesses and assert the current observable CLI, TUI, and shared board-projection behavior used during the later migration.
- An architecture test fails for direct SQL issued by application or UI code and for a durable file read or write absent from the registered inventory; it permits only the staged exceptions recorded with their cutover task.
- Tests and inventory explicitly identify task authoring and Git observations as external inputs or facts, distinguish them from Mission lifecycle authority, and contain no code path that repairs, normalizes, or mutates source task files.
- No production authority switch, source-format repair, aggregate import, dual-write, shadow-write, or all-at-once command rewrite is introduced by this mission.

## Risks and Assumptions
- Risk: reader and writer discovery can miss compatibility paths that are invoked only by a legacy command. Mitigation: inventory default and compatibility paths separately and make the architecture test reject future unregistered paths.
- Risk: broad filesystem interception can make characterization tests brittle. Assumption: existing test seams can mock storage, Git, Forgejo, and subprocess dependencies without contacting real services.
- Risk: a staged exception can become permanent. Mitigation: require every exception to cite a specific later cutover task and fail the architecture check for exceptions not in the registry.
- Assumption: ADR 0053 and ADR 0051 remain the governing boundary definitions; this mission records current behavior and does not reinterpret their authority decisions.

## Checkpoints
- CP 1: Map the production persistence surface. Produce the executable inventory for the named ADR 0053 concepts, identify every default and compatibility reader/writer, classify each boundary, and attach a later cutover task to every temporary exception.
- CP 2: Lock current migration-facing behavior. Add isolated, fast characterization coverage for CLI, TUI, and shared board projection with mocks for Forgejo, agents, and expensive subprocesses; confirm task intake and Git observations remain external inputs/facts.
- CP 3: Enforce the inventory. Add the direct-SQL and unclassified-durable-file architecture checks, register only staged exceptions from CP 1, then document results and run the repository verification gate.

### Checkpoint Documentation Requirements
Every checkpoint document (CP-N.md) MUST include:
- A summary of work done
- The exact heading `## Goal Check`
- The exact 3-column pipe-delimited Markdown table header `| Criterion | Evidence | Status |`
- At least one evidence row per success criterion using verifiable references. Parallix already accepts:
  1. **File:line references** — e.g., `lib/commands/handoff.ts:292` (must point to an existing file and line)
  2. **Test names** — e.g., `"real custom-agent launcher smoke: full lifecycle with hello-world task (SC3/SC4/SC5/SC6/SC7)"` (must match a test name in the repo)
  3. **Test file paths** — e.g., `test/e2e-real-agent-smoke.test.ts` (must be an existing test file)
  4. **ADR references** — e.g., `ADR 0048` (must correspond to an existing file under `docs/adr/`)
  5. **Recognized repo commands or paths** — e.g., `` `npm test -- test/repair-handoff.test.ts` ``, `` `px review <slug> --verify` ``, or `` `./scripts/verify-local.sh all` ``
- Raw `stat`/`ls` output or generic prose alone is not sufficient evidence; if shell output is included, pair it with a file:line reference, exact test name, ADR reference, test file path, or recognized repository command/path above.
- A concrete `Next action:` line at the bottom that names the remaining inventory, test, guardrail, or verification action.

Example Goal Check table:

| Criterion | Evidence | Status |
|---|---|---|
| Draft prompt defines checkpoint evidence rules | `prompts/draft.md:28` | PASS |
| Repair loop has targeted incomplete-evidence coverage | `test/repair-handoff.test.ts`, `"buildRelaunchPrompt returns string containing Goal Check table and mission slug"` | PASS |
| Verification gate ran | `./scripts/verify-local.sh docs` | PASS |

## Gates
- [ ] ./scripts/verify-local.sh all

## Restricted Areas
- `src/platform/runtime/lib/core/durable-state-inventory.ts`, `src/platform/runtime/lib/core/storage.ts`, `src/adapters/sqlite`, and `src/domain` are boundary-sensitive: changes must preserve the inventory classifications and must not switch production authority.
- Source task files are read-only inputs for this mission: no repair, normalization, or mutation behavior may be introduced.
- Unit tests under `test/` must mock Forgejo, agents, Git, and expensive CLI dependencies; they must not contact real Forgejo or launch performance-heavy commands.
- Secrets, configuration, Git observations, and large artifacts must remain in their stated classifications and must not be moved into Mission lifecycle authority.

## Stop Rules
- Stop and request direction if a required reader or writer cannot be classified from ADR 0053/ADR 0051 and the existing code without changing an authority decision.
- Stop and request direction if enforcing an architecture rule requires a production authority switch, task-file mutation, source-format repair, import, dual-write, shadow-write, or command rewrite.
- Stop and request direction if preserving the required behavior cannot be tested with mocks and would require real Forgejo, real agents, or expensive external commands.
- Stop and request direction if a temporary exception has no specific later cutover task to own its removal.
