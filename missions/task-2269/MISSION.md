# Mission: Make self-development integration E2E agent configurable (task-2269)

## Goal
Allow an explicit `px integrate <slug> --real-agent codex --real-agent-model gpt-5.6-luna` invocation to run the real-agent integration smoke lifecycle with Codex and that model, while callers without both options retain the current custom-agent smoke selection and command unchanged.

## Why Now
This checkout has Codex available but not the current Pi/custom-agent route. The blocking `custom-agent-smoke` integration gate therefore cannot validate Parallix while it develops itself. A validated, narrowly forwarded override enables self-development verification without silently changing the default required by ordinary repositories and existing local-agent environments.

## Refinement Signals
- Predicted NEL bucket: Medium (81–235)
- Confidence: High
- Selection note: activate as-is
- Main drivers: `lib/commands/integrate.ts` argument and gate-environment handling, `scripts/verify-local.sh integrate` forwarding, `test/e2e-real-agent-smoke.test.js` runner/model dispatch and fixture eligibility, regression coverage in `test/integrate.test.js` and `test/integration-pipelines.test.js`, and operator documentation for the opt-in interface

## Scope
- Add the paired `--real-agent <family>` and `--real-agent-model <model>` options to `px integrate`, including rejection of unknown options, missing values, duplicate options, and incomplete agent/model pairs before integration gates or merge actions start.
- Forward validated override values from `px integrate` to `./scripts/verify-local.sh integrate` using structured arguments or environment values, without constructing a shell command from unchecked input.
- Add matching validation and forwarding in `scripts/verify-local.sh integrate` so only the `custom-agent-smoke` gate receives the opt-in real-agent override; all other resolved gates keep their existing command and environment contract.
- Generalize `test/e2e-real-agent-smoke.test.js` from custom-runner selection to agent-family and model selection, adding a Codex `gpt-5.6-luna` lifecycle path through the production workflow and retaining the no-override custom `opencode`/`pi` behavior.
- Adjust the disposable smoke fixture only as needed to allow Codex as its selected workflow agent while preserving lifecycle, isolation, failure-classification, and assertion coverage.
- Add regression tests for CLI parsing, CLI-to-script forwarding, script-to-smoke forwarding, Codex/model selection, and no-override default behavior.
- Update the relevant operator-facing CLI and real-agent-smoke documentation with the supported paired flags, self-development invocation, Codex/model prerequisite, and no-override fallback behavior.
- Make affected unit tests deterministic across developer machines: use controlled launcher/provider/process doubles instead of discovered workstation CLIs, a live Forgejo endpoint, or machine-specific executable startup behavior.
- Normalize temporary-path assertions where macOS resolves `/var` through `/private/var`, while retaining assertions about the intended file or worktree identity.

## Out of Scope
- Changing the configured default custom runner, default model, or `custom-agent-smoke` command for integrations without an override.
- Adding arbitrary gate-command passthrough, arbitrary environment injection, or shell-string interpolation for user-provided values.
- Redesigning agent-family configuration, adding new agent families, or changing unrelated Codex/Claude/custom launcher behavior.
- Replacing the real-agent smoke lifecycle with a stubbed test, weakening its existing lifecycle/isolation assertions, or making Codex a requirement for repositories that do not request it.
- Changing production launcher health-check defaults, Forgejo defaults, or integration-only smoke behavior to compensate for unit-test timing or host configuration.
- Changing integration ordering, merge/review behavior, or integration-pipeline configuration except for the minimum targeted forwarding mechanism.

## Success Criteria
> **Falsifiability rule (ADR 0039 Part 2):** Each criterion must be falsifiable. Forbidden: subjective adjectives ("easy, fast, simple, intuitive, user-friendly, responsive, quick, efficient" without an attached metric) and vague quantifiers ("multiple, several, some, many, few, various"). For refactor / condense / migration missions, the criterion must enumerate the specific elements (rules, files, behaviours) that must survive — generic phrases like "preserve critical content" are not sufficient.

- `px integrate <slug> --real-agent codex --real-agent-model gpt-5.6-luna` accepts exactly one value for each paired option and passes `codex` and `gpt-5.6-luna` to the integration verification invocation; targeted automated coverage proves the values arrive without being appended to a shell command string.
- `px integrate` rejects an incomplete pair, a missing option value, duplicate `--real-agent` or `--real-agent-model` options, and an unsupported agent family before it invokes any integration gate or merge action; each case has an actionable error assertion in a named regression test.
- `./scripts/verify-local.sh integrate --real-agent codex --real-agent-model gpt-5.6-luna` validates the same pair and supplies it only to the `custom-agent-smoke` process; the `lib`, `build`, `workflow`, and other applicable gate commands and their existing environment contract remain unchanged.
- The real-agent smoke fixture selects the Codex production adapter with model `gpt-5.6-luna` when both override values are provided, completes its existing `draft -> refine -> active -> review` lifecycle assertions with a test-controlled Codex command fixture, and has an exact test name proving this selection.
- With no real-agent override, the integration configuration retains `custom-agent-smoke` command `node test/e2e-real-agent-smoke.test.js`, and smoke selection retains the existing configured custom runner (`opencode` or `pi`) and model behavior; regression tests cover this no-override path.
- The relevant CLI/operator documentation states the exact self-development command, explains that both flags are required together, identifies Codex/model availability as a prerequisite, and states that no override preserves the custom-agent default.
- Default unit-test execution does not invoke a discovered real agent CLI or a real Forgejo service; the affected tests use explicit deterministic doubles, and macOS temporary-path coverage accepts the physical resolved path for the same fixture.
- `./scripts/verify-local.sh all` and `./scripts/verify-local.sh static-analysis` exit successfully on the completed tree.

