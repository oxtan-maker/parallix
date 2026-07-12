# Mission: Reject prose masquerading as executable mission gates (task-2214)

Reproduction-Test: test/task-2214-repro.test.js

## Goal
Make mission gate declarations machine-executable by construction and fail clearly before handoff execution when a `## Gates` checklist item is prose rather than a shell command. A drafted mission must express each gate as the exact repository command to run, without success-language suffixes such as “passes on the final tree.”

## Why Now
Task 2210 remained active after the draft agent emitted `` `./scripts/verify-local.sh all` passes on the final tree.`` as a gate. The handoff runner treated the whole sentence as Bash, producing a misleading command-not-found failure only after review preparation. The same weak-agent behavior is disrupting real-agent lifecycle smoke coverage, so the contract between drafting and the declared-gate runner needs an enforceable command-only boundary.

## Refinement Signals
- Predicted NEL bucket: Medium (81–235)
- Confidence: High
- Selection note: activate as-is
- Main drivers: a red-to-green parser/validation regression test, draft-prompt guidance, early diagnostic behavior, and focused handoff/draft coverage

## Scope
- Lock the task-2210 failure with `test/task-2214-repro.test.js`: a mission gate containing an executable command followed by prose must be rejected rather than launched as Bash.
- Define and enforce the accepted `## Gates` item shape at the mission drafting and declared-gate validation boundaries.
- Update the draft-agent instructions so generated gate checklist entries contain exact commands only; explanatory expectations belong in success criteria or checkpoint prose.
- Return an actionable validation error that identifies the offending gate and tells the operator to replace it with an exact command.
- Add focused coverage for valid bare commands, optional Markdown backticks/checkboxes already supported by the parser, and invalid prose-appended gates.
- Update user-facing workflow documentation only if the implemented gate syntax or diagnostic behavior is documented elsewhere.

## Out of Scope
- Fixing task 2210 or changing its historical mission artifacts.
- Relaxing checkpoint Goal Check evidence validation or changing which evidence references Parallix recognizes.
- Making the custom-agent E2E suite pass by weakening its assertions or bypassing declared gates.
- Redesigning repository verification adapters, integration-gate configuration, or shell execution semantics for valid commands.
- Adding a general-purpose shell-language parser beyond what is needed to distinguish supported command declarations from prose.

## Success Criteria
> **Falsifiability rule (ADR 0039 Part 2):** Each criterion must be falsifiable. Forbidden: subjective adjectives ("easy, fast, simple, intuitive, user-friendly, responsive, quick, efficient" without an attached metric) and vague quantifiers ("multiple, several, some, many, few, various"). For refactor / condense / migration missions, the criterion must enumerate the specific elements (rules, files, behaviours) that must survive — generic phrases like "preserve critical content" are not sufficient.

- SC1: At the mission parent commit, `node --test test/task-2214-repro.test.js` fails because a gate equivalent to `` `./scripts/verify-local.sh all` passes on the final tree.`` reaches execution or is accepted; after the fix, the same test passes because validation rejects it before the shell runner executes the gate.
- SC2: The rejection result uses the declared-gate validation failure path, includes the offending gate text, and gives command-only remediation guidance rather than reporting a downstream Bash command-not-found error.
- SC3: Draft instructions explicitly require every `## Gates` checklist item to be an exact runnable repository command and explicitly prohibit trailing outcome prose; they direct outcome statements to Success Criteria or checkpoint documentation.
- SC4: Existing supported forms remain executable: unchecked and checked checklist items, bare shell commands, and a command surrounded by Markdown backticks.
- SC5: Focused automated tests cover at least one prose-appended gate rejection and the supported forms in SC4, and assert that rejected gates do not invoke the shell runner.
- SC6: `./scripts/verify-local.sh static-analysis`, `node --test test/task-2214-repro.test.js test/handoff.test.js test/draft.test.js`, and `./scripts/verify-local.sh all` complete successfully on the final tree.

## Risks and Assumptions
- Assumption: mission gates are repository-controlled commands, so rejecting natural-language checklist text is preferable to attempting heuristic shell execution.
- Risk: simplistic prose detection can reject legitimate commands containing quoted human-readable strings or shell operators. Tests must preserve currently supported quoted arguments and compound commands.
- Risk: guidance-only prompt changes will not protect weaker agents. Runtime validation must remain the authoritative fail-closed boundary.
- Risk: syntax/path validation already exists; implementation should extend that boundary rather than introduce a second inconsistent gate parser.

