# Mission: Make the custom agent runner configurable and add Pi (task-2208)

Base-Branch: skunkworks

## Goal
Replace the current hard-coded assumption that the `custom` agent family always launches through `opencode` with a configurable runner seam, add `pi` as a supported runner for that family, and leave the repo with enough automated coverage, operator documentation, and benchmark evidence to choose an informed default for `custom`.

## Why Now
Parallix currently treats `custom` as synonymous with `opencode`: the launcher docs name `custom -> opencode`, the real-agent smoke gate exercises only the `opencode` path, and the repo-level model config is pinned to a local Qwen model in `workflow.config.json`. That blocks evaluation of alternative local runners even though the backlog intent is explicit: install Pi on the workstation, wire it into Parallix, compare it against the current `opencode` path on the same `custom` workflow, and recommend which runner should be the default. Until `custom` can switch runners without source edits, every experiment is ad hoc and the product cannot express the choice it is already trying to make.

## Refinement Signals
- Predicted NEL bucket: Large (235+)
- Confidence: Medium
- Selection note: activate as-is
- Main drivers: `lib/agents/*.ts` launcher selection and telemetry seams, `workflow.config.json` / product-config handling for `custom`, `test/e2e-real-agent-smoke.test.js` and related launcher tests, operator docs for local-agent setup, and a new or updated ADR capturing the benchmark data and default-runner recommendation

## Scope
- Add a first-class configuration seam that selects the runner backing the `custom` agent family without requiring source edits. The configuration must be readable from the repo’s normal product/workflow config path, not from a one-off test-only override.
- Implement a production launcher path for `pi` parallel to the existing `opencode` path, including command construction, session/resume behavior if Pi supports it, failure handling, and the minimum telemetry surface Parallix needs for stats to remain honest.
- Preserve the existing `opencode` path as a supported `custom` runner and make runner selection explicit in the relevant code, docs, and operator-visible terminology.
- Preserve Forgejo review-surface token discovery for feature-branch missions. A mission drafted from a non-primary base branch must still resolve the same local review credentials that a normal `../parallix`-based mission can use, without requiring ad hoc environment variables.
- Update the real-agent smoke and any focused runner tests so the mission proves the `custom` workflow can run with both `opencode` and `pi`, and capture comparable duration/token evidence for both runs.
- Document workstation/operator setup for Pi, including the model requirement from the backlog (`QuantTrio/Qwen3.6-27B-AWQ-6Bit`) or the exact supported substitute if execution proves Pi cannot use that model as written.
- Investigate whether Graphify can be enabled for Pi in a way that fits Parallix’s existing Graphify posture, and either implement the supported path or document the concrete limitation plus the exact follow-up boundary.
- Add or update an ADR that records the benchmark data, caveats, and a clear recommendation for which runner should be the default for `custom`.

## Out of Scope
- Replacing the `custom` family with a new public family name or removing `opencode` support.
- General agent-framework redesign unrelated to making `custom` choose between supported runners.
- Inventing synthetic token accounting for Pi if Pi does not expose reliable telemetry; in that case the mission must keep stats honest and document the gap.
- Broad Graphify product changes unrelated to Pi support, such as redesigning Codex/Claude Graphify behavior.
- Cloud-hosted model work, non-local runner integrations, or benchmark claims beyond the measured Pi-versus-opencode comparison required by this task.

## Success Criteria
> **Falsifiability rule (ADR 0039 Part 2):** Each criterion must be falsifiable. Forbidden: subjective adjectives ("easy, fast, simple, intuitive, user-friendly, responsive, quick, efficient" without an attached metric) and vague quantifiers ("multiple, several, some, many, few, various"). For refactor / condense / migration missions, the criterion must enumerate the specific elements (rules, files, behaviours) that must survive — generic phrases like "preserve critical content" are not sufficient.

- The repo exposes one explicit configuration field for the `custom` runner, and the production selection path reads it before launch. Evidence must point to the config schema/source and to the launcher-selection code path that dispatches `custom` to `opencode` or `pi` based on that field.
- `custom` launches successfully through the existing `opencode` path when the runner config is set to `opencode`, and the current model override path for `custom` still reaches the launcher invocation. Evidence must include automated test coverage or a real smoke run that proves the `opencode` branch still works.
- `custom` launches successfully through a new `pi` production path when the runner config is set to `pi`. Evidence must include automated test coverage for command construction/selection plus at least one real smoke or benchmark run through the repo’s `custom` workflow.
- The mission captures one measured `custom` E2E run with `opencode` and one measured `custom` E2E run with `pi`, and records duration plus token-usage evidence for both. If Pi cannot emit trustworthy token counts, the evidence must show that explicitly and the ADR must treat the token comparison as unavailable rather than inferred.
- Stats and benchmark evidence remain attributable to the actual backend used for the run: the final tree must not collapse Pi and opencode runs into an indistinguishable `custom` result without backend provenance.
- Forgejo review flows remain usable for missions launched from feature branches: token discovery must resolve the expected local token file(s) from the related worktree/review home even when the mission was not drafted from the primary checkout, and the final tree must include regression coverage for that path.
- Operator docs describe how to install/configure Pi for this repo, how to switch the `custom` runner between `opencode` and `pi`, and any Graphify support or limitation specific to Pi.
- A new or updated ADR under `docs/adr/` includes the measured comparison data, states the benchmark caveats, and ends with a clear recommendation for the default `custom` runner.
- `./scripts/verify-local.sh all` passes on the final tree, and because the mission changes `lib/`, `./scripts/verify-local.sh static-analysis` also passes.

