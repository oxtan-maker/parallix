# CP-4: Update documentation for corrected smoke-test flow

## Work Done

Updated `docs/real-agent-smoke.md` to match the corrected flow, prerequisites, runtime expectations, and failure-bucket interpretation without changing the mission's blocking-gate stance.

### Changes Made

1. **Updated lifecycle depth section** (lines 52-72):
   - Changed from: "The gate runs `px draft <slug> --agent custom` once... stops at `draft`"
   - Changed to: "The gate runs the full `draft -> active -> review` lifecycle..."
   - Explained that while the original implementation stopped at draft, the corrected test now exercises the complete `draft -> active -> review` flow
   - Added rationale for each phase:
     - `draft`: Proves launcher boundary (catches TASK-1351)
     - `draft`: Proves parseability of MISSION.md (catches TASK-1273)
     - `active`: Verifies active phase execution and artifact generation (CP-1.md)
     - `review`: Verifies review phase execution and reviewer selection behavior
     - Strengthened telemetry isolation assertions with actual file-content validation
   - Noted that the test stops at `review` (not `integrate`) as integrate is not required to catch the target bug classes

2. **Added hello-world task reference** (lines 67-68):
   - Added: "The test uses a representative minimal mission prompt based on the hello-world shell program task (\"Create a .sh hello world program\")"
   - This replaces the reference to the fabricated greeting-helper placeholder

3. **Updated mission references** (lines 8-9):
   - Added reference to `missions/task-2201/MISSION.md` alongside the original `missions/task-1359/MISSION.md`
   - Explained that this is the retake that corrected the lifecycle coverage

4. **Added "Additional validations" section** (lines 86-106):
   - Documented the new validations added in TASK-2201:
     - **CLI-under-test provenance**: Verifies CLI_ENTRY exists and points to px.js
     - **Telemetry isolation**: Validates stats files in isolated PARALLIX_HOME, checks content, ensures no escapes to default locations
     - **Reviewer selection behavior**: Verifies the review loop records a valid reviewer assignment via review-state.json
     - **Representative task content**: Uses hello-world shell program task instead of greeting-helper

### Preserved Elements

The following documentation elements remain unchanged:

1. **Blocking gate stance**: The document still explicitly states the gate is blocking, not advisory
2. **Prerequisites section**: Still requires opencode and the repo-configured custom-family local model (now sourced from this repo's `workflow.config.json` instead of an independent hardcoded pin)
3. **Invocation section**: Still shows `node test/e2e-real-agent-smoke.test.js` and integration via `px integrate`
4. **Expected runtime and determinism**: Still notes it's slower and less deterministic, with timeout guidance
5. **Failure interpretation (SC6)**: The three failure buckets remain the same:
   - `[local-model-environment]`
   - `[opencode-launcher-failure]` (TASK-1351 class)
   - `[parallix-workflow-failure]` (TASK-1273 class)
6. **Preflight check description**: Updated to cover the binary/model-config presence checks, the fast real `opencode run` health probe, and the `PWD` sanitization rationale

### Documentation Accuracy

The updated documentation now accurately reflects:
- The full lifecycle depth covered (draft -> active -> review)
- The corrected task description (hello-world shell program)
- The additional validations (CLI provenance, telemetry isolation, reviewer selection)
- The preserved blocking-gate stance
- The reference to both the original TASK-1359 and the correction TASK-2201

## Goal Check

| Criterion | Evidence | Status |
|-----------|----------|--------|
| Documentation matches corrected flow | Lifecycle depth section updated to reflect draft -> active -> review | PASS |
| Prerequisites documented | Prerequisites section preserved with opencode and the repo-configured custom model | PASS |
| Runtime expectations updated | Expected runtime and determinism section preserved with timeout guidance | PASS |
| Failure-bucket interpretation preserved | SC6 section with three buckets unchanged | PASS |
| Blocking-gate stance unchanged | Document still explicitly states gate is blocking | PASS |
| Additional validations documented | New "Additional validations" section explains CLI provenance, telemetry isolation, reviewer selection | PASS |
| Mission references updated | References both task-1359 and task-2201 | PASS |

## Next action

Proceed to CP-5: Run the required verification gates (./scripts/verify-local.sh all and static-analysis if lib/ touched) and capture evidence for the final goal-check handoff.
