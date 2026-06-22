# Mission: Eliminate intermittent qwen/opencode agent `exit 1` failures during workflows (task-1273)

## Goal

Diagnose and fix the intermittent non-zero exit (`exit 1`) failures of the qwen (opencode) agent that occur during workflows such as the draft workflow. After this mission, an opencode run that does real work and produces valid output should not exit with status 1 for a transient or self-inflicted reason, and the launcher's failure-handling path should correctly classify the remaining genuine failures (model-not-found, limit-hit, true crashes) instead of treating recoverable conditions as hard launch failures.

## Why Now

The qwen/opencode agent surfaces failures as `[WARN] Agent qwen (opencode) failed to complete (exit 1 ...); retrying with next eligible agent.` (emitted from `lib/agents/agents.js:811`). These failures are intermittent: the same task often succeeds on a later attempt or on a different agent, which wastes the qwen attempt, forces a reroute to another agent family, and makes qwen unreliable for the workflows it is pinned to. Because the failure is non-deterministic, it has not been traced to a single root cause. This mission isolates the cause(s) and removes the avoidable ones.

## Refinement Signals

- Estimated agent % usage limit: 25-50%
- Confidence: Medium-High
- Selection note: activate as-is
- Main drivers: intermittent `exit 1`, reroute waste, unreliable qwen runs

## Scope

### In Scope

- **Root cause analysis**: Reproduce and characterize the `exit 1` failures from the qwen/opencode launcher. Trace the path from `startOpencodeAgent` in `lib/agents/opencode.js` through `spawnAndTee` to the launch-failure detection in `lib/agents/agents.js` (the `launchFailed` branch around line 800-811). Determine whether the exit-1 originates from: (a) the `opencode` CLI itself (e.g. model-not-found, transient API/network error, rate/limit conditions not classified as limit-hits), (b) misclassification in the launcher (treating an ambiguous or recoverable exit as a hard failure), or (c) the best-effort telemetry export path (`captureOpencodeExport` / `opencode export`) leaking a non-zero status into the result.
- **Classification fix**: If recoverable or transient conditions (e.g. a known-retryable opencode error, or a limit-hit that is not being detected) are being reported as `exit 1` launch failures, correct the classification so they are handled appropriately (limit-hit accounting, bounded retry, or clean surfacing) rather than counted as a generic failure-and-reroute.
- **Resilience fix**: Where the failure is genuinely transient (network/API blips), add the minimal, bounded mitigation appropriate to the launcher (e.g. a single in-family retry before rerouting), without masking real failures.
- **Telemetry isolation guard**: Confirm and, if necessary, harden the guarantee documented in `opencode.js` that telemetry/export failures never affect the launch result status.
- **Regression coverage**: Add or extend unit tests (using the existing `__setSpawnAndTeeForTest` / `__setExportCaptureForTest` hooks) that lock in the corrected exit-1 classification behavior.
- **Verification**: Run `npm test` to confirm zero test failures after changes.

### Out of Scope

- Changes to other agent launchers (`lib/agents/codex.js`, `lib/agents/claude.js`, `lib/agents/mistral.js`) — only qwen/opencode is in scope.
- Rewriting the agent-selection/reroute loop in `lib/agents/agents.js` beyond the opencode-specific classification needed for this fix.
- Changes to the `opencode` CLI binary itself or its upstream behavior (we adapt to it; we do not patch it).
- Changes to the backlog task file format, section markers, or frontmatter schema.
- Editing the `assignee` field on any backlog task.

## Success Criteria

1. **Reproduced and documented root cause**: The mission records the concrete origin of the `exit 1` failures (CLI error class, launcher misclassification, or telemetry leakage), with the specific code path identified by file and line.

2. **Recoverable conditions no longer reported as generic failures**: Any condition identified as recoverable/transient (limit-hit, known-retryable opencode error) no longer flows into the `launchFailed` branch as a generic `exit 1`. Verified by a unit test asserting the corrected classification.

3. **Telemetry export cannot change launch status**: A failing/throwing `captureOpencodeExport` leaves `result.status` unchanged. Verified by a unit test using `__setExportCaptureForTest` to inject a failing export.

4. **Bounded mitigation, no masking**: If a retry is added, it is bounded (does not loop indefinitely) and a genuine hard failure (e.g. model-not-found / ENOENT) still surfaces as a failure. Verified by a unit test.

5. **Label set to `ai_sdlc`**: The backlog task frontmatter contains exactly one label: `["ai_sdlc"]`.

6. **`npm test` passes**: All tests pass with zero failures after changes.

## Risks and Assumptions

- Assumption: The `exit 1` originates at or below the opencode launcher (CLI or launcher classification), not in unrelated workflow orchestration. The first checkpoint validates this.
- Risk: The failure may be genuinely external (opencode API/network), making full elimination impossible. In that case the deliverable is correct classification plus bounded retry, not a guarantee of zero failures.
- Risk: Over-eager retry could mask real failures or amplify load against a rate-limited API. Retries must be bounded and must not retry non-retryable errors (model-not-found, ENOENT/EACCES).
- Assumption: The existing test hooks (`__setSpawnAndTeeForTest`, `__setExportCaptureForTest`) are sufficient to reproduce the failure modes deterministically in tests without invoking the real `opencode` binary.

## Checkpoints

- CP 1: Reproduce/characterize the failure. Trace `startOpencodeAgent` → `spawnAndTee` → the `launchFailed` detection in `lib/agents/agents.js`. Identify whether exit-1 comes from the CLI, the classifier, or the telemetry path. Write down the specific path.
- CP 2: Apply the targeted fix (classification correction and/or bounded retry and/or telemetry isolation guard). Add regression tests via the injectable I/O hooks.
- CP 3: Set the backlog task label to `ai_sdlc`. Run `npm test` and verify zero failures.

## Gates

- [ ] All 6 success criteria verified (root cause documented, classification/telemetry/retry tests, label validation, npm test).
- [ ] `npm test` passes with 0 failures.
- [ ] `./scripts/verify-local.sh docs` passes (if present).

## Restricted Areas

- Do not modify `lib/agents/codex.js`, `lib/agents/claude.js`, or `lib/agents/mistral.js`.
- Do not modify the agent-selection/reroute loop in `lib/agents/agents.js` beyond the opencode-specific classification required for this fix.
- Do not modify the backlog task file format, section markers, or frontmatter schema.
- Do not modify the `assignee` field on any backlog task.
- Do not commit or push changes; the harness manages version control.
- Do not modify other missions' files.

## Stop Rules

- Stop before rewriting the opencode launcher or the spawn/tee core — focus on the specific classification/resilience gap.
- Stop before changing how other agents (codex, claude, mistral) launch or report status.
- Stop before adding unbounded or aggressive retries; a single bounded in-family retry is the ceiling for transient mitigation.
- If the root cause is genuinely external to this codebase (opencode CLI/API) and cannot be classified or mitigated within reasonable effort, document the hypothesis and the corrected classification, then stop — do not speculate about or patch the opencode binary.
