# CP-2: Map the smallest lifecycle and artifacts for TASK-1351 and TASK-1273

## Work Done

Mapped the smallest lifecycle and artifacts required to catch TASK-1351 and TASK-1273 class regressions while preserving the repo-sourced custom-model config, failure buckets, and temp-scoped PARALLIX_HOME isolation approach.

### Analysis

**TASK-1351 (invalid `-m` / model-launch argument handling)**:
- This bug class manifests when the custom launcher surface constructs invalid arguments for the `opencode` invocation
- The launcher code path is: `lib/agents/agents.ts` -> `startOpencodeAgent` -> `lib/agents/opencode.ts` -> `buildOpencodeInvocation`
- This path is exercised during the **draft** phase when `px draft --agent custom` is invoked
- Both `draft` and `active` phases funnel through the same launcher code path (per original TASK-1359 design in `docs/real-agent-smoke.md`)

**TASK-1273 (non-parseable real-agent draft output)**:
- This bug class manifests when the real custom agent produces output that Parallix cannot parse into valid mission artifacts
- The parsing happens immediately after draft when Parallix reads the generated `MISSION.md`
- This is also caught during the **draft** phase

### Smallest Lifecycle for Bug Classes

**Minimum lifecycle to catch TASK-1351 and TASK-1273**: **draft only**

A single `px draft --agent custom` invocation is technically sufficient to catch both bug classes because:
1. It exercises the full launcher boundary (catches TASK-1351)
2. It produces the MISSION.md that needs parsing (catches TASK-1273)

### Additional Requirements from TASK-2201

However, TASK-2201 expands the scope beyond just catching those two bug classes. The mission also requires verification of:

1. **CLI-under-test provenance**: Verify the test invokes the mission branch/worktree `px` entrypoint, not a stale installed CLI
   - Can be verified during **draft** phase by checking the CLI resolves correctly

2. **Telemetry isolation**: Verify writes stay inside isolated temp locations and validate actual stats output content
   - Can be verified during **draft** phase by checking a temp-scoped `PARALLIX_HOME` is used — it is the highest-precedence resolver input for both `stats.csv` and the agent blocking file `agents.local.json` (lib/core/storage.ts)
   - Requires checking stats file content in the isolated location

3. **Reviewer forcing behavior**: Force `custom` as reviewer on its own PR
   - Enforced via the product's local blocklist: the isolated `PARALLIX_HOME/agents.local.json` blocks claude/codex/vibe, so `startReviewLoop`'s selection has no different-family candidate and takes its single-family fallback (`custom` reviews its own PR)
   - `startAgent` overwrites `FORGEJO_USER` with the chosen launch family, so `FORGEJO_USER` is NOT a forcing mechanism
   - Requires the **review** phase to observe `reviewer: "custom"` in `review-state.json`
   - Side effect: the blocking gate can never launch an expensive cloud agent via fallback

### Minimum Lifecycle for Full Coverage

To satisfy all TASK-2201 requirements while catching TASK-1351 and TASK-1273:

**Required phases**: **draft -> active -> review**

This is the smallest lifecycle that:
- Catches TASK-1351 and TASK-1273 (draft)
- Verifies CLI provenance (draft)
- Verifies telemetry isolation (draft)
- Verifies reviewer assignment behavior (review)

The **integrate** phase is not strictly required for catching the target bug classes, but including it provides complete lifecycle coverage. However, for the minimum viable fix, **draft -> active -> review** is sufficient.

### Required Artifacts

| Phase | Required Artifacts | Purpose |
|-------|-------------------|---------|
| draft | `MISSION.md` with `## Goal`, `## Scope`, `## Success Criteria` | Proves parseable output (TASK-1273) |
| draft | `PARALLIX_HOME/stats.csv` | Proves telemetry isolation |
| draft | stdout containing `Draft agent family: custom` | Proves launcher boundary (TASK-1351) and CLI provenance |
| active | `CP-1.md` | Proves active phase executed |
| review | `review-state.json` with `reviewer: "custom"` | Proves reviewer forcing via the agents.local.json blocklist |

### Preserved Elements

The following elements from the original TASK-1359 implementation are preserved:

1. **Explicit custom-model configuration**: the throwaway repo's `workflow.config.json` sets `adapters.agents.models.custom` explicitly; its value is sourced from this repository's own `workflow.config.json` so the smoke run matches the repo's real agent configuration
2. **Failure classification buckets**: `local-model-environment`, `opencode-launcher-failure`, `parallix-workflow-failure` with regex-based detection
3. **Parallix-owned state isolation (config route)**: `PARALLIX_HOME` pointed at a tmp dir, covering both `stats.csv` and `agents.local.json`; opencode's own `XDG_DATA_HOME` is deliberately not sandboxed
4. **Blocked gate registration**: `config/integration-pipelines.json` contains `custom-agent-smoke` gate

## Goal Check

| Criterion | Evidence | Status |
|-----------|----------|--------|
| Smallest lifecycle mapped for TASK-1351/TASK-1273 | draft phase is sufficient for both bug classes | PASS |
| Additional requirements identified | CLI provenance, telemetry isolation, reviewer selection all mapped | PASS |
| Minimum lifecycle for full coverage determined | draft -> active -> review is the minimum | PASS |
| Required artifacts identified | MISSION.md, stats file, stdout, CP-1.md, review-state.json | PASS |
| Preserved elements documented | Pinned-model, failure buckets, isolation mechanism, gate registration | PASS |

## Next action

Proceed to CP-3: Correct the smoke-test flow and assertions so the lifecycle (draft -> active -> review), mission content (hello-world shell program), CLI-under-test provenance, telemetry output, and reviewer selection behavior are all validated in one deterministic path.
