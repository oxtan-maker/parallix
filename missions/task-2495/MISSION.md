# Mission: Remove the hallucinated `px mission-start` command (task-2495)

## Goal
Remove the unsupported `px mission-start` command and every command-only reference to it, while retaining startup preflight through `px active`.

## Why Now
The command is advertised despite not belonging to the mission lifecycle. Its help and prompt references steer agents toward redundant work and make the supported workflow ambiguous.

## Refinement Signals
- Predicted NEL bucket: Small (0–80) / Medium (81–235) / Large (235+)
- Confidence: High
- Selection note: activate as-is
- Main drivers: remove a misleading CLI surface, eliminate dead command wiring, and keep the single supported startup-preflight path clear.

## Scope
- Trace all `mission-start` callers and references before editing.
- Remove the `mission-start` CLI registration, implementation, composition/runtime wiring, execute-mission adapter entry, help listing, command suggestions, and now-invalid imports.
- Remove live prompt guidance in `prompts/act-on-review-core.md` and `prompts/draft-core.md` that tells agents to run `px mission-start`.
- Preserve `px active` as the route that runs startup preflight.
- Add focused regression coverage for command absence and for `px active` retaining its startup-preflight behavior.

## Out of Scope
- Changing the startup-preflight rules or lifecycle behavior beyond removing the unsupported command surface.
- Replacing `px active` with a new command or changing unrelated CLI commands.
- Editing historical mission records or archived documentation.
- General prompt rewrites unrelated to `px mission-start` guidance.

## Success Criteria
> **Falsifiability rule (ADR 0039 Part 2):** Each criterion must be falsifiable. Forbidden: subjective adjectives ("easy, fast, simple, intuitive, user-friendly, responsive, quick, efficient" without an attached metric) and vague quantifiers ("multiple, several, some, many, few, various"). For refactor / condense / migration missions, the criterion must enumerate the specific elements (rules, files, behaviours) that must survive — generic phrases like "preserve critical content" are not sufficient.

- `px mission-start` is absent from CLI command registration, help output, suggestions, and executable dispatch; invoking that command cannot reach startup-preflight logic.
- The dedicated command adapter and its entry in `src/adapters/mission/execute-mission-adapters.ts` are removed, with no remaining production import or reference to the removed command module.
- `px active` continues to execute startup preflight, proved by a focused test that exercises `px active` and asserts the preflight effect.
- `prompts/act-on-review-core.md` and `prompts/draft-core.md` contain no instruction to invoke `px mission-start`; historical mission records are not changed.
- Focused regression tests and `./scripts/verify-local.sh static-analysis` complete successfully without `.only`, bare `.skip`, or unrelated source changes.

## Risks and Assumptions
- Risk: a hidden caller may rely on the removed command adapter. Mitigation: search command registration, composition, runtime, prompts, and adapter references before deletion.
- Risk: removal could accidentally remove startup preflight. Assumption: `px active` owns the supported preflight path and can be protected with a focused regression test.
- Assumption: `mission-start` is not a supported compatibility contract because it is explicitly hallucinated and has no required workflow caller.

## Checkpoints
- CP 1: Inventory every `mission-start` reference across CLI registration, composition, runtime, adapter execution, help/suggestions, tests, and live prompts; identify the focused tests that will prove command absence and `px active` preflight retention.
- CP 2: Remove the command-only implementation and wiring, update the two live prompts, and add or update the focused regression tests.
- CP 3: Run the focused checks and required repository gates; record the final Goal Check with durable evidence.

### Checkpoint Documentation Requirements
Every checkpoint document (CP-N.md) MUST include a summary of work done and lead its evidence with durable forms Parallix verifies today: exact test names, ADR references, test file paths, and recognized repository commands or paths such as `npm ...`, `node ...`, `git ...`, `px ...`, or `./...`. File:line references are accepted when needed but discouraged because line numbers rot.

Every checkpoint document MUST include the exact heading `## Goal Check` and this 3-column table:

| Criterion | Evidence | Status |
|---|---|---|

Include at least one evidence row for every success criterion. Raw `stat`/`ls` output or generic prose alone is not enough; pair any shell output with an accepted reference above. End with a concrete `Next action:` line.

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
- Do not alter startup-preflight semantics or remove the preflight path owned by `px active`.
- Do not edit historical mission records, archived backlog entries, or unrelated prompts.
- Do not add a replacement command, dependency, or compatibility shim for `mission-start`.

## Stop Rules
- Stop and request direction if any external or supported workflow caller requires `px mission-start` as a compatibility contract.
- Stop and request direction if preserving startup preflight requires a behavioral change to `px active` beyond command-only cleanup.
- Stop if the required verification gate exposes unrelated pre-existing failures; capture the failing command and failure summary before proceeding.
