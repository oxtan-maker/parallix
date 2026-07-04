# Mission: Stop false Codex/Mistral blocking by fixing launcher runtime and completion attribution (task-1416)

## Goal

Stop Codex and Mistral from being falsely retried, rerouted, or blocklisted by fixing both sides of the problem: the launcher runtime contract each CLI needs in order to complete normally, and the family-specific completion attribution logic used when a non-zero exit must still be interpreted.

## Why Now

The backlog task is explicit that the current heuristic approach has not closed the issue: Codex and Mistral still get blocked on plain `exit 1`, and the next mission needs to pivot from more error-pattern guessing to understanding both what a successful run looks like and what runtime prerequisites the real CLIs require. Investigation may prove that the false autoblocks come from a mixed root cause: some runs are misclassified after completion, while others are genuine launcher failures caused by an incomplete environment (for example shared global log paths, missing writable homes, or missing explicit workdir/tmp access). This mission should therefore be framed as a reproduction-first launcher/runtime plus classification fix, not as another broad pattern-expansion task.

## Refinement Signals

- Predicted NEL bucket: Medium (81–235)
- Confidence: Medium
- Selection note: activate as-is
- Main drivers: persistent false autoblocks after earlier fixes; existing code already shows the right architectural direction through `isSpuriousOpencodeExit()`; likely touchpoints are localized to `lib/agents/`

## Scope

- Author a failing reproduction that demonstrates the real bug on the current tree: Codex and/or Mistral either complete successfully but are still treated as launch failures, or fail only because Parallix launched them without the runtime contract those CLIs require.
- Trace the launch-result classification path in `lib/agents/agents.ts` and the Codex/Mistral launcher adapters to identify both: (a) trustworthy completion signals, and (b) launcher/runtime requirements such as isolated writable homes, explicit workdir selection, and session-log isolation.
- Implement the smallest family-specific change set needed so Codex and Mistral no longer enter the launch-failure reroute/blocklist path for successful runs, and no longer fail spuriously because Parallix launched them with an incomplete runtime environment.
- Add focused regression coverage in `test/` that proves the reproduced red cases go green without weakening real failure handling, including tests for any new per-agent launcher/runtime contract.
- Update comments or mission-local documentation only where the new success-classification rule would otherwise be non-obvious.

## Out of Scope

- Reworking limit-hit parsing in `lib/agents/limit-hit.ts` unless the reproduction proves limit classification is the actual bug.
- Expanding `NON_BLOCKING_LAUNCH_ERROR_PATTERNS` as the primary strategy for this mission.
- Changing blocklist schema, retry budgeting, agent selection policy, or fallback ordering beyond what is required by the reproduced Codex/Mistral path.
- Adding generalized "spurious exit" handling for every agent family without family-specific evidence.
- Altering stats, telemetry reporting, or mission lifecycle behavior outside the launcher/runtime and launch-result success/failure surfaces required for Codex/Mistral correctness.

## Success Criteria
> **Falsifiability rule (ADR 0039 Part 2):** Each criterion must be falsifiable. Forbidden: subjective adjectives ("easy, fast, simple, intuitive, user-friendly, responsive, quick, efficient" without an attached metric) and vague quantifiers ("multiple, several, some, many, few, various"). For refactor / condense / migration missions, the criterion must enumerate the specific elements (rules, files, behaviours) that must survive — generic phrases like "preserve critical content" are not sufficient.

