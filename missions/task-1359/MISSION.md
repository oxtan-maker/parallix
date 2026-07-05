# Mission: Blocking real local-AI e2e for the custom agent launcher surface (task-1359)

## Goal

Add one blocking end-to-end path that runs Parallix against the real `custom` agent family (`opencode` backed by a local model) and proves the launcher surface works in practice: Parallix launches the real local agent with valid arguments, the agent produces parseable workflow artifacts, and the run fails closed when the local-agent contract breaks. This mission must preserve the existing deterministic full-lifecycle harness in `test/e2e-mission-lifecycle.test.js` and add a real-agent path that also blocks integration, so Parallix cannot merge changes that break its own local-AI execution path while developing itself.

## Why Now

`TASK-1356` split the e2e investment into two tiers:

- Tier 1 (`TASK-1358`): a deterministic stubbed full-lifecycle harness to catch workflow composition bugs cheaply and reliably.
- Tier 2 (`TASK-1359`): a real local-model e2e path to catch launcher-surface bugs that the stub cannot see.

This repo already has the Tier 1 outcome in practice: `config/integration-pipelines.json` runs `node test/e2e-mission-lifecycle.test.js` as the `workflow` gate, and that file provisions a throwaway repo plus a scripted `opencode` stub to drive `draft -> active -> review -> integrate`. What is still missing is the Tier 2 realism layer for the `custom` family itself, and leaving that layer advisory-only would not protect Parallix from self-inflicted launcher regressions.

That missing layer matters because the historical failures that motivated this task lived in the real launcher boundary, not the stubbed workflow boundary:

- `TASK-1351`: invalid `-m` / model-launch argument handling for the custom launcher surface.
- `TASK-1273`: real local-agent draft output that Parallix could not parse into a valid mission artifact.

The stubbed lifecycle cannot catch those classes because it bypasses the real `opencode` invocation. For this repository's self-hosting use case, that gap must be closed in a blocking way: if Parallix cannot successfully launch and consume its own configured local agent, integration must stop.

## Refinement Signals

- Predicted NEL bucket: Medium (81-235)
- Confidence: Medium
- Selection note: activate as-is, but keep the scope narrow and fail closed
- Main drivers: launcher-argument regressions, real-agent output regressions, need for one realistic custom-agent blocking layer on top of the existing deterministic harness

## Scope

- Add a dedicated blocking test path for the real `custom` agent family using a cheap local model through the actual `opencode` launcher path in `lib/agents/opencode.ts`.
- Keep the existing deterministic `test/e2e-mission-lifecycle.test.js` path intact as one blocking harness; do not weaken, replace, or de-scope it.
- Run the real-agent path through the real CLI over a throwaway repo and assert integration-surface outcomes:
  - Parallix selected and launched `custom` with the expected launcher contract.
  - The launched agent produced a parseable `MISSION.md` and at least one parseable checkpoint or equivalent workflow artifact required by the exercised path.
  - The run recorded sane launcher/telemetry metadata when available, without inventing fake token data for `custom`.
  - Failures are classified into at least two buckets: local-model / launcher-environment failure vs Parallix workflow failure, and the blocking gate surfaces that distinction clearly.
- Pin the real-agent path to one explicit local-model configuration for the `custom` family so the test is reproducible on machines that have the required model available.
- Wire the real-agent path into the blocking integration gates so changes that break Parallix's own local-agent path cannot merge silently.
- Document prerequisites, invocation, expected runtime, and failure interpretation for operators.

## Out of Scope

- Replacing the existing stubbed full-lifecycle harness with a real-model harness.
- Making the real local-model path optional, advisory, nightly-only, or on-demand-only.
- Asserting semantic quality of the agent's diff, prose quality, or solution correctness beyond parseable workflow artifacts.
- Supporting more than one local model family in the first version.
- Adding cloud-model dependencies or requiring network access.
- Rewriting the `custom` prompt contract or broad agent-selection policy.

## Success Criteria

> Falsifiability rule: every criterion below must be checkable by command result, file content, or explicit configuration state.

- SC1: The repository retains a complete deterministic lifecycle harness. `config/integration-pipelines.json` still contains the `workflow` gate running `node test/e2e-mission-lifecycle.test.js`, and that test file still covers the full `draft -> active -> review -> integrate` path with the existing stubbed agent flow.

- SC2: A blocking command exists for the real local-AI path and is part of the integration gate plan. The command is documented and runnable on a correctly provisioned workstation, for example via a dedicated test selector or script such as `node --test --test-name-pattern "custom smoke" test/e2e-mission-lifecycle.test.js` or `./scripts/verify-local.sh custom-smoke`, and `config/integration-pipelines.json` invokes it directly or through the workflow gate composition.

