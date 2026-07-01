# Mission: Wire a real Parallix E2E integration gate and land the first lifecycle suite (task-1397)

## Goal

Complete the real intent of TASK-1397 from the backlog task, not just the narrow "add one test" interpretation. The deliverable is:

1. add support in Parallix for a configurable integration-time E2E gate that can run before `px integrate` lands a mission,
2. keep that support product-safe by defaulting to no-op unless a repo config opts in,
3. configure Parallix itself to opt in to that gate, and
4. land the first deterministic end-to-end test suite that exercises the full real mission lifecycle (`draft -> active -> review -> integrate`) with only the agent stubbed.

## Why Now

The current gap is not just missing test coverage. The backlog task explicitly asks for E2E to run before integrating a ready-for-integration mission and for that behavior to exist as a reusable Parallix capability, not a one-off repo script. Without product-level gate support plus a self-hosted configuration in this repo, the happy-path lifecycle test can exist but still fail to protect future integrations.

The specific regression cluster remains the same:
- TASK-1317: id minted twice
- TASK-1352: wrong rootDir / base-worktree behavior on feature-branch missions
- TASK-1327: wrong board state after review
- TASK-1275: slug <-> task-id mismatch through integrate

Those failures live at the composition boundary between draft, worktree resolution, review, and integrate. A deterministic full-lifecycle E2E gate is the right protection surface.

## Refinement Signals

- Predicted NEL bucket: Medium (81-200)
- Confidence: Medium
- Selection note: the original draft was underscoped; redraft to include product gate wiring plus repo adoption
- Main drivers: reusable gate support, self-hosted gate adoption, deterministic lifecycle coverage, feature-branch regression surface

## Scope

- Audit the existing task-1358 carryover and keep whatever is valid
- Add or repair product-level support for a configurable integration-time E2E gate that `px integrate` can execute before landing
- Preserve the workflow-product boundary: gate behavior must be repo-configured, not hardcoded to Parallix-specific paths inside generic workflow logic
- Ensure the default product behavior is safe when the gate is not configured: no-op / not required rather than a hard failure
- Configure this Parallix repo to opt in to the new E2E gate in its integration gate configuration
- Land the first deterministic lifecycle E2E suite in `test/e2e-mission-lifecycle.test.js`
- Use the real CLI flow:
  - run `node px.ts draft ...` from the base checkout,
  - enter the created mission worktree,
  - run the real active/review/integrate lifecycle from there
- Stub only the agent
  - prefer `custom` as the stubbed family, not `codex`
  - preserve the ability to force same-family reviewer behavior when multiple agents are available
- Include graphify in the test path because graphify-first behavior is part of the expected workflow contract
- Verify the feature-branch base-path scenario, not just the primary-branch path
- Update any docs/config needed so the new gate is understandable and actually active in this repo

## Out of Scope

- Real model execution against Codex, Claude, or hosted providers
- Networked Forgejo end-to-end validation
- Nightly / CI-hosted E2E infrastructure outside the local-first integrate flow
- Broader negative-path matrixes like merge conflicts, stale remote state, or provider outages unless directly required to make the gate credible
- A second smoke suite for real local-model availability; that belongs to the separate smoke-track tasks

## Success Criteria

> Each criterion must be falsifiable.

1. Parallix exposes a configurable integration-time gate path that can run an E2E command before `px integrate` lands a mission, and that path is repo-configured rather than Parallix-hardcoded.
2. When a repo does not opt into the E2E gate, integration behavior remains valid and does not fail merely because no E2E gate is configured.
3. This repo opts into the E2E gate in its integration configuration, so the lifecycle suite is part of Parallix’s own integration path rather than a loose developer-only command.
4. `test/e2e-mission-lifecycle.test.js` exercises the real lifecycle with only the agent stubbed and covers:
   - feature-branch mission lifecycle,
   - primary-branch mission lifecycle,
   - artifact/state assertions across mission, checkpoints, review artifacts, and integrate cleanup.
5. The stubbed-agent path uses `custom` semantics or an equivalent explicit stub route so the suite is not dependent on Codex weekly usage availability.
6. The test path includes graphify availability/behavior as part of the expected workflow contract rather than omitting it from the environment.
7. The gate wiring and the lifecycle suite together catch the mission-lifecycle composition surface before merge, not only as an ad hoc manual test.
8. Final verification proves both the target test and the configured integration gate path are green on the final tree.

## Risks and Assumptions

- Risk: the current product gate model may not yet have a clean seam for a repo-owned E2E gate.
  - Mitigation: extend the existing integration-pipeline mechanism rather than inventing a special-case path.
- Risk: forcing same-family reviewer behavior may require a small harness/product seam because the real workflow can see multiple agents.
  - Mitigation: prefer explicit implementer/reviewer forcing flags or a narrow stub-agent route, but keep the actual lifecycle commands real.
- Risk: graphify may be absent on some machines.
  - Mitigation: the repo/test contract should make graphify participation explicit and deterministic rather than accidentally depending on ambient PATH state.
- Assumption: a deterministic local stub can satisfy the real mission artifact contract well enough to exercise the workflow without a live model.
- Assumption: `px integrate` is still the right landing surface for this gate, consistent with the integration-pipeline architecture already present in the repo.

## Checkpoints

- CP 1: Re-scope the mission from "test only" to "gate support + repo adoption + first suite", and identify the exact product/config/test surfaces to change.
- CP 2: Implement or repair the integration-gate support needed for a repo-owned E2E lifecycle gate with safe default behavior when unconfigured.
- CP 3: Configure Parallix itself to opt into the new E2E gate in repo-side integration configuration.
- CP 4: Land the deterministic lifecycle E2E suite that uses the real draft/worktree/active/review/integrate flow with only the agent stubbed and graphify included.
- CP 5: Verify the suite directly, verify repo-level test coverage, and verify the configured gate path on the final tree.

## Gates

- [ ] ./scripts/verify-local.sh docs
- [ ] npm test
- [ ] Prove the configured integration gate path includes and passes the new E2E suite on the final tree

## Restricted Areas

- Do not hardcode Parallix-repo-specific paths into generic workflow product logic
- Do not replace the lifecycle with mocks; only the agent may be stubbed
- Do not make E2E a per-checkpoint gate; it belongs at integration time
- Do not introduce a solution that depends on real Codex availability for routine green runs

## Stop Rules

- Stop if the only way to make the gate work is to bypass the real lifecycle commands
- Stop if the design requires Parallix to hardcode repo-specific E2E commands in product logic instead of reading repo configuration
- Stop if the graphify requirement cannot be represented honestly in the test harness
- Stop if the solution lands only a test file while leaving the gate/product-adoption part undone
