# Mission: Migrate the Pi Agent to the Pi SDK (task-2238)

## Goal
Replace the Pi agent's direct client integration with the Pi SDK while ensuring the user-facing Pi response contains only the intended assistant result, rather than SDK/client event chatter.

## Why Now
The current direct-client path couples the agent to a lower-level integration and exposes excessively chatty output to users. Moving to the supported SDK should reduce that coupling and restore a usable response surface, provided the migration fits within the existing agent infrastructure.

## Refinement Signals
- Predicted NEL bucket: Medium (81–235)
- Confidence: Medium
- Selection note: activate as-is; stop and report if the SDK cannot be integrated through the existing Pi agent boundary without broad infrastructure redesign.
- Main drivers: replacing the direct Pi client call path, mapping the SDK execution lifecycle to the existing agent contract, and filtering internal streaming/event output from the user-facing result.

## Scope
- Locate the existing Pi agent integration boundary and replace its direct Pi client usage with the Pi SDK's supported invocation and result-handling API.
- Preserve the existing Pi agent request inputs, cancellation/error propagation, and final-result handoff expected by its callers.
- Convert SDK output into the existing user-facing response shape so transport events, progress messages, tool/event payloads, and diagnostic chatter are not displayed as the agent's answer.
- Add or update focused automated coverage for the SDK-backed execution path and for suppression of non-final output.
- Update documentation that describes the Pi integration or its user-visible output behavior when repository documentation currently covers it.

## Out of Scope
- Redesigning the shared agent runtime, streaming protocol, output renderer, or provider abstraction for agents other than Pi.
- Changing Pi prompts, model selection policy, authentication configuration, or tool capabilities except where the Pi SDK requires a compatible configuration mapping.
- Building a new generic SDK adapter layer for all providers.
- Suppressing intentional final Pi assistant content or changing unrelated agents' output.

## Success Criteria
> **Falsifiability rule (ADR 0039 Part 2):** Each criterion must be falsifiable. Forbidden: subjective adjectives ("easy, fast, simple, intuitive, user-friendly, responsive, quick, efficient" without an attached metric) and vague quantifiers ("multiple, several, some, many, few, various"). For refactor / condense / migration missions, the criterion must enumerate the specific elements (rules, files, behaviours) that must survive — generic phrases like "preserve critical content" are not sufficient.

- The Pi agent has no production direct-client invocation remaining at its former execution boundary; its request is executed through the Pi SDK.
- A normal Pi agent request still reaches the existing caller-facing completion path with the final assistant result and preserves the currently supported request inputs and error/cancellation semantics.
- User-facing Pi output for a streamed or eventful SDK execution contains the final assistant response and excludes SDK/client progress, event, tool, and diagnostic messages.
- Focused automated tests cover one successful SDK-backed Pi execution and one eventful execution whose visible result excludes non-final chatter.
- No source files outside the Pi integration boundary and the tests/documentation directly required by this migration are changed; if the SDK requires a shared-runtime redesign, the mission stops before making that redesign.

## Risks and Assumptions
- Assumption: the repository's installed Pi SDK exposes an invocation path that can be adapted at the current Pi agent boundary.
- Risk: SDK events may not distinguish final user-facing text from progress or tool payloads in the same way as the direct client; tests must exercise the real event/result mapping used by the integration.
- Risk: the SDK may require changes to shared streaming, authentication, or agent-runtime infrastructure. Such changes exceed this mission's scope.
- Risk: filtering output too aggressively could drop final assistant content; preserve and assert the final response explicitly in focused coverage.

## Checkpoints
- CP 1: Map the current Pi agent call chain, its direct-client execution boundary, its caller-facing result contract, and the existing test/documentation locations. Record the intended SDK-to-existing-contract mapping before changing code.
- CP 2: Replace the direct Pi client invocation with the Pi SDK at the identified boundary, preserving request, completion, cancellation, and error behavior within that boundary.
- CP 3: Implement and test output selection so only the final Pi assistant response is presented to the user; add focused coverage for successful SDK execution and event chatter suppression.
- CP 4: Update any applicable Pi integration/output documentation, run the required verification gate, and complete the final goal check with evidence for every success criterion.

### Checkpoint Documentation Requirements
Every checkpoint document (CP-N.md) MUST include:
- A concise summary of the Pi SDK migration work completed in that checkpoint, including the affected execution or output boundary.
- The exact heading `## Goal Check`.
- The exact 3-column pipe-delimited markdown table `| Criterion | Evidence | Status |`.
- At least one evidence row per success criterion using verifiable references. Parallix already accepts:
  1. **File:line references** — e.g., `lib/commands/handoff.ts:292` (must point to an existing file and line)
  2. **Test names** — e.g., `"real custom-agent launcher smoke: full lifecycle with hello-world task (SC3/SC4/SC5/SC6/SC7)"` (must match a test name in the repo)
  3. **Test file paths** — e.g., `test/e2e-real-agent-smoke.test.js` (must be an existing test file)
  4. **ADR references** — e.g., `ADR 0048` (must correspond to an existing file under `docs/adr/`)
  5. **Recognized repo commands or paths** — e.g., `` `npm ...` ``, `` `node ...` ``, `` `git ...` ``, `` `px ...` ``, or `` `./...` `` commands and paths such as `` `./scripts/verify-local.sh all` ``
- Raw `stat`/`ls` output or generic prose alone is insufficient evidence. It may be supplemental only when paired with a file:line reference, exact test name, ADR reference, test file path, or recognized repository command/path above.
- A non-generic `Next action:` line at the bottom that names the next Pi SDK migration, output-filtering, test, documentation, or verification action.

Example Goal Check table:

| Criterion | Evidence | Status |
|---|---|---|
| Draft prompt defines checkpoint evidence rules | `prompts/draft.md:28` | PASS |
| Repair loop has targeted incomplete-evidence coverage | `test/repair-handoff.test.js`, `"buildRelaunchPrompt returns string containing Goal Check table and mission slug"` | PASS |
| Verification gate ran | `./scripts/verify-local.sh docs` | PASS |

## Gates
- [ ] ./scripts/verify-local.sh all

## Restricted Areas
- Shared agent runtime, cross-provider abstractions, global streaming/output rendering, authentication infrastructure, and all non-Pi agent integrations are restricted unless a narrowly required compatibility edit is established at CP 1.
- Do not alter backlog ownership, mission workflow state, remote branches, or execute/review/integrate workflow commands as part of implementation.

## Stop Rules
- Stop before implementation and report the dependency if the installed Pi SDK cannot provide the required execution and final-result behavior through the current Pi agent boundary.
- Stop if replacing the client requires redesigning the shared agent runtime, global streaming/output renderer, provider abstraction, or authentication infrastructure rather than localized compatibility work.
- Stop if focused tests cannot distinguish final assistant content from SDK/client chatter without changing unrelated output semantics; document the observed event contract and request scope direction.
