# CP-3: Checkpoint and Review import

## Summary of Work Done

Extended `MissionCompatibilityImporter` to map checkpoint artifacts and review-state files from mission directories into checked `CheckpointData` and `Review` domain objects. Validates artifact names and parse failures before persistence.

**Key deliverables:**
- `parseGoalCheckTable()`: parses the Goal Check markdown table from checkpoint files, extracting `Criterion` and `Evidence` columns as `GoalCheckRow` objects
- `extractNextAction()`: extracts the next action text from the next-action section of checkpoint files
- `readMissionReview()`: reads `review-state.json` from mission directories and constructs `Review` domain objects via `reviewFromState()`
- `decisionFromPhase()`: maps review phase (`approved`, `fixing`) to `ReviewerDecision` domain values
- `requiredAgentFamily()`: constructs the required `AgentFamily` values of a review round through the domain constructor, recording a validation error instead of substituting a fallback family
- `parseAssigneeValue()`: handles scalar and inline YAML list shapes (`codex`, `[codex]`, `[codex, claude]`) for production backlog files
- **Checkpoint name validation**: `readCheckpointFiles()` validates each artifact name via `isCheckpointName()` before creating `CheckpointData`; invalid names and unreadable files are reported as validation errors (not silently skipped)
- Checkpoint files are read during discovery (`readCheckpointFiles`) and persisted through `SqliteMissionStore.save()`, which handles the full aggregate
- Missing checkpoint or review artifacts produce empty collections (not errors), but a *present* review artifact that cannot be read, parsed, or validated is reported as a validation error and blocks the transaction — a malformed `review-state.json` is never treated as an absent one
- `findMissionDir()` requires the mission directory name to equal the mission id exactly; directories that merely start with the id are reported as `ambiguous-mission-directory` rather than guessed at, so one mission's artifacts can never attach to a prefix-colliding sibling
- Checkpoint and review values are compared against the rehydrated database aggregate, so a checkpoint without Goal Check rows round-trips without being reported as divergent

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Checkpoint Goal Check rows parsed | `src/adapters/sqlite/mission-importer.ts:1130` (parseGoalCheckTable), test `"dry-run parses Goal Check table rows from checkpoint files"` in `test/task-2322.04-mission-import.test.ts` | PASS |
| Next action text extracted | `src/adapters/sqlite/mission-importer.ts:1175` (extractNextAction), test `"dry-run parses Goal Check table rows from checkpoint files"` | PASS |
| Review domain objects constructed | `src/adapters/sqlite/mission-importer.ts:1193` (readMissionReview), `src/adapters/sqlite/mission-importer.ts:1243` (reviewFromState), test `"dry-run reads review-state.json and constructs Review domain object"` | PASS |
| Mission with both checkpoints and review | test `"dry-run imports mission with both checkpoints and review"` | PASS |
| Mission with no artifacts handled gracefully | `src/adapters/sqlite/mission-importer.ts:1072` (readCheckpointFiles returns empty collections), test `"dry-run handles mission with no checkpoint or review artifacts gracefully"` | PASS |
| Checkpoints persisted through apply | `src/adapters/sqlite/mission-importer.ts:398` (store.save persists the full aggregate), test `"apply persists checkpoint Goal Check rows and next action through SqliteMissionStore"` | PASS |
| Checkpoint values round-trip without a false divergence | `src/adapters/sqlite/mission-importer.ts:641` (loadPersistedMissions), test `"apply reports no conflict for an unchanged checkpoint that has no Goal Check rows"` | PASS |
| Review changes are detected at the same round count | `src/adapters/sqlite/mission-importer.ts:1455` (getDivergenceDetails), test `"apply reports divergence when only the review reviewer changes"` | PASS |
| SC7: Checked domain construction via SqliteMissionStore.save() | `src/adapters/sqlite/mission-importer.ts:398` (store.save in apply loop), `src/adapters/sqlite/mission-importer.ts:1243` (reviewFromState), `src/adapters/sqlite/mission-importer.ts:1130` (GoalCheckRow from parseGoalCheckTable) | PASS |
| Checkpoint name validation via isCheckpointName() | `src/adapters/sqlite/mission-importer.ts:1093` (isCheckpointName check), test `"apply reports invalid checkpoint name as validation error"` | PASS |
| Unreadable checkpoint reported as validation error | `src/adapters/sqlite/mission-importer.ts:1108` (catch block in readCheckpointFiles), test `"apply reports unreadable checkpoint as validation error"` | PASS |
| Inline YAML list assignee parsing | `src/adapters/sqlite/mission-importer.ts:40` (parseAssigneeValue helper), test `"dry-run parses inline YAML list assignee syntax"` | PASS |
| Malformed review artifact reported, never imported as absent | `src/adapters/sqlite/mission-importer.ts:1193` (readMissionReview error returns), `src/adapters/sqlite/mission-importer.ts:1361` (requiredAgentFamily), tests `"apply refuses to write when review-state.json is not valid JSON"` and `"apply refuses to write when review-state.json is missing the reviewer family"` | PASS |
| Absent review artifact stays an optional omission | test `"an absent review-state.json remains an optional omission, not an error"` | PASS |
| Mission-directory lookup is identity-safe | `src/adapters/sqlite/mission-importer.ts:1037` (findMissionDir exact match + ambiguity report), tests `"does not attach a prefix-colliding mission directory to a different mission"` and `"an exact mission-directory match wins over a prefix-colliding sibling"` | PASS |

## Next action:

Hand the branch back to `codex` for review round 4 (the round-3 `request-changes` findings are addressed in this commit; `missions/task-2322.04/review-state.json` records round 3, phase `fixing`) with the full gate evidence from `./scripts/verify-local.sh all` and the note that ESLint reports a pre-existing `no-unused-vars` error in `src/application/services/agent-block-service.ts:24`, which is red on `main` and outside this mission's scope.
