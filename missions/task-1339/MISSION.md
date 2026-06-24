# Mission: Diagnose and fix missing qwen/opencode statistics capture (task-1339)

## Goal

Restore reliable stats capture for qwen/opencode runs so that execute, review, and draft stages can persist non-zero qwen telemetry to `<PARALLIX_HOME>/stats.csv` when opencode actually reports usage. The work must identify the exact failure point in the current telemetry path, implement the smallest defensible fix, prove it with automated coverage, verify it on a temporary repo, and leave no temporary verification rows behind in the shared stats CSV.

## Why Now

Completed qwen missions are currently invisible in the workflow statistics even though the agent has been used in production work. That breaks cost tracking, usage reporting, and comparisons across agent families, and it hides whether future qwen runs regress again. This is a workflow-integrity problem, not just a reporting annoyance: the pipeline currently degrades silently when qwen telemetry is lost.

## Refinement Signals

- Estimated agent usage: 25-50%
- Confidence: Medium
- Selection note: activate as-is
- Main drivers: silent telemetry loss, missing qwen rows in stats, no regression coverage around opencode export parsing

## Scope

### In Scope

- Trace the qwen telemetry path across `lib/agents/opencode.js`, `lib/agents/opencode-export.js`, `lib/agents/opencode-telemetry.js`, `lib/agents/stage-telemetry.js`, and `lib/stats.js`.
- Determine the concrete failure mode causing qwen stats to drop:
  - session ID not captured from opencode output
  - `opencode export` not invoked or not parsed successfully
  - export JSON shape not recognized by telemetry extraction
  - stage stats fallback not preserving qwen telemetry
- Patch only the code required to make qwen telemetry flow through to stats recording.
- Add or update automated tests that fail before the fix and pass after it.
- Verify the repaired path on a temporary repo or equivalent isolated verification setup that exercises the real stats-writing flow.
- Remove any temporary verification rows from the global stats CSV after validation.
- Keep the backlog task labeled with exactly `["ai_sdlc"]`.

### Out of Scope

- Reworking telemetry capture for Codex, Claude, Mistral, or any non-qwen agent.
- Changing upstream `opencode` CLI behavior.
- Backfilling missing rows for old missions already completed before the fix.
- Refactoring unrelated review-loop, routing, or mission-state behavior.
- Editing the backlog task `assignee` field.

## Success Criteria

1. The exact root cause is written down in the execution notes with specific file references and a reproducible failing condition.
2. The relevant qwen telemetry path is patched so that a valid qwen run no longer resolves to null or all-zero telemetry when export data exists.
3. At least one automated regression test covers the previously failing scenario end-to-end through the qwen telemetry capture path.
4. `npm test` passes after the change with no newly introduced failures.
5. An isolated verification run produces at least one qwen stats row with non-zero usage values in the stats CSV.
6. Any temporary verification repo, mission rows, or other generated stats artifacts are removed after validation.
7. The backlog task frontmatter ends with exactly one label, and it is `ai_sdlc`.

## Risks and Assumptions

- Assumption: The local environment can run the existing test suite and the qwen verification path needed for this mission.
- Assumption: opencode still exposes enough session/export data locally to recover telemetry without changing the upstream tool.
- Risk: The export schema may differ by opencode version, so the fix may need to tolerate more than one valid payload shape.
- Risk: Session ID capture may be brittle if the launcher depends on incidental stdout formatting.
- Risk: Verification can pollute the shared stats CSV unless cleanup is handled explicitly.

## Checkpoints

- CP1: Inspect the current qwen telemetry flow and identify where data is dropped.
- CP2: Reproduce the failure in a focused automated test or fixture-driven path.
- CP3: Apply the minimal fix and get `npm test` green.
- CP4: Verify qwen stats write correctly in an isolated run and clean up temporary stats artifacts.

## Gates

- [ ] Root cause is concrete and reproducible.
- [ ] Fix is limited to qwen/opencode telemetry capture and related tests.
- [ ] Automated regression coverage exists for the failing case.
- [ ] `npm test` passes.
- [ ] Verification shows a non-zero qwen stats row.
- [ ] Temporary verification data is removed from the shared stats CSV.
- [ ] Backlog labels remain exactly `["ai_sdlc"]`.

## Restricted Areas

- Do not edit the backlog task `assignee` field.
- Do not rename, move, or delete the backlog task file.
- Do not change mission workflow state files outside this mission unless verification cleanup requires removing temporary stats data.
- Do not broaden the change into a general telemetry refactor.
- Do not touch other agent implementations unless a shared helper must change and the qwen fix cannot be done safely without it.

## Stop Rules

- Stop if the only viable fix would require changing the upstream `opencode` binary rather than this repository.
- Stop if verification would require leaving permanent synthetic rows in the shared stats CSV.
- Stop if the investigation expands beyond qwen/opencode telemetry capture into unrelated workflow behavior.
- Stop after the smallest fix that satisfies all success criteria; do not continue into cleanup refactors or opportunistic redesign.
