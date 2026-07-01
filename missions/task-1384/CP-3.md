# CP-3: ADR written and backlog plan aligned

ADR 0048 written under `docs/adr/`. Parent task and child tasks rewritten to reflect the recommended implementation sequence. All child task slugs use integer task IDs (TASK-1385 through TASK-1389).

## Work Done

1. **ADR 0048** created at `docs/adr/0048-fail-closed-harness-defense-against-agent-hallucinations.md`:
   - Inventories 23 existing check points across 5 lifecycle phases
   - Classifies 8 failure classes as auto-repair / auto-send-back / human-only
   - Evaluates 7 candidate harness controls in a decision matrix (C1-C7)
   - Each candidate marked as: implement now (C1, C2, C3), defer (C4, C5, C6), or human-only (C7)
   - Cites 4 prior artifacts: task-1268, task-1335, ADR 0041, ADR 0047

2. **ADR index** updated at `docs/adr/index.md` with entry for ADR 0048.

3. **Parent task TASK-1384** description rewritten to summarize ADR 0048 outputs.

4. **Child tasks updated** (5 tasks, all integer slugs):
   - TASK-1389: Error classifier and dispatch table (C3, implement now, first priority)
   - TASK-1387: Gate-failure auto-send-back with captured output (C2, implement now)
   - TASK-1385: Pre-review-round gate enforcement with auto-bounce (C1, implement now)
   - TASK-1386: Declared-gate pre-validation (C4, deferred)
   - TASK-1388: Gatekeeper auto-send-back with agent relaunch (C5, deferred)

5. **Invalid slugs corrected**: Five child tasks with non-integer slugs (`task-1384.01` through `task-1384.05`) were replaced by TASK-1385 through TASK-1389 with valid integer IDs.

## Goal Check

| Criterion | Evidence | Status |
|-----------|----------|--------|
| ADR exists under docs/adr/ | `docs/adr/0048-fail-closed-harness-defense-against-agent-hallucinations.md` | PASS |
| ADR listed in index | `docs/adr/index.md` last entry before Cross-reference | PASS |
| ADR cites 4+ prior artifacts | ADR 0048 Inputs section: task-1268, task-1335, ADR 0041, ADR 0047 | PASS |
| Decision matrix with 5+ candidates | ADR 0048 Decision Matrix: C1-C7 (7 candidates), each classified | PASS |
| 5+ child tasks with integer slugs | TASK-1385, TASK-1386, TASK-1387, TASK-1388, TASK-1389 | PASS |
| Parent task rewritten | TASK-1384 description updated via backlog MCP | PASS |

Next action: Write final CP-4 with complete Goal Check table covering all success criteria, then verify the docs gate passes.