## Risks and Assumptions
- Risk: Pi may not support the same session, resume, or telemetry affordances as `opencode`. Assumption: Parallix can still add Pi behind the `custom` seam if missing features are either handled honestly or documented as unsupported.
- Risk: the backlog names `QuantTrio/Qwen3.6-27B-AWQ-6Bit`, while the current repo config and smoke docs reference different local-model identifiers. Assumption: execution must resolve that mismatch explicitly rather than silently substituting a different model.
  - **Amended during CP-3 execution**: pinning `adapters.agents.models.custom` to a literal model string in `workflow.config.json` was found to be a footgun — the string goes stale every time the operator repoints the locally-served vLLM model, silently breaking the `custom` launcher until someone edits the repo config. The model requirement is satisfied instead by giving each runner its own working default: `opencode` already tracks and reuses its own last-selected local model (`~/.local/state/opencode/model.json`) without a `-m` flag, and `pi` now has an explicit `defaultModel`/`defaultProvider` in `~/.pi/agent/settings.json` pointing at the same vLLM endpoint (`~/.pi/agent/models.json`). `adapters.agents.models.custom` remains fully supported as an *explicit override* for either runner (unchanged in `lib/agents/opencode.ts` / `lib/agents/pi.ts`); it is simply no longer required or pre-populated by default. See `workflow.config.json`, `lib/agents/pi.ts`, `test/e2e-real-agent-smoke.test.js`.
- Risk: the existing real-agent smoke gate is tightly coupled to `opencode` semantics. Assumption: it can be generalized without weakening the guard that currently protects the real local-agent path.
- Risk: Graphify installation/support for Pi may depend on Pi product capabilities outside this repo. Assumption: if Pi cannot support Graphify in a repo-compatible way, documenting the exact blocker plus follow-up boundary is acceptable.

## Checkpoints
- CP 1: Design and configuration seam. Identify every place where `custom` is currently hard-wired to `opencode`, choose the concrete config field and dispatch strategy for runner selection, and define how backend provenance and telemetry will be represented in stats and smoke evidence.
- CP 2: Pi runner implementation. Add the `pi` launcher path, preserve `opencode`, update selection/telemetry/failure handling, harden Forgejo token discovery for feature-branch missions, and add focused unit coverage for the new dispatch and runner behavior.
- CP 3: End-to-end proof and recommendation. Run the required `custom` E2E comparisons for `opencode` and `pi`, update operator docs, document Graphify support or limitations for Pi, and publish the ADR-backed default-runner recommendation.

### Checkpoint Documentation Requirements
Every checkpoint document (CP-N.md) MUST include:
- A short summary of the work completed in that checkpoint, naming which runner branch (`opencode`, `pi`, or shared `custom` dispatch) changed.
- A `## Goal Check` section using that exact heading.
- A 3-column pipe-delimited markdown table using exactly: `| Criterion | Evidence | Status |`.
- At least one evidence row for every success criterion touched so far, using verifiable references Parallix already understands:
  1. **File:line references** — for example the config field, launcher dispatch, runner module, stats provenance, or doc updates such as `lib/agents/agents.ts:210` or `docs/agents.md:14`
  2. **Exact test names** — for example a named unit test or smoke test in `test/e2e-real-agent-smoke.test.js` or `test/agents.test.js`
  3. **Test file paths** — for example `test/e2e-real-agent-smoke.test.js` or a new focused Pi-runner test file under `test/`
  4. **ADR references** — the final recommendation ADR reference, such as `ADR 0050` if that is the assigned number
  5. **Recognized repo commands or paths** — backticked commands/paths such as `./scripts/verify-local.sh all`, `./scripts/verify-local.sh static-analysis`, `node test/e2e-real-agent-smoke.test.js`, `px draft ...`, or `git diff --stat`
- Raw `stat`/`ls` output or generic prose alone is not enough. If shell output is useful, pair it with at least one accepted reference above so the evidence is independently checkable.
- A concrete `Next action:` line at the bottom that names the next runner/config/doc/benchmark step, not a generic “continue implementation”.

Example Goal Check table:

| Criterion | Evidence | Status |
|---|---|---|
| Draft prompt defines checkpoint evidence rules | `prompts/draft.md:28` | PASS |
| Repair loop has targeted incomplete-evidence coverage | `test/repair-handoff.test.js`, `"buildRelaunchPrompt returns string containing Goal Check table and mission slug"` | PASS |
| Verification gate ran | `./scripts/verify-local.sh docs` | PASS |

## Gates
- [ ] ./scripts/verify-local.sh all
- [ ] ./scripts/verify-local.sh static-analysis
- [ ] node test/e2e-mission-lifecycle.test.js
- [ ] node test/e2e-real-agent-smoke.test.js

## Restricted Areas
- Do not remove or weaken the existing `opencode` support for `custom`; the mission adds runner choice, it does not replace one hard-coded assumption with another.
- Do not fabricate Pi token telemetry or benchmark numbers. Missing data must remain missing and be explained in docs/ADR evidence.
- Do not change unrelated agent-family behavior (`codex`, `claude`, `mistral`) except where shared launcher/config plumbing must be generalized for `custom`.
- Do not introduce a config shape that can only be exercised from tests; the runner selection must be reachable through the repo’s real config path.

## Stop Rules
- Stop if Pi cannot be launched non-interactively in a way compatible with Parallix’s runner contract; capture the exact blocker and escalate rather than pretending Pi support exists.
- Stop if the only way to support Pi is to break the current `opencode` smoke path or to remove backend provenance from stats/benchmarks.
- Stop if the benchmark cannot produce one attributable `opencode` run and one attributable `pi` run through the `custom` workflow; without that comparison the default-runner recommendation would be guesswork.
- Stop if Graphify support for Pi depends on external product capabilities that cannot be verified from this repo and no honest repo-side fallback/documentation path exists.
