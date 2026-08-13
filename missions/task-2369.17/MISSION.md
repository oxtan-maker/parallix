# Mission: Deduplicate hook-failure handling between integrate and rebase (task-2369.17)

## Goal
Make `src/application/hook-failure-workflow.ts` the single implementation location for `classifyHookFailure()` and `handleHookFailureAutoBounce()`, with both rebase and integrate consuming those application-owned helpers.

## Why Now
The same hook-failure policy is currently implemented in the integrate CLI adapter and in the rebase workflow. That split risks divergent auto-bounce behavior and conflicts with ADR 0051's application ownership of workflow policy. The rebase workflow is the current application home, but it is not the right long-term owner: integrate and rebase are peers, so a helper named for either command would make shared policy appear command-specific. TASK-2369.06 reduces the integration command first, making this narrow extraction safe to perform now.

## Refinement Signals
- Predicted NEL bucket: Small (0–80) / Medium (81–235) / Large (235+)
- Confidence: High
- Selection note: activate as-is
- Main drivers: remove two duplicate policy implementations, retain ADR 0051 ownership boundaries, and give future hook-failure changes one command-neutral application module.

## Scope
- Extract `classifyHookFailure()`, `MAX_HOOK_RETRY`, `HookRebouncePort`, and `handleHookFailureAutoBounce()` from `src/application/rebase-workflow.ts` into `src/application/hook-failure-workflow.ts` without changing their behavior or port dependencies.
- Replace the rebase workflow's local definitions with imports from `src/application/hook-failure-workflow.ts`.
- Remove the integrate command's local definitions and consume the same helpers from `src/application/hook-failure-workflow.ts`, composing its existing adapter dependencies into the application helper's port shape at the call site.
- Update focused unit coverage as needed so rebase and integrate both retain the same classification and auto-bounce behavior through the shared application helper.
- Run the required static-analysis and mission verification gates.

## Out of Scope
- Changing the classification categories, hook-failure messages, auto-bounce decisions, or rebase/integration workflow behavior.
- Moving hook-failure policy outside the application layer or changing the port-based dependencies used by its canonical implementation.
- Refactoring unrelated integration helpers, command structure, or the changes delivered by TASK-2369.06.
- Updating ADR 0051 or other authored documentation when the ownership invariant and user-visible behavior remain unchanged.

## Success Criteria
> **Falsifiability rule (ADR 0039 Part 2):** Each criterion must be falsifiable. Forbidden: subjective adjectives ("easy, fast, simple, intuitive, user-friendly, responsive, quick, efficient" without an attached metric) and vague quantifiers ("multiple, several, some, many, few, various"). For refactor / condense / migration missions, the criterion must enumerate the specific elements (rules, files, behaviours) that must survive — generic phrases like "preserve critical content" are not sufficient.

- `src/application/hook-failure-workflow.ts` is the only production definition location for `classifyHookFailure()`, `MAX_HOOK_RETRY`, `HookRebouncePort`, and `handleHookFailureAutoBounce()`.
- `src/application/rebase-workflow.ts` contains no local definition of those four exports and imports the shared helper module.
- `src/adapters/cli/commands/integrate.ts` (or its TASK-2369.06 extraction destination) contains no local definition of `classifyHookFailure()` or `handleHookFailureAutoBounce()` and imports the shared helper module.
- Focused tests demonstrate the existing classification cases and auto-bounce outcomes through the shared helper, including the integrate squash-commit retry path.
- `./scripts/verify-local.sh static-analysis` and `./scripts/verify-local.sh all` complete successfully on the mission tree.

## Risks and Assumptions
- The extracted module can expose an unsuitable dependency boundary or create a cycle; stop if resolving it requires moving policy into an adapter or redesigning the application ports.
- TASK-2369.06 may rename or extract the integration module; use its resulting module as the adapter-side target while preserving this mission's two-function boundary.
- The duplicated functions may have drifted despite their shared intent; compare all classifications and auto-bounce branches before deleting either adapter-side implementation.
- Assume TASK-2369.06 is integrated before execution and ADR 0051 continues to designate the application layer as the workflow-policy owner.

## Checkpoints
- CP 1: Inspect the post-TASK-2369.06 integration command and `src/application/rebase-workflow.ts`; record the two duplicate functions' callers, classification branches, auto-bounce branches, and the exact port members the shared helper needs.
- CP 2: Extract the command-neutral application module, then replace rebase and integrate definitions with imports while preserving each caller's inputs and behavior.
- CP 3: Add or adjust focused tests that demonstrate rebase and integrate use the shared classification and auto-bounce behavior, then run the required gates and record the goal check.

### Checkpoint Documentation Requirements
Every checkpoint document (CP-N.md) MUST include a summary of work done and lead its evidence with durable references Parallix verifies today: exact test names, ADR references (including `ADR 0051` where ownership is relevant), test file paths, and recognized repository commands or paths such as `npm ...`, `node ...`, `git ...`, `px ...`, or `./scripts/verify-local.sh all`. File:line references are accepted parenthetically but discouraged because line numbers rot.

Each checkpoint document MUST contain the exact heading `## Goal Check` followed by this exact 3-column table header:

| Criterion | Evidence | Status |
|---|---|---|

Include at least one durable evidence row for every success criterion. Raw `stat`/`ls` output or generic prose alone is not enough; when used as supplemental context, pair it with an accepted command, path, test name, or ADR reference above. End each checkpoint document with a concrete `Next action:` line that identifies the next inspection, edit, test, or gate.

Example Goal Check table:

| Criterion | Evidence | Status |
|---|---|---|
| Draft prompt defines checkpoint evidence rules | `prompts/draft.md` | PASS |
| Repair loop has targeted incomplete-evidence coverage | `test/repair-handoff.test.ts`, `"buildRelaunchPrompt returns string containing Goal Check table and mission slug"` | PASS |
| Verification gate ran | `./scripts/verify-local.sh docs` | PASS |

## Gates
- [ ] ./scripts/verify-local.sh static-analysis
- [ ] ./scripts/verify-local.sh all

## Restricted Areas
- Do not alter hook-failure policy semantics, port contracts, or application-layer ownership established by ADR 0051.
- Do not edit unrelated CLI commands, rebase workflow behavior outside the two named helpers, release artifacts, or authored documentation.
- Do not begin review or integration work; this mission ends with a verified implementation branch.

## Stop Rules
- Stop and escalate if TASK-2369.06 is not integrated or leaves no clear adapter module to import the helpers.
- Stop and escalate if the canonical helper cannot be exported and consumed without an import cycle or a change to the application/adapter dependency direction.
- Stop and escalate if comparison shows the two copies have behavior differences that require a product or policy decision rather than preservation of the application implementation.
- Stop and escalate if focused tests reveal a hook-failure outcome that the canonical application helper does not express.