## Checkpoints
- CP 1: Before changing production or prompt code, author `test/task-2214-repro.test.js`. Construct a temporary `MISSION.md` whose gate is ``- [ ] `./scripts/verify-local.sh all` passes on the final tree.`` and instrument the declared-gate shell runner. Assert that validation rejects the gate with command-only remediation and that the runner is not called. This assertion must fail at the mission parent commit (red), where the prose is accepted and execution is attempted, and pass only after the fix (green).
- CP 2: Tighten the canonical draft instructions and the declared-gate parsing/validation boundary so prose-appended entries fail early while supported command forms remain compatible.
- CP 3: Add focused regression/compatibility cases, update directly affected workflow documentation if necessary, run all declared gates, and record criterion-by-criterion evidence in the final checkpoint.

### Checkpoint Documentation Requirements
Every checkpoint document (`CP-N.md`) MUST include:
- A concrete summary of work completed in that checkpoint.
- The exact heading `## Goal Check`.
- The exact 3-column table header `| Criterion | Evidence | Status |`, its separator row, and at least one evidence row for every success criterion addressed or deferred.
- Verifiable evidence in the forms Parallix already recognizes:
  1. **File:line references** — e.g., `lib/commands/handoff.ts:762` (must point to an existing file and line)
  2. **Exact test names** — e.g., `"runDeclaredGates rejects prose-appended commands before execution"` (must match a test name in the repository)
  3. **Test file paths** — e.g., `test/task-2214-repro.test.js` or `test/handoff.test.js` (must exist)
  4. **ADR references** — e.g., `ADR 0048` (must correspond to an existing file under `docs/adr/`)
  5. **Recognized repo commands or paths** — backticked commands beginning with `npm ...`, `node ...`, `git ...`, `px ...`, or `./...`, such as `` `node --test test/task-2214-repro.test.js` `` or `` `./scripts/verify-local.sh all` ``
- Raw `stat`/`ls` output or generic prose alone is not enough. Shell output may be supplemental, but it must be paired with at least one accepted file:line, exact test name, ADR, test-file path, or recognized repository command/path reference above.
- A non-generic `Next action:` line at the bottom naming the next implementation, verification, or handoff action.

Example Goal Check table:

| Criterion | Evidence | Status |
|---|---|---|
| Prose-appended gates fail before execution | `test/task-2214-repro.test.js`, `"runDeclaredGates rejects prose-appended commands before execution"` | PASS |
| Draft instructions require command-only gates | `prompts/draft.md:28` | PASS |
| Verification gate ran | `./scripts/verify-local.sh all` | PASS |

## Gates
- [ ] ./scripts/verify-local.sh static-analysis
- [ ] node --test test/task-2214-repro.test.js test/handoff.test.js test/draft.test.js
- [ ] ./scripts/verify-local.sh all

## Restricted Areas
- Do not change checkpoint evidence acceptance rules in `lib/commands/handoff.ts` or review code except where a shared helper is unavoidably affected by the gate-command fix.
- Do not weaken or skip `test/e2e-real-agent-smoke.test.js`, integration pipeline gates, test-hygiene checks, or the red-to-green reproduction requirement.
- Do not modify historical mission/checkpoint artifacts to make existing malformed gates appear valid.
- Changes under `lib/` require the repository static-analysis integration gate.

## Stop Rules
- Stop if the proposed validation would execute a rejected gate to determine whether it is prose; rejection must occur before shell execution.
- Stop and request direction if command-only enforcement would require banning currently supported quoted arguments, shell pipelines, redirects, or compound commands rather than distinguishing the reported suffix pattern.
- Stop if the reproduction test cannot be made red at the mission parent commit without depending on network access, a real remote, or the long-running custom-agent E2E suite.
- Stop if the fix requires bypassing declared gates, checkpoint evidence checks, or integration gates.
- Do not proceed to handoff until the reproduction test is demonstrably green, every SC has accepted Goal Check evidence, and all three declared gate commands pass.