## Risks and Assumptions
- Risk: `integrate` performs preflight, gate invocation, and merge work in one command, so loose parsing could allow invalid selections to reach an irreversible step. Assumption: option validation can occur before the existing preflight/gate boundary and be covered without calling a real merge.
- Risk: the integration script currently executes configured gate commands with `bash -lc`; forwarding user values through command interpolation would permit quoting or injection defects. Assumption: validated values can be passed as dedicated structured arguments or environment entries consumed only by the smoke process.
- Risk: the real-agent fixture is coupled to the custom family and may explicitly exclude Codex. Assumption: its disposable repository configuration can permit Codex without losing the current lifecycle, telemetry-isolation, and fail-closed checks.
- Risk: the Codex CLI may not accept `gpt-5.6-luna` through the existing adapter/model-selection contract. Assumption: the workstation has a usable Codex CLI and the model can be selected as specified; execution must verify this before altering defaults.
- Risk: actual cloud-backed Codex runs may be slower or unavailable. Assumption: deterministic fixture coverage can prove forwarding and adapter command construction, while any required live smoke run records its environment limitation honestly.

## Checkpoints
- CP 1: Trace `px integrate`, its verification invocation/environment builder, `verify-local.sh integrate`, the configured `custom-agent-smoke` gate, and the smoke fixture. Add failing focused tests that lock the paired-option parsing, invalid-pair rejection before gate/merge execution, and forwarded-value boundaries.
- CP 2: Implement validated CLI and script forwarding so the override reaches only the real-agent smoke gate. Add regression coverage proving all non-smoke gates and no-override invocations retain their current commands and environment.
- CP 3: Generalize the real-agent smoke fixture for agent-family/model selection, add the controlled Codex `gpt-5.6-luna` lifecycle case, and retain explicit custom `opencode`/`pi` no-override coverage.
- CP 4: Update operator documentation, run the required gates, and publish checkpoint evidence mapping every success criterion to the final code paths, exact tests, and commands.
- CP 6: Replace machine-dependent unit-test launcher/provider/process paths with controlled fixtures, add macOS physical-path coverage, and prove the focused agent, Forgejo, and path suites pass without changing production defaults.

### Checkpoint Documentation Requirements
Every checkpoint document (CP-N.md) MUST include:
- A summary of work done that names the CLI, integration-script, smoke-fixture, test, or documentation boundary changed.
- The exact heading `## Goal Check`.
- The exact 3-column pipe-delimited markdown table header `| Criterion | Evidence | Status |`.
- At least one evidence row for every success criterion addressed so far. Parallix already verifies these evidence forms: existing file:line references, exact test names, existing test file paths, ADR references, and recognized repository commands or paths such as backticked `npm ...`, `node ...`, `git ...`, `px ...`, or `./...`.
- For this mission, record the forwarding locations from `lib/commands/integrate.ts` and `scripts/verify-local.sh`, the exact regression test name(s), `test/e2e-real-agent-smoke.test.js`, the no-override evidence, and the required gate command results.
- Raw `stat`/`ls` output or generic prose alone is not enough evidence; when including shell output, pair it with one of the accepted references above.
- A concrete `Next action:` line at the bottom naming the next parser, forwarding, fixture, documentation, or verification step.

Example Goal Check table:

| Criterion | Evidence | Status |
|---|---|---|
| Draft prompt defines checkpoint evidence rules | `prompts/draft.md:28` | PASS |
| Repair loop has targeted incomplete-evidence coverage | `test/repair-handoff.test.js`, `"buildRelaunchPrompt returns string containing Goal Check table and mission slug"` | PASS |
| Verification gate ran | `./scripts/verify-local.sh docs` | PASS |

## Gates
- [ ] ./scripts/verify-local.sh all
- [ ] ./scripts/verify-local.sh static-analysis

## Restricted Areas
- Do not modify default custom-agent runner/model configuration or the no-override `custom-agent-smoke` command.
- Do not pass user-supplied runner/model text through `bash -lc`, a dynamically constructed gate command, or arbitrary environment passthrough.
- Do not weaken, skip, or replace existing real-agent lifecycle, fixture-isolation, health-check, failure-classification, or telemetry assertions to make Codex selectable.
- Unit tests may replace launcher discovery, provider availability/API calls, telemetry collection, and process execution with explicit deterministic doubles; this exception does not apply to the integration-only real-agent smoke lifecycle.
- Do not change unrelated integration gate ordering, merge semantics, review workflow behavior, agent-family eligibility, or external credentials/configuration.

## Stop Rules
- Stop and request direction if Codex cannot select `gpt-5.6-luna` through the existing supported adapter contract; capture the exact CLI capability/error and do not substitute a different model silently.
- Stop if forwarding the override safely requires arbitrary shell-command construction, arbitrary environment injection, or changing the default gate command; present a bounded alternative design instead.
- Stop if the only way to make Codex selectable removes or weakens existing smoke lifecycle, isolation, fail-closed, or custom-runner assertions.
- Stop before broadening scope if the required behavior needs a new public configuration schema or a change to default agent selection beyond the paired integration override.
