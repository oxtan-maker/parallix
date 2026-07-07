# CP-3: Correct smoke-test flow and assertions

## Work Done

Corrected the smoke-test flow and assertions in `test/e2e-real-agent-smoke.test.js` to validate the full Parallix lifecycle, mission content, CLI-under-test provenance, telemetry output, and reviewer selection behavior in one deterministic path.

### Changes Made

1. **Updated test name** (line 265):
   - Changed from: `"real custom-agent launcher smoke: opencode draft produces a parseable MISSION.md (SC3/SC4/SC5/SC6/SC7)"`
   - Changed to: `"real custom-agent launcher smoke: full lifecycle with hello-world task (SC3/SC4/SC5/SC6/SC7)"`
   - Reflects that the test now covers the full lifecycle (draft -> active -> review) with the corrected hello-world task

2. **Added CLI-under-test provenance verification** (lines 289-299):
   - Added assertions to verify `CLI_ENTRY` exists and points to `px.js`
   - These assertions would fail if a stale global or installed CLI were used instead
   - The `CLI_ENTRY` resolves from the test's `__dirname` to the repo's `px.js`, ensuring we test the code under test

3. **Renamed `result` to `draftResult`** (lines 302, 304, 307, 313, 333, 346):
   - Fixed variable naming to be more descriptive as we now have multiple phases
   - Updated all references from `result` to `draftResult` in the draft phase

4. **Added hello-world task verification** (lines 329-334):
   - Added assertion to verify the MISSION.md contains "hello world" or "hello-world"
   - This ensures the task description uses the representative minimal hello-world shell program task instead of the fabricated greeting-helper placeholder

5. **Strengthened telemetry assertions** (lines 352-376):
   - Added check that stats.csv file exists in isolated `PARALLIX_HOME` (lines 352-353)
   - Added reading of stats.csv file content (line 354)
   - Added assertion that stats.csv contains expected headers and data (lines 356-360)
   - Added isolation check: verifies no mission data escaped to default `~/.parallix/stats.csv` (lines 363-376)

6. **Added active phase** (lines 378-395):
   - Added `px active --implementer custom` invocation (line 378)
   - Added assertion for zero exit status (lines 380-384)
   - Added assertion for "Active agent family: custom" in stdout (lines 386-389)
   - Added verification of CP-1.md artifact (lines 392-394)
   - Added assertion that CP-1.md contains Goal Check heading (lines 395-396)

7. **Added review loop verification** (lines 392-425):
   - Note: `px active` autostarts the autonomous review loop, so no explicit `px review` call is needed
   - Added reviewer-forcing verification via review-state.json
     - Checks that `review-state.json` exists
     - Asserts `reviewer === "custom"` strictly: the isolated `PARALLIX_HOME/agents.local.json` blocklist blocks every other family, so `startReviewLoop`'s single-family fallback must assign `custom` as reviewer of its own PR
     - Also acts as cost containment: no fallback path can launch an expensive cloud agent from the blocking gate
   - Added verification that review loop completed with APPROVED disposition (lines 405-415)
   - Added verification of review-events directory (lines 418-425)
   - Added assertion that at least one review event file exists (lines 421-422)

8. **Launcher child environment sanitization**:
   - The inherited `PWD` is removed from the child environment. opencode trusts `PWD` over the real working directory for project resolution, so a stale `PWD` pointing at the developer's primary repo made the launcher child attach to that project — colliding with concurrent opencode sessions (observed as SQLite WAL-checkpoint failures and the child hanging at exit until SIGTERM)
   - A fast real `opencode run` health probe executes with the same child environment before the lifecycle run, so broken launcher/runtime state fails in seconds instead of burning the full draft timeout

9. **Active phase runs from the mission worktree**:
   - `px active`'s preflight validates the working directory and branch against the mission worktree, so the harness invokes it with the worktree as cwd, matching a real implementer session

10. **Operator refinement step between draft and active**:
   - After all raw-draft assertions pass, the harness pins the drafted mission's `## Gates` checklist to `./scripts/verify-local.sh all` (a no-op stub shipped in the throwaway repo) and commits, mirroring the human refinement step in the real workflow
   - Without this, small local models write prose in the Gates checklist (e.g. "- [ ] `bash hello.sh` outputs exactly `Hello, World!`") and the workflow fails executing it literally at handoff

11. **Realistic backlog structure**:
   - The hand-rolled backlog is equivalent to `backlog init` + `backlog task create` output (full directory skeleton, `config.yml` with the lifecycle statuses and `default_port` so the backlog CLI does not normalize/dirty the committed tree mid-draft)

### Preserved Elements

The following elements from the original TASK-1359 implementation remain intact:

1. **Explicit custom-model configuration**: `CUSTOM_MODEL` is read from this repository's own `workflow.config.json` (`adapters.agents.models.custom`) and written explicitly into the throwaway repo's config, so the smoke run exercises the same agent configuration Parallix itself uses
2. **Failure classification buckets**: `LAUNCHER_FAILURE_PATTERNS` and `MODEL_UNAVAILABLE_PATTERNS` with the three bucket types
3. **Parallix-owned state isolation (config route)**: `PARALLIX_HOME` pointed at a tmp dir in `setupRepository`, covering both `stats.csv` and the agent blocking file `agents.local.json`; opencode's own `XDG_DATA_HOME` is deliberately not sandboxed
4. **Throwaway repo setup**: Same structure with bin/, config/, backlog/tasks/, etc.
5. **Preflight check**: `preflightCheck()` function (lines 161-167) that verifies opencode binary exists
6. **Failure classification function**: `classifyFailure()` (lines 142-154)
7. **Blocking gate registration**: `config/integration-pipelines.json` still contains `custom-agent-smoke` gate

### What the Corrected Test Now Validates

The corrected smoke test now validates in a single deterministic path:

1. **Lifecycle coverage**: draft -> active -> review phases all execute successfully
2. **Mission content**: Uses "Create a .sh hello world program" task description
3. **CLI-under-test provenance**: Verifies `CLI_ENTRY` exists, points to `px.js`, and is used for all invocations
4. **Telemetry isolation**: 
   - Verifies stats file exists in isolated `PARALLIX_HOME`
   - Validates stats file content (model, provider)
   - Ensures no writes escaped to default telemetry locations
   - Adds a fast real launcher health probe so broken `opencode` runtime state fails early instead of being misread as lifecycle slowness
5. **Reviewer forcing**: Verifies the review loop records `reviewer: "custom"` (forced via the isolated blocklist) in review-state.json

## Goal Check

| Criterion | Evidence | Status |
|-----------|----------|--------|
| Lifecycle validated | draft (line 302), active (line 378) phases all execute, review loop autostarts via active | PASS |
| Mission content corrected | hello-world check added (lines 332-334) | PASS |
| CLI-under-test provenance | CLI_ENTRY verification (lines 289-299) | PASS |
| Telemetry assertions strengthened | Stats.csv file check (lines 352-353), content validation (lines 356-360), isolation check (lines 363-376) | PASS |
| Reviewer selection validated | review-state.json check (lines 398-402) | PASS |
| Preserved elements intact | Pinned-model, failure buckets, isolation mechanism all preserved | PASS |
| Full lifecycle in one path | All phases executed sequentially in single test | PASS |

## Next action

Proceed to CP-4: Update `docs/real-agent-smoke.md` to match the corrected flow, prerequisites, runtime expectations, and failure-bucket interpretation without changing the mission's blocking-gate stance.