- SC 1: `test/task-1416-repro.test.js` fails on the mission parent commit by demonstrating that a Codex or Mistral launcher result with `status === 1` and a valid success signal is still classified as a launch failure by the current code.
- SC 2: After the fix, the reproduced Codex case is treated as successful: `startAgent()` returns the Codex run instead of rerouting to another family or writing a blocklist entry for that attempt, and the accepted telemetry is correlated to the current invocation rather than a later wall-clock read.
- SC 3: After the fix, the reproduced Mistral case is treated as successful: `startAgent()` returns the Mistral run instead of rerouting to another family or writing a blocklist entry for that attempt, and the accepted telemetry comes from a mission-local launch runtime rather than a shared global session directory.
- SC 4: Genuine Codex/Mistral failures that do not expose the approved success signal still follow the existing failure path, and a focused test proves they continue to reroute or block exactly as before.
- SC 5: Existing `custom`/opencode spurious-exit handling remains intact; the mission must not regress `isSpuriousOpencodeExit()` behavior while extending equivalent protection to Codex/Mistral.
- SC 6: If files under `lib/` change, `./scripts/verify-local.sh static-analysis` passes on the final tree.
- SC 7: `./scripts/verify-local.sh all` passes on the final tree.

## Risks and Assumptions

- Risk: a weak success heuristic could convert real failures into false successes. Mitigation: only accept success signals that are already emitted by the launcher or its telemetry/session side effects and that can be demonstrated in hermetic tests.
- Risk: Mistral's default config may still point session logging at a shared global directory even when `VIBE_HOME` is overridden. Mitigation: if runtime isolation is required, rewrite or override the session log destination so the mission-local launcher owns its own telemetry path.
- Risk: Codex and Mistral may require different success criteria and different runtime setup. Mitigation: allow family-specific helpers and family-specific launcher setup instead of forcing one generic rule.
- Assumption: the repo already exposes enough seams to simulate Codex and Mistral success-with-exit-1 cases without live provider access.
- Assumption: the bug may span both launch-result classification after the child process returns and launcher/runtime setup before the child process starts.

## Checkpoints

- CP 1: Author the failing reproduction test at `test/task-1416-repro.test.js`. The test must simulate Codex and Mistral launcher results that exit with status `1` while also emitting the family-specific success evidence the implementation will honor, and assert that the current parent commit still treats those runs as failures (red) even though they should be accepted as successful completions (green after the fix).

Reproduction-Test: test/task-1416-repro.test.js

- CP 2: Identify the trustworthy success signals for each family, name the responsible decision point in code, and determine whether the launcher runtime itself must change (home/workdir/tmp/session-log isolation) before those signals can be trusted. Expected investigation surface: `lib/agents/agents.ts`, `lib/agents/codex.ts`, `lib/agents/mistral.ts`, and any directly used telemetry/session helper needed to prove completion.
- CP 3: Implement the smallest correct Codex/Mistral change set, including any family-specific launcher/runtime setup and any family-specific success-classification logic, while keeping the existing reroute/blocklist path unchanged for runs that lack the approved success signal.
- CP 4: Add or update focused regression tests covering both the new green path and an unchanged real-failure path, plus any new launcher/runtime contract required for Mistral or Codex correctness.
- CP 5: Run the required verification gates and capture proof for the final checkpoint.

## Gates

- [ ] ./scripts/verify-local.sh all
- [ ] ./scripts/verify-local.sh static-analysis

## Restricted Areas

- Keep the implementation inside the agent-launch/result-classification surface unless the reproduction proves another dependency is unavoidable.
- Mission-local launcher runtime setup for Codex/Mistral homes, workdir selection, and session-log isolation counts as in-scope work inside that surface.
- Do not change blocklist file formats or persistent-data migration behavior for this mission.
- Do not change unrelated agent families (`claude`, `custom`) except where shared helpers must be touched to preserve existing behavior.
- Do not solve this mission by suppressing every `exit 1`; the contract requires family-specific success evidence.

## Stop Rules

- Stop if no hermetic Codex or Mistral reproduction can prove "successful despite exit 1" from repo-local evidence.
- Stop if the only available approach is a broad heuristic that would classify unstructured `exit 1` failures as success without a concrete completion marker.
- Stop if fixing the issue requires external-provider state or live-network observation that cannot be represented in tests from the current tree.
- Stop if investigation shows the task is actually a limit-hit parsing bug or a blocklist-read/write bug rather than a launcher/runtime or exit-classification bug; re-scope before implementation.
