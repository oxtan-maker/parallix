# Mission: Retake TASK-1359 real-agent smoke test with a locked regression path (task-2201)

## Goal
Correct the delivered TASK-1359 real-agent smoke test so it validates the real Parallix lifecycle the original mission was meant to cover, while preserving the useful pieces already in place and locking the current defect with a failing reproduction test before any fix work starts.

## Why Now
TASK-1359 was marked complete even though its accepted output diverged from the actual brief and left every acceptance criterion effectively open. That leaves the workflow exposed to false confidence in the real-agent path, especially around lifecycle coverage, reviewer forcing, mission-branch execution, and telemetry isolation. This retake exists to fix the mission in place rather than replace it wholesale.

## Refinement Signals
- Predicted NEL bucket: Medium (81–235)
- Confidence: Medium
- Selection note: activate as-is
- Main drivers: existing smoke test must be corrected rather than rewritten; reproduction test must be authored first; lifecycle coverage spans draft through integrate; telemetry isolation and reviewer forcing need explicit assertions; current useful config, failure buckets, docs shape, and blocking-gate registration must survive

## Scope
- Author a failing regression test under `test/` that reproduces the current gap at the mission parent commit and will pass only once the real-agent flow is corrected.
- Rework the real-agent smoke test so it exercises the intended Parallix lifecycle instead of stopping after a single `px draft --agent custom` invocation.
- Ensure the smoke flow uses a representative minimal mission prompt based on the requested hello-world shell program task rather than an invented greeting-helper placeholder.
- Verify that the smoke test executes the mission branch/worktree code under test, not a stale installed `px`.
- Preserve and carry forward the explicit throwaway-repo custom-model config (sourced from this repository's own `workflow.config.json` `adapters.agents.models.custom`, so the smoke run always exercises the same agent configuration Parallix itself uses), failure classification buckets, Parallix-owned state isolation via a temp-scoped `PARALLIX_HOME`, overall docs structure, and blocking integration-gate registration.
- Strengthen telemetry assertions so the test proves Parallix-owned writes (stats.csv and the agent blocking file agents.local.json) stay inside the temp-scoped `PARALLIX_HOME` and validates actual stats output content.
- Clarify and enforce the reviewer-forcing behavior in both test assertions and supporting documentation.
- Update the mission-aligned documentation to match the corrected smoke-test flow and operating expectations.
- test that the actual test works, and is not flaky, and runs in a reasonable amount of time, report time. If the agent is flaky against the harness stop

## Out of Scope
- Making the smoke test non-blocking again; the blocking integration-gate registration stays in place.
- Replacing the preserved good implementation pieces with a brand-new architecture when targeted correction is sufficient.
- Expanding the mission beyond the real-agent smoke-test surface into unrelated workflow, launcher, or telemetry refactors.
- Broadening the scenario into a larger end-to-end product test beyond the minimum surface needed to catch TASK-1351 and TASK-1273 class failures.

## Success Criteria
> **Falsifiability rule (ADR 0039 Part 2):** Each criterion must be falsifiable. Forbidden: subjective adjectives ("easy, fast, simple, intuitive, user-friendly, responsive, quick, efficient" without an attached metric) and vague quantifiers ("multiple, several, some, many, few, various"). For refactor / condense / migration missions, the criterion must enumerate the specific elements (rules, files, behaviours) that must survive — generic phrases like "preserve critical content" are not sufficient.

- A reproduction test exists at the path declared below, fails on the mission parent commit, and encodes the currently missing lifecycle behavior with a red assertion that turns green only after the fix lands.
- The corrected smoke-test path drives the real agent through the intended Parallix lifecycle phases needed for this surface area, not just `draft`, and the assertions prove each required phase transition executed.
- The throwaway mission/task content used by the smoke test is the minimal representative hello-world shell-program task requested in the backlog item, replacing the fabricated greeting-helper task.
- The smoke test proves it is invoking the mission branch/worktree `px` entrypoint under test, with an assertion that would fail if a stale global or installed CLI were used instead.
- Telemetry assertions verify both isolation inputs and outputs via the configuration route (not a hard filesystem sandbox): a temp-scoped `PARALLIX_HOME` is used (the highest-precedence resolver input for both `stats.csv` and the agent blocking file `agents.local.json`), no smoke-run writes appear in the developer's default Parallix state roots (`~/.local/state/parallix` and `~/.parallix`), and the isolated stats file content matches expected smoke-run records. opencode's own runtime state (`XDG_DATA_HOME`) is deliberately left un-sandboxed so the launcher child runs with its normal user configuration.
- Reviewer forcing for the custom agent on its own PR is either explicitly asserted in the test flow or explicitly documented in code comments and docs when the workflow surface exposes it indirectly; ambiguous implicit behavior is not sufficient.
- The preserved implementation elements remain intact after the fix: explicit custom-model adapter config in the throwaway repo (its value sourced from this repository's `workflow.config.json` rather than an independent hardcoded pin), the three failure classification buckets and regex mapping, Parallix-owned state isolation via a temp-scoped `PARALLIX_HOME`, the operational shape of `docs/real-agent-smoke.md`, and registration in `config/integration-pipelines.json` as a blocking gate.
- Verification for the final mission lands cleanly with `./scripts/verify-local.sh all`, and any mission-touched `lib/` files also satisfy `./scripts/verify-local.sh static-analysis`.

## Risks and Assumptions
- The smallest realistic lifecycle needed to catch the cited bug classes may still require several workflow phases; the mission should keep the scenario minimal without dropping a phase that carries unique risk.
- Real-agent smoke tests are environment-sensitive, so failure classification must stay diagnosable and should distinguish environment issues from launcher and workflow defects.
- Telemetry paths may be influenced by both environment variables and config-driven defaults; assumptions about isolation are unsafe unless verified by file-content assertions.
- Reviewer-forcing behavior may be observable only through generated mission artifacts or CLI output; if direct hooks are absent, the mission must define the strongest available assertion and document any residual limitation.
- Preserving the blocking integration gate is a requirement, so any discovered flakiness must be addressed by making the test deterministic rather than by weakening the gate.

## Checkpoints
- CP 1: Author a failing reproduction test at `test/e2e-real-agent-smoke.test.js` that creates the current throwaway real-agent scenario, demonstrates that the existing flow stops short of the required lifecycle and representative task shape, and includes an assertion that fails on the parent commit because the smoke test does not yet cover the required end-to-end phases and artifacts.
- CP 2: Map the smallest lifecycle and artifacts required to catch TASK-1351 and TASK-1273 class regressions while preserving the repo-sourced custom-model config, failure buckets, and temp-scoped `PARALLIX_HOME` isolation approach.
- CP 3: Correct the smoke-test flow and assertions so the lifecycle, mission content, CLI-under-test provenance, telemetry output, and reviewer-forcing behavior are all validated in one deterministic path.
- CP 4: Update `docs/real-agent-smoke.md` to match the corrected flow, prerequisites, runtime expectations, and failure-bucket interpretation without changing the mission’s blocking-gate stance.
- CP 5: Run the required verification gates and capture evidence for the final goal-check handoff.

Reproduction-Test: test/e2e-real-agent-smoke.test.js

## Gates
- [ ] ./scripts/verify-local.sh all
- [ ] ./scripts/verify-local.sh static-analysis — required only if execution touches lib/

## Restricted Areas
- Do not change unrelated workflow behavior outside the real-agent smoke-test path, its documentation, and the minimum supporting configuration needed for this mission.
- Do not remove or downgrade the existing blocking registration in `config/integration-pipelines.json`.
- Do not let the smoke run depend on the developer's ambient Parallix state: the throwaway repo must still set the custom agent model explicitly in its own `workflow.config.json` (populated from this repository's `adapters.agents.models.custom` at setup time) and must keep `PARALLIX_HOME` temp-scoped.
- Do not broaden telemetry changes into a general stats-system redesign.

## Stop Rules
- Stop if proving mission-branch/worktree CLI provenance requires changing core CLI resolution behavior outside the smoke-test mission surface; escalate the boundary instead of widening the mission silently.
- Stop if reviewer-forcing cannot be observed or asserted with the existing workflow interfaces and the only path forward is invasive product instrumentation not justified by this mission.
- Stop if the smoke scenario cannot be made deterministic enough for a blocking integration gate without introducing environment-specific assumptions that would make the gate unreliable.
- Stop if preserving the named good implementation pieces conflicts directly with the minimum fix needed; surface the conflict explicitly before trading one requirement against another.