- SC3: The blocking real-agent path launches the real `custom` agent family through the production launcher path, not a stub binary. Verification: the test setup does not replace `opencode` with a scripted fixture, and the exercised code path reaches the real `lib/agents/opencode.ts` launch logic.

- SC4: The blocking real-agent path completes at least one real mission flow far enough to prove launcher integration. Minimum required artifacts after a passing run:
  - a parseable `MISSION.md` with the headings `## Goal`, `## Scope`, and `## Success Criteria`
  - at least one parseable checkpoint or equivalent workflow artifact written by the mission flow
  - a zero exit status from the Parallix command sequence that exercised the agent

- SC5: Assertions in the blocking real-agent path are restricted to launcher/integration behavior, not solution semantics. The test must verify:
  - the chosen agent family is `custom`
  - the run uses a concrete local-model configuration intended for cheap local execution
  - produced workflow artifacts are parseable by Parallix expectations
  - any captured telemetry / session metadata is structurally sane for the `custom` path

- SC6: A failure from the local model or its launcher is reported distinctly from a Parallix defect, but still fails the blocking gate. At minimum, the implementation must emit diagnosable output that lets an operator distinguish:
  - local model missing / unavailable
  - `opencode` launcher failure or invalid model argument
  - Parallix workflow failure after launch

- SC7: The blocking real-agent path would have caught the motivating bug classes:
  - a broken custom-launch argument such as the `TASK-1351` class causes the smoke test to fail before passing silently
  - non-parseable real-agent draft output such as the `TASK-1273` class causes the smoke test to fail with a parse / artifact diagnosis

- SC8: Documentation explicitly states the real-agent path is blocking for this repository, requires a local model, is expected to be less deterministic than the stubbed harness, and exists specifically to fail closed when Parallix breaks its own local-agent path.

- SC9: If implementation touches files under `lib/`, `./scripts/verify-local.sh static-analysis` passes. Any new blocking real-agent command added by this mission is exercised locally at least once on the implementation workstation, or the mission records the exact external prerequisite that prevented execution.

## Risks and Assumptions

- Assumption: the workstation running this blocking path has `opencode` installed and at least one cheap local model configured for the `custom` family.
- Risk: local-model startup or tool-call instability can make the real-agent path flaky even when Parallix is healthy. Because the path is blocking, the reporting and prerequisite story must be explicit enough that failures are actionable rather than mysterious.
- Risk: a truly full `draft -> active -> review -> integrate` run with a real local model may be too slow or too brittle for the first version. If so, the blocking real-agent path may stop at the earliest lifecycle depth that still proves the launcher boundary and parseability contract, but the mission must state exactly which lifecycle depth remains covered by the real-agent gate.
- Assumption: the existing deterministic e2e harness remains the authoritative merge-gate defense for workflow composition bugs; this task is additive, not substitutive.
- Risk: the `custom` telemetry surface may still expose honest zeros for token counts. The blocking path should validate structure and session recovery, not require fabricated numeric usage.

## Checkpoints

- CP 1: Define the real-agent test entrypoint, model pinning strategy, and blocking gate placement. Decide whether it lives in `test/e2e-mission-lifecycle.test.js` behind a selector or in a dedicated gate script.
- CP 2: Build the throwaway-repo setup for the real `custom` path and prove the real launcher is invoked rather than the stub.
- CP 3: Add assertions for parseable mission artifacts, agent-family selection, and sane launcher metadata. Add distinct failure classification for model / launcher / Parallix failures.
- CP 4: Document prerequisites and invocation. Verify the existing stubbed workflow gate still passes unchanged, wire the real-agent path into the blocking gate plan, and run the real-agent command once if the required local model is available.

## Gates

- [ ] `node test/e2e-mission-lifecycle.test.js`
- [ ] `node test/e2e-real-agent-smoke.test.js`
- [ ] `./scripts/verify-local.sh static-analysis` if any file under `lib/` changes

## Restricted Areas

- Do not remove or weaken the current `workflow` gate in `config/integration-pipelines.json`.
- Do not leave the real local-model path as an advisory-only or nightly-only check.
- Do not assert on diff quality or task-solution semantics from the real model.
- Do not add any requirement for paid/cloud model access.

## Stop Rules

- Stop if the only viable implementation would replace the deterministic stubbed harness instead of adding a separate blocking real-agent layer.
- Stop if no stable local-model configuration for `custom` exists on the target workstation and the task would devolve into speculative plumbing with no runnable command.
- Stop if the proposed blocking real-agent path can only produce undiagnosable red runs where model failures and Parallix failures are indistinguishable.
